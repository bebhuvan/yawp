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


BASE_SCHEMA = """
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
"""

# External-content FTS5 keyed on the implicit rowid of `notes`.
# Triggers keep notes_fts in sync. Re-indexing is cheap.
FTS_SCHEMA = """
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
"""


_lock = threading.Lock()


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
        }


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(config.DB_PATH, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def cursor():
    with _lock:
        conn = _connect()
        try:
            yield conn
        finally:
            conn.close()


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


def init_db() -> None:
    Path(config.DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    with cursor() as conn:
        conn.executescript(BASE_SCHEMA)
        # Migrations — add columns missing from older schemas.
        cols = {r[1] for r in conn.execute("PRAGMA table_info(notes)").fetchall()}
        if "tags" not in cols:
            conn.execute("ALTER TABLE notes ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'")
        if "todos" not in cols:
            conn.execute("ALTER TABLE notes ADD COLUMN todos TEXT NOT NULL DEFAULT '[]'")
        conn.executescript(FTS_SCHEMA)
        conn.execute("INSERT INTO notes_fts(notes_fts) VALUES('rebuild')")


_SELECT_COLS = (
    "id, title, transcript, language, model, mode, "
    "duration_sec, audio_path, created_at, tags, todos"
)


def list_notes(limit: int = 500) -> list[NoteRow]:
    with cursor() as conn:
        rows = conn.execute(
            f"SELECT {_SELECT_COLS} FROM notes "
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
            "WHERE notes_fts MATCH ? "
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


def get_note(note_id: str) -> Optional[NoteRow]:
    with cursor() as conn:
        row = conn.execute(
            f"SELECT {_SELECT_COLS} FROM notes WHERE id = ?",
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
            f"UPDATE notes SET {', '.join(fields)} WHERE id = ?",
            tuple(values),
        )
    return get_note(note_id)


def delete_note(note_id: str) -> bool:
    note = get_note(note_id)
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


def _iso_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def count_notes() -> int:
    with cursor() as conn:
        return int(conn.execute("SELECT COUNT(*) FROM notes").fetchone()[0])
