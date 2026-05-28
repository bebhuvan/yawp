"""Mirror all notes to a folder of .md files (Obsidian / Bear / iA Writer
compatible).

Filename convention:
    YYYY-MM-DD_HHMMSS_short-title.md

Frontmatter:
    ---
    id: <hex>
    title: …
    created_at: ISO-8601
    duration_sec: 12.4
    model: faster-whisper:small.en
    tags: [foo, bar]
    ---
"""

from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path

from . import db


def _slug(text: str, max_len: int = 50) -> str:
    text = re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower()
    return (text or "untitled")[:max_len]


def _filename(note: db.NoteRow) -> str:
    try:
        dt = datetime.fromisoformat(note.created_at)
    except ValueError:
        dt = datetime.now()
    return f"{dt.strftime('%Y-%m-%d_%H%M%S')}_{_slug(note.title)}.md"


def _frontmatter(note: db.NoteRow) -> str:
    tags = "[" + ", ".join(note.tags) + "]" if note.tags else "[]"
    folder_row = db.get_folder(note.folder_id) if note.folder_id else None
    folder = folder_row.name if folder_row else ""
    return (
        "---\n"
        f"id: {note.id}\n"
        f"title: {_escape(note.title)}\n"
        f"created_at: {note.created_at}\n"
        f"duration_sec: {note.duration_sec}\n"
        f"model: {note.model}\n"
        f"mode: {note.mode}\n"
        f"tags: {tags}\n"
        f"folder: {_escape(folder)}\n"
        f"kind: {_escape(str(note.smart_metadata.get('kind') or ''))}\n"
        f"collection: {_escape(str(note.smart_metadata.get('collection') or ''))}\n"
        "---\n\n"
    )


def _escape(s: str) -> str:
    # YAML-safe: wrap in quotes if it has special chars, double internal "
    if any(c in s for c in ":#-?[]{}|>\""):
        return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return s


def export_all(dest_dir: str) -> dict:
    """Write every note as a .md file in *dest_dir*. Returns a summary."""
    dest = Path(dest_dir).expanduser().resolve()
    if dest.exists() and not dest.is_dir():
        raise ValueError(f"not a directory: {dest}")
    dest.mkdir(parents=True, exist_ok=True)

    notes = db.list_notes(limit=10_000)
    for existing in dest.glob("*.md"):
        if _exported_note_id(existing):
            existing.unlink(missing_ok=True)

    written = 0
    for note in notes:
        path = dest / _filename(note)
        summary = str(note.smart_metadata.get("summary") or "").strip()
        body = _frontmatter(note)
        if summary:
            body += f"> {summary}\n\n"
        body += note.transcript.rstrip() + "\n"
        path.write_text(body, encoding="utf-8")
        written += 1

    return {"dest": str(dest), "count": written}


def _exported_note_id(path: Path) -> str | None:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()[:20]
    except OSError:
        return None
    if not lines or lines[0].strip() != "---":
        return None
    for line in lines[1:]:
        if line.strip() == "---":
            return None
        if line.startswith("id: "):
            return line[4:].strip()
    return None
