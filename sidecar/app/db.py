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
            "deletedAt": self.deleted_at,
        }


def _row_to_note(row: sqlite3.Row) -> NoteRow:
    d = dict(row)
    raw_tags = d.pop("tags", "[]") or "[]"
    raw_todos = d.pop("todos", "[]") or "[]"
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
    return NoteRow(tags=tags, todos=todos, **d)


_SELECT_COLS = (
    "id, title, transcript, language, model, mode, "
    "duration_sec, audio_path, created_at, tags, todos, deleted_at"
)


def list_notes(limit: int = 500) -> list[NoteRow]:
    with cursor() as conn:
        rows = conn.execute(
            f"SELECT {_SELECT_COLS} FROM notes "
            "WHERE deleted_at IS NULL "
            "ORDER BY created_at DESC LIMIT ?",
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
) -> NoteRow:
    if mode not in ("notes", "paste"):
        raise ValueError(f"invalid mode: {mode}")
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
    )
    with cursor() as conn:
        conn.execute(
            "INSERT INTO notes "
            "(id, title, transcript, language, model, mode, "
            "duration_sec, audio_path, created_at, tags, todos) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
