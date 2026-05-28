from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from . import config


# --- Schema migrations ------------------------------------------------------
#
# Driven by PRAGMA user_version. Each entry runs in order whenever the DB's
# user_version is below its key. Append new versions to the end; do not edit
# released migrations.

_MIGRATIONS: list[tuple[int, str]] = [
    (
        1,
        """
        CREATE TABLE IF NOT EXISTS notes (
            id           TEXT PRIMARY KEY,
            title        TEXT NOT NULL,
            transcript   TEXT NOT NULL,
            language     TEXT,
            model        TEXT NOT NULL,
            mode         TEXT NOT NULL CHECK (mode IN ('notes', 'paste')),
            duration_sec REAL NOT NULL,
            audio_path   TEXT,
            created_at   TEXT NOT NULL,
            tags         TEXT NOT NULL DEFAULT '[]',
            todos        TEXT NOT NULL DEFAULT '[]'
        );
        CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at DESC);

        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
            title, transcript, tags,
            content='notes',
            content_rowid='rowid',
            tokenize='porter unicode61'
        );

        CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
            INSERT INTO notes_fts(rowid, title, transcript, tags)
            VALUES (new.rowid, new.title, new.transcript, new.tags);
        END;

        CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, title, transcript, tags)
            VALUES('delete', old.rowid, old.title, old.transcript, old.tags);
        END;

        CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, title, transcript, tags)
            VALUES('delete', old.rowid, old.title, old.transcript, old.tags);
            INSERT INTO notes_fts(rowid, title, transcript, tags)
            VALUES (new.rowid, new.title, new.transcript, new.tags);
        END;
        """,
    ),
    (
        2,
        # Soft-delete: deleted_at IS NULL means visible. We do not remove the
        # row or audio file at delete-time; the API issues a hard purge after
        # an undo window expires.
        """
        ALTER TABLE notes ADD COLUMN deleted_at TEXT;
        CREATE INDEX IF NOT EXISTS idx_notes_deleted_at ON notes(deleted_at);
        """,
    ),
    (
        3,
        """
        ALTER TABLE notes ADD COLUMN smart_metadata TEXT NOT NULL DEFAULT '{}';

        DROP TRIGGER IF EXISTS notes_ai;
        DROP TRIGGER IF EXISTS notes_ad;
        DROP TRIGGER IF EXISTS notes_au;
        DROP TABLE IF EXISTS notes_fts;

        CREATE VIRTUAL TABLE notes_fts USING fts5(
            title, transcript, tags, smart_metadata,
            content='notes',
            content_rowid='rowid',
            tokenize='porter unicode61'
        );

        CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
            INSERT INTO notes_fts(rowid, title, transcript, tags, smart_metadata)
            VALUES (new.rowid, new.title, new.transcript, new.tags, new.smart_metadata);
        END;

        CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, title, transcript, tags, smart_metadata)
            VALUES('delete', old.rowid, old.title, old.transcript, old.tags, old.smart_metadata);
        END;

        CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, title, transcript, tags, smart_metadata)
            VALUES('delete', old.rowid, old.title, old.transcript, old.tags, old.smart_metadata);
            INSERT INTO notes_fts(rowid, title, transcript, tags, smart_metadata)
            VALUES (new.rowid, new.title, new.transcript, new.tags, new.smart_metadata);
        END;

        INSERT INTO notes_fts(notes_fts) VALUES('rebuild');
        """,
    ),
    (
        4,
        """
        CREATE TABLE IF NOT EXISTS folders (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            normalized_name TEXT NOT NULL UNIQUE,
            created_at      TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_folders_name ON folders(normalized_name);

        ALTER TABLE notes ADD COLUMN folder_id TEXT;
        CREATE INDEX IF NOT EXISTS idx_notes_folder_id ON notes(folder_id);
        """,
    ),
    (
        5,
        """
        INSERT OR IGNORE INTO folders (id, name, normalized_name, created_at)
        SELECT
            lower(hex(randomblob(16))),
            trim(json_extract(smart_metadata, '$.collection')),
            lower(trim(json_extract(smart_metadata, '$.collection'))),
            MIN(created_at)
        FROM notes
        WHERE deleted_at IS NULL
          AND json_valid(smart_metadata)
          AND trim(COALESCE(json_extract(smart_metadata, '$.collection'), '')) != ''
        GROUP BY lower(trim(json_extract(smart_metadata, '$.collection')));

        UPDATE notes
        SET folder_id = (
            SELECT folders.id
            FROM folders
            WHERE folders.normalized_name =
              lower(trim(json_extract(notes.smart_metadata, '$.collection')))
            LIMIT 1
        )
        WHERE folder_id IS NULL
          AND deleted_at IS NULL
          AND json_valid(smart_metadata)
          AND trim(COALESCE(json_extract(smart_metadata, '$.collection'), '')) != '';
        """,
    ),
    (
        6,
        """
        ALTER TABLE notes ADD COLUMN folder_manually_set INTEGER NOT NULL DEFAULT 0;
        """,
    ),
]


# --- Connection management --------------------------------------------------
#
# One connection per thread, kept open for the thread's lifetime. SQLite WAL
# allows many readers + one writer concurrently; the previous global lock
# serialised everything, defeating WAL.

_local = threading.local()
_pragma_lock = threading.Lock()  # only used at first-touch initialisation


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(
        config.DB_PATH,
        isolation_level=None,
        check_same_thread=False,
        timeout=10.0,
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=10000")
    return conn


def _conn() -> sqlite3.Connection:
    c = getattr(_local, "conn", None)
    if c is None:
        c = _connect()
        _local.conn = c
    return c


@contextmanager
def cursor():
    """Yield this thread's connection. Kept open across requests."""
    yield _conn()


def init_db() -> None:
    Path(config.DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    with _pragma_lock:
        conn = _connect()
        try:
            current = int(conn.execute("PRAGMA user_version").fetchone()[0])
            for version, script in _MIGRATIONS:
                if current < version:
                    conn.executescript(script)
                    conn.execute(f"PRAGMA user_version = {version}")
                    current = version
        finally:
            conn.close()


# --- Schema ----------------------------------------------------------------


@dataclass
class NoteRow:
    id: str
    title: str
    transcript: str
    language: Optional[str]
    model: str
    mode: str
    duration_sec: float
    audio_path: Optional[str]
    created_at: str
    tags: list[str]
    todos: list[dict]
    smart_metadata: dict
    folder_id: Optional[str] = None
    folder_manually_set: bool = False
    deleted_at: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "transcript": self.transcript,
            "language": self.language,
            "model": self.model,
            "mode": self.mode,
            "durationSec": self.duration_sec,
            "audioPath": self.audio_path,
            "createdAt": self.created_at,
            "tags": self.tags,
            "todos": self.todos,
            "smartMetadata": self.smart_metadata,
            "folderId": self.folder_id,
            "folderManuallySet": self.folder_manually_set,
            "deletedAt": self.deleted_at,
        }


@dataclass
class FolderRow:
    id: str
    name: str
    created_at: str
    note_count: int = 0

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "createdAt": self.created_at,
            "noteCount": self.note_count,
        }


def _row_to_note(row: sqlite3.Row) -> NoteRow:
    d = dict(row)
    raw_tags = d.pop("tags", "[]") or "[]"
    raw_todos = d.pop("todos", "[]") or "[]"
    raw_metadata = d.pop("smart_metadata", "{}") or "{}"
    try:
        tags = json.loads(raw_tags)
        if not isinstance(tags, list):
            tags = []
    except json.JSONDecodeError:
        tags = []
    try:
        todos = json.loads(raw_todos)
        if not isinstance(todos, list):
            todos = []
    except json.JSONDecodeError:
        todos = []
    try:
        smart_metadata = json.loads(raw_metadata)
        if not isinstance(smart_metadata, dict):
            smart_metadata = {}
    except json.JSONDecodeError:
        smart_metadata = {}
    d["folder_manually_set"] = bool(d.get("folder_manually_set"))
    return NoteRow(tags=tags, todos=todos, smart_metadata=smart_metadata, **d)


_SELECT_COLS = (
    "id, title, transcript, language, model, mode, "
    "duration_sec, audio_path, created_at, tags, todos, smart_metadata, "
    "folder_id, folder_manually_set, deleted_at"
)


def list_notes(limit: int = 5000, folder_id: Optional[str] = None) -> list[NoteRow]:
    with cursor() as conn:
        if folder_id == "__uncategorized__":
            rows = conn.execute(
                f"SELECT {_SELECT_COLS} FROM notes "
                "WHERE deleted_at IS NULL AND folder_id IS NULL "
                "ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        elif folder_id:
            rows = conn.execute(
                f"SELECT {_SELECT_COLS} FROM notes "
                "WHERE deleted_at IS NULL AND folder_id = ? "
                "ORDER BY created_at DESC LIMIT ?",
                (folder_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                f"SELECT {_SELECT_COLS} FROM notes "
                "WHERE deleted_at IS NULL "
                "ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
    return [_row_to_note(r) for r in rows]


def list_deleted_notes(limit: int = 500) -> list[NoteRow]:
    with cursor() as conn:
        rows = conn.execute(
            f"SELECT {_SELECT_COLS} FROM notes "
            "WHERE deleted_at IS NOT NULL "
            "ORDER BY deleted_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [_row_to_note(r) for r in rows]


def search_notes(query: str, limit: int = 100) -> list[NoteRow]:
    """FTS5 search. `query` is a user-friendly substring; we wrap with prefix
    matching and OR semantics so 'design redesign' finds notes with either."""
    q = _build_fts_query(query)
    if not q:
        return []
    with cursor() as conn:
        rows = conn.execute(
            f"SELECT {', '.join('n.' + c.strip() for c in _SELECT_COLS.split(','))} "
            "FROM notes_fts f JOIN notes n ON n.rowid = f.rowid "
            "WHERE notes_fts MATCH ? AND n.deleted_at IS NULL "
            "ORDER BY rank LIMIT ?",
            (q, limit),
        ).fetchall()
    return [_row_to_note(r) for r in rows]


def search_notes_with_snippets(query: str, limit: int = 100) -> list[tuple[NoteRow, str]]:
    """Return FTS results with a compact snippet showing why each note matched."""
    q = _build_fts_query(query)
    if not q:
        return []
    with cursor() as conn:
        rows = conn.execute(
            f"SELECT {', '.join('n.' + c.strip() for c in _SELECT_COLS.split(','))}, "
            "snippet(notes_fts, -1, '[[', ']]', ' ... ', 18) AS search_snippet "
            "FROM notes_fts f JOIN notes n ON n.rowid = f.rowid "
            "WHERE notes_fts MATCH ? AND n.deleted_at IS NULL "
            "ORDER BY rank LIMIT ?",
            (q, limit),
        ).fetchall()
    out: list[tuple[NoteRow, str]] = []
    for row in rows:
        d = dict(row)
        snippet = d.pop("search_snippet", "") or ""
        out.append((_row_to_note(d), snippet))
    return out


def _build_fts_query(query: str) -> str:
    """Convert a free-text query into FTS5 syntax. Each token becomes a prefix
    match. Empty/whitespace returns ''.

    We use `OR` instead of implicit `AND` so the search is forgiving — typing
    'redesign tomorrow' surfaces notes with either word, ranked by relevance.
    """
    import re

    tokens = re.findall(r"[A-Za-z0-9']+", query)
    if not tokens:
        return ""
    parts = [f'"{t}"*' for t in tokens]
    return " OR ".join(parts)


def get_note(note_id: str, include_deleted: bool = False) -> Optional[NoteRow]:
    with cursor() as conn:
        if include_deleted:
            row = conn.execute(
                f"SELECT {_SELECT_COLS} FROM notes WHERE id = ?",
                (note_id,),
            ).fetchone()
        else:
            row = conn.execute(
                f"SELECT {_SELECT_COLS} FROM notes "
                "WHERE id = ? AND deleted_at IS NULL",
                (note_id,),
            ).fetchone()
    return _row_to_note(row) if row else None


def create_note(
    *,
    title: str,
    transcript: str,
    language: Optional[str],
    model: str,
    mode: str,
    duration_sec: float,
    audio_path: Optional[str],
    tags: Optional[list[str]] = None,
    todos: Optional[list[dict]] = None,
    smart_metadata: Optional[dict] = None,
    folder_id: Optional[str] = None,
    auto_folder_from_metadata: bool = False,
    auto_folder_min_confidence: float = 0.65,
) -> NoteRow:
    if mode not in ("notes", "paste"):
        raise ValueError(f"invalid mode: {mode}")
    metadata = dict(smart_metadata or {})
    resolved_folder_id = _resolve_folder_id(folder_id)
    folder_manually_set = folder_id is not None
    if resolved_folder_id is None and auto_folder_from_metadata:
        resolved_folder_id = _folder_id_from_metadata(
            metadata,
            min_confidence=auto_folder_min_confidence,
        )
    note = NoteRow(
        id=uuid.uuid4().hex,
        title=title or "Untitled",
        transcript=transcript,
        language=language,
        model=model,
        mode=mode,
        duration_sec=float(duration_sec),
        audio_path=audio_path,
        created_at=_iso_now(),
        tags=list(tags or []),
        todos=list(todos or []),
        smart_metadata=metadata,
        folder_id=resolved_folder_id,
        folder_manually_set=folder_manually_set,
    )
    with cursor() as conn:
        conn.execute(
            "INSERT INTO notes "
            "(id, title, transcript, language, model, mode, "
            "duration_sec, audio_path, created_at, tags, todos, smart_metadata, "
            "folder_id, folder_manually_set) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                note.id,
                note.title,
                note.transcript,
                note.language,
                note.model,
                note.mode,
                note.duration_sec,
                note.audio_path,
                note.created_at,
                json.dumps(note.tags),
                json.dumps(note.todos),
                json.dumps(note.smart_metadata),
                note.folder_id,
                1 if note.folder_manually_set else 0,
            ),
        )
    return note


def update_note(
    note_id: str,
    *,
    title: Optional[str] = None,
    transcript: Optional[str] = None,
    tags: Optional[list[str]] = None,
    todos: Optional[list[dict]] = None,
    smart_metadata: Optional[dict] = None,
) -> Optional[NoteRow]:
    fields: list[str] = []
    values: list[object] = []
    if title is not None:
        fields.append("title = ?")
        values.append(title)
    if transcript is not None:
        fields.append("transcript = ?")
        values.append(transcript)
    if tags is not None:
        fields.append("tags = ?")
        values.append(json.dumps(list(tags)))
    if todos is not None:
        fields.append("todos = ?")
        values.append(json.dumps(list(todos)))
    if smart_metadata is not None:
        fields.append("smart_metadata = ?")
        values.append(json.dumps(dict(smart_metadata)))
    if not fields:
        return get_note(note_id)
    values.append(note_id)
    with cursor() as conn:
        conn.execute(
            f"UPDATE notes SET {', '.join(fields)} "
            "WHERE id = ? AND deleted_at IS NULL",
            tuple(values),
        )
    return get_note(note_id)


def assign_note_folder(
    note_id: str,
    folder_id: Optional[str],
    *,
    manual: bool = True,
) -> Optional[NoteRow]:
    resolved = _resolve_folder_id(folder_id)
    with cursor() as conn:
        conn.execute(
            "UPDATE notes SET folder_id = ?, folder_manually_set = ? "
            "WHERE id = ? AND deleted_at IS NULL",
            (resolved, 1 if manual else 0, note_id),
        )
    return get_note(note_id)


def auto_assign_folder_from_metadata(
    note_id: str,
    smart_metadata: dict,
    *,
    min_confidence: float,
) -> Optional[NoteRow]:
    note = get_note(note_id)
    if not note:
        return None
    if note.folder_manually_set:
        return note
    folder_id = _folder_id_from_metadata(
        smart_metadata,
        min_confidence=min_confidence,
    )
    if not folder_id:
        return note
    return assign_note_folder(note_id, folder_id, manual=False)


def soft_delete_note(note_id: str) -> bool:
    """Mark deleted_at = now. Audio file is kept until purge_deleted runs."""
    note = get_note(note_id)
    if not note:
        return False
    with cursor() as conn:
        conn.execute(
            "UPDATE notes SET deleted_at = ? WHERE id = ?",
            (_iso_now(), note_id),
        )
    return True


def restore_note(note_id: str) -> Optional[NoteRow]:
    """Undelete a soft-deleted note. Returns the restored NoteRow, or None
    if the note doesn't exist or was already purged."""
    with cursor() as conn:
        existing = conn.execute(
            f"SELECT {_SELECT_COLS} FROM notes WHERE id = ?",
            (note_id,),
        ).fetchone()
        if not existing:
            return None
        conn.execute(
            "UPDATE notes SET deleted_at = NULL WHERE id = ?",
            (note_id,),
        )
    return get_note(note_id)


def purge_note(note_id: str) -> bool:
    """Hard-delete a note and unlink its audio file. Used after the undo
    window expires, or to prune the trash."""
    note = get_note(note_id, include_deleted=True)
    if not note:
        return False
    with cursor() as conn:
        conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    if note.audio_path:
        try:
            Path(note.audio_path).unlink(missing_ok=True)
        except OSError:
            pass
    return True


# Back-compat alias — older callers used delete_note for a hard delete.
def delete_note(note_id: str) -> bool:
    return soft_delete_note(note_id)


def _iso_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def count_notes() -> int:
    with cursor() as conn:
        return int(
            conn.execute(
                "SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL"
            ).fetchone()[0]
        )


def list_folders() -> list[FolderRow]:
    with cursor() as conn:
        rows = conn.execute(
            """
            SELECT
              f.id,
              f.name,
              f.created_at,
              COUNT(n.id) AS note_count
            FROM folders f
            LEFT JOIN notes n
              ON n.folder_id = f.id
             AND n.deleted_at IS NULL
            GROUP BY f.id
            ORDER BY lower(f.name), f.created_at
            """
        ).fetchall()
    return [
        FolderRow(
            id=r["id"],
            name=r["name"],
            created_at=r["created_at"],
            note_count=int(r["note_count"] or 0),
        )
        for r in rows
    ]


def get_folder(folder_id: str) -> Optional[FolderRow]:
    with cursor() as conn:
        row = conn.execute(
            """
            SELECT
              f.id,
              f.name,
              f.created_at,
              COUNT(n.id) AS note_count
            FROM folders f
            LEFT JOIN notes n
              ON n.folder_id = f.id
             AND n.deleted_at IS NULL
            WHERE f.id = ?
            GROUP BY f.id
            """,
            (folder_id,),
        ).fetchone()
    if not row:
        return None
    return FolderRow(
        id=row["id"],
        name=row["name"],
        created_at=row["created_at"],
        note_count=int(row["note_count"] or 0),
    )


def create_folder(name: str) -> FolderRow:
    clean_name = _clean_folder_name(name)
    normalized = _normalize_folder_name(clean_name)
    existing = _folder_by_normalized(normalized)
    if existing:
        return existing
    folder = FolderRow(id=uuid.uuid4().hex, name=clean_name, created_at=_iso_now())
    with cursor() as conn:
        conn.execute(
            "INSERT INTO folders (id, name, normalized_name, created_at) "
            "VALUES (?, ?, ?, ?)",
            (folder.id, folder.name, normalized, folder.created_at),
        )
    return folder


def update_folder(folder_id: str, name: str) -> Optional[FolderRow]:
    clean_name = _clean_folder_name(name)
    normalized = _normalize_folder_name(clean_name)
    with cursor() as conn:
        duplicate = conn.execute(
            "SELECT id FROM folders WHERE normalized_name = ? AND id != ?",
            (normalized, folder_id),
        ).fetchone()
        if duplicate:
            raise ValueError("folder name already exists")
        conn.execute(
            "UPDATE folders SET name = ?, normalized_name = ? WHERE id = ?",
            (clean_name, normalized, folder_id),
        )
    return get_folder(folder_id)


def delete_folder(folder_id: str) -> bool:
    with cursor() as conn:
        row = conn.execute("SELECT id FROM folders WHERE id = ?", (folder_id,)).fetchone()
        if not row:
            return False
        conn.execute(
            "UPDATE notes SET folder_id = NULL, folder_manually_set = 1 "
            "WHERE folder_id = ?",
            (folder_id,),
        )
        conn.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
    return True


def get_or_create_folder(name: str) -> FolderRow:
    return create_folder(name)


def _folder_by_normalized(normalized: str) -> Optional[FolderRow]:
    with cursor() as conn:
        row = conn.execute(
            "SELECT id FROM folders WHERE normalized_name = ?",
            (normalized,),
        ).fetchone()
    if not row:
        return None
    return get_folder(row["id"])


def _resolve_folder_id(folder_id: Optional[str]) -> Optional[str]:
    if folder_id:
        if not get_folder(folder_id):
            raise ValueError("folder not found")
        return folder_id
    return None


def _folder_id_from_metadata(
    smart_metadata: Optional[dict],
    *,
    min_confidence: float,
) -> Optional[str]:
    if not smart_metadata:
        return None
    collection = str(smart_metadata.get("collection") or "").strip()
    if not collection:
        return None
    try:
        confidence = float(smart_metadata.get("confidence") or 0)
    except (TypeError, ValueError):
        confidence = 0.0
    if confidence < min_confidence:
        return None
    return get_or_create_folder(collection).id


def _clean_folder_name(name: str) -> str:
    import re

    clean = re.sub(r"\s+", " ", (name or "").strip())
    if not clean:
        raise ValueError("folder name is required")
    if len(clean) > 80:
        raise ValueError("folder name is too long")
    return clean


def _normalize_folder_name(name: str) -> str:
    return _clean_folder_name(name).casefold()
