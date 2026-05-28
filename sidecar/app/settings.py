"""Persistent app settings stored at ~/.voice/settings.json.

Accessed by both the sidecar (for OpenRouter, cleanup toggle) and the
daemon (for hotkey overrides). Single source of truth.
"""

from __future__ import annotations

import json
import threading
from dataclasses import asdict, dataclass
from typing import Any

from . import config


SETTINGS_PATH = config.DATA_DIR / "settings.json"
_lock = threading.Lock()

# Cache the parsed Settings keyed by the file's mtime_ns. Re-reading JSON on
# every WS tick + every transcription is wasteful. Invalidates automatically
# when the file changes (PUT /settings, external edit, daemon reload).
_cache: tuple[int, "Settings"] | None = None


@dataclass
class Settings:
    # Local ASR model. faster-whisper names are passed through; Parakeet uses
    # "parakeet-tdt-0.6b-v3-int8". Applied when the sidecar starts.
    asr_model: str = config.DEFAULT_MODEL

    # Optional sounddevice input device index. None means system default.
    input_device: int | None = None

    # Tier 1 cleanup
    cleanup_enabled: bool = True

    # Voice commands ("period" → ., "new paragraph" → \n\n, etc.)
    voice_commands_enabled: bool = False

    # Auto-tagging
    auto_tag_enabled: bool = True

    # OpenRouter (optional; empty means disabled)
    openrouter_api_key: str = ""
    openrouter_model: str = "openai/gpt-oss-20b:free"

    # Tag count
    max_tags: int = 5

    # Daemon hotkey mode: "toggle" or "hold"
    hotkey_mode: str = "toggle"

    # Toggle-mode hotkeys use pynput combo syntax.
    hotkey_notes: str = "<ctrl>+<alt>+n"
    hotkey_paste: str = "<ctrl>+<alt>+v"

    # Hold-mode hotkeys use a single pynput key. The daemon adds a short
    # long-press guard so modifier shortcuts like Ctrl+R still pass through.
    hold_key_notes: str = "<menu>"
    hold_key_paste: str = "<ctrl_r>"

    # Auto-stop silence threshold (ms) for toggle mode. 0 disables auto-stop
    # entirely — recording continues until you tap the hotkey again. Range
    # is enforced at the API layer.
    auto_stop_ms: int = 1200

    # Optional local audio cues for daemon recording lifecycle events.
    # Disabled by default so install does not make sound unexpectedly.
    audio_feedback_enabled: bool = False

    # Paste mode: deliver text by setting the clipboard and pasting (instant for
    # long dictations) instead of typing it character-by-character. Falls back
    # to typing automatically if no clipboard tool (xclip / wl-copy) is present.
    paste_use_clipboard: bool = True

    # Auto-extract action items on every new transcript (requires OpenRouter).
    extract_todos_enabled: bool = False

    # Auto-file new notes into folders using smart metadata. Disabled by
    # default because folder moves should feel user-controlled.
    auto_organize_enabled: bool = False
    auto_organize_min_confidence: float = 0.65

    # Optional user guidance for how notes should be categorized into folders.
    # Appended to the smart-metadata prompt when an OpenRouter key is set.
    # Empty = use the built-in heuristic.
    categorization_prompt: str = ""

    # Mirror notes to a folder of .md files. Empty = manual export only.
    export_path: str = ""

    # Re-export markdown after note create/update/delete when export_path is set.
    auto_export_enabled: bool = False

    @classmethod
    def load(cls) -> "Settings":
        if not SETTINGS_PATH.exists():
            return cls()
        try:
            with SETTINGS_PATH.open() as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError):
            return cls()
        # Only honour known fields — ignore unknown keys forward-compat-style.
        defaults = cls()
        known = {f.name for f in cls.__dataclass_fields__.values()}  # type: ignore[attr-defined]
        for k, v in data.items():
            if k in known:
                setattr(defaults, k, v)
        return defaults

    def save(self) -> None:
        SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = SETTINGS_PATH.with_suffix(".json.tmp")
        with tmp.open("w") as f:
            json.dump(asdict(self), f, indent=2)
        tmp.replace(SETTINGS_PATH)

    def to_safe_dict(self) -> dict[str, Any]:
        """Public view: masks the API key so the frontend never echoes it back."""
        d = asdict(self)
        if d.get("openrouter_api_key"):
            d["openrouter_api_key_set"] = True
            d["openrouter_api_key"] = ""
        else:
            d["openrouter_api_key_set"] = False
        return d


def get() -> Settings:
    """Returns cached settings, reloading only if the file changed on disk.

    Both the daemon and the sidecar can write to settings.json, so cache
    invalidation is keyed on st_mtime_ns rather than process-local state.
    """
    global _cache
    with _lock:
        try:
            mtime = SETTINGS_PATH.stat().st_mtime_ns
        except FileNotFoundError:
            mtime = 0
        if _cache is not None and _cache[0] == mtime:
            return _cache[1]
        loaded = Settings.load()
        _cache = (mtime, loaded)
        return loaded


def update(partial: dict[str, Any]) -> Settings:
    global _cache
    with _lock:
        current = Settings.load()
        # Pydantic-like guard: only allow known fields
        for k, v in partial.items():
            if hasattr(current, k):
                setattr(current, k, v)
        current.save()
        try:
            mtime = SETTINGS_PATH.stat().st_mtime_ns
        except FileNotFoundError:
            mtime = 0
        _cache = (mtime, current)
        return current


def invalidate_cache() -> None:
    """Force the next get() to reload from disk. Use after external writes."""
    global _cache
    with _lock:
        _cache = None
