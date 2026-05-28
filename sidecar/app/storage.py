"""Disk/cache usage reporting and cleanup.

Surfaces the large on-disk artifacts Yawp accumulates — downloaded ASR models,
the LanguageTool ruleset, orphaned audio clips, and trashed notes — so the user
can reclaim space from Settings. Everything here is local-only.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

from . import config, db


def _safe_size(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def _dir_size(path: Path) -> int:
    if not path.exists():
        return 0
    total = 0
    for p in path.rglob("*"):
        if p.is_file():
            total += _safe_size(p)
    return total


def _hf_cache_dir() -> Path:
    explicit = os.environ.get("HUGGINGFACE_HUB_CACHE")
    if explicit:
        return Path(explicit)
    hf_home = os.environ.get("HF_HOME")
    base = Path(hf_home) if hf_home else Path.home() / ".cache" / "huggingface"
    hub = base / "hub"
    return hub if hub.exists() else base


def _languagetool_cache_dir() -> Path:
    return Path.home() / ".cache" / "language_tool_python"


def _referenced_audio() -> set[str]:
    with db.cursor() as conn:
        rows = conn.execute(
            "SELECT audio_path FROM notes WHERE audio_path IS NOT NULL"
        ).fetchall()
    referenced: set[str] = set()
    for (audio_path,) in rows:
        if audio_path:
            referenced.add(_resolve(Path(audio_path)))
    return referenced


def _resolve(path: Path) -> str:
    try:
        return str(path.resolve())
    except OSError:
        return str(path)


def _orphan_audio_files() -> list[Path]:
    if not config.AUDIO_DIR.exists():
        return []
    referenced = _referenced_audio()
    return [
        p
        for p in config.AUDIO_DIR.iterdir()
        if p.is_file() and _resolve(p) not in referenced
    ]


def _trash_ids() -> list[str]:
    with db.cursor() as conn:
        rows = conn.execute(
            "SELECT id FROM notes WHERE deleted_at IS NOT NULL"
        ).fetchall()
    return [row[0] for row in rows]


def _trash_audio_bytes() -> int:
    with db.cursor() as conn:
        rows = conn.execute(
            "SELECT audio_path FROM notes "
            "WHERE deleted_at IS NOT NULL AND audio_path IS NOT NULL"
        ).fetchall()
    return sum(_safe_size(Path(ap)) for (ap,) in rows if ap)


def usage() -> dict:
    orphans = _orphan_audio_files()
    orphan_bytes = sum(_safe_size(p) for p in orphans)
    trash_ids = _trash_ids()
    hf = _hf_cache_dir()
    lt = _languagetool_cache_dir()
    return {
        "audio_total_bytes": _dir_size(config.AUDIO_DIR),
        "items": [
            {
                "id": "audio_orphans",
                "label": "Orphaned audio clips",
                "description": "Recordings on disk no longer linked to any note.",
                "bytes": orphan_bytes,
                "count": len(orphans),
                "destructive": False,
            },
            {
                "id": "trash",
                "label": "Trash",
                "description": "Deleted notes. Clearing permanently removes them and their audio.",
                "bytes": _trash_audio_bytes(),
                "count": len(trash_ids),
                "destructive": True,
            },
            {
                "id": "models",
                "label": "Transcription models",
                "description": "Downloaded Whisper models. Re-downloaded automatically when next needed.",
                "bytes": _dir_size(hf),
                "path": str(hf),
                "destructive": False,
            },
            {
                "id": "grammar",
                "label": "Grammar ruleset",
                "description": "LanguageTool data. Re-downloaded on the next grammar check.",
                "bytes": _dir_size(lt),
                "path": str(lt),
                "destructive": False,
            },
        ],
    }


def _clear_dir(path: Path, target: str) -> dict:
    freed = _dir_size(path)
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)
    return {"cleared": target, "freed_bytes": freed}


def clear(target: str) -> dict:
    if target == "audio_orphans":
        freed = 0
        count = 0
        for p in _orphan_audio_files():
            size = _safe_size(p)
            try:
                p.unlink(missing_ok=True)
                freed += size
                count += 1
            except OSError:
                pass
        return {"cleared": target, "freed_bytes": freed, "count": count}

    if target == "trash":
        freed = _trash_audio_bytes()
        count = sum(1 for nid in _trash_ids() if db.purge_note(nid))
        return {"cleared": target, "freed_bytes": freed, "count": count}

    if target == "models":
        return _clear_dir(_hf_cache_dir(), target)

    if target == "grammar":
        return _clear_dir(_languagetool_cache_dir(), target)

    raise ValueError(f"unknown cache target: {target}")
