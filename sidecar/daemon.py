"""Global hotkey daemon for the Voice app.

Activation modes (configurable in Settings or VOICE_HOTKEY_MODE env var):

  · toggle  — press hotkey once to start, again to stop. Auto-stops after
              VOICE_AUTO_STOP_MS of silence by default.
  · hold    — press and hold a key to record; release to stop. No auto-stop.

In either mode, two bindings:
  · Notes mode  — save the transcript as a note
  · Paste mode  — type the transcript into the focused window

Run independently of the sidecar (which must also be up):
    .venv/bin/python daemon.py
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import requests
import sounddevice as sd
import soundfile as sf
import webrtcvad
from pynput import keyboard

from app import config, logging_config

logging_config.configure(name="daemon")
log = logging.getLogger("voice.daemon")


SIDECAR = os.environ.get("VOICE_SIDECAR", "http://127.0.0.1:17893")
SAMPLE_RATE = 16_000
CHANNELS = 1
MIN_DURATION_S = 0.4

DEFAULT_HOTKEY_NOTES = "<ctrl>+<alt>+n"
DEFAULT_HOTKEY_PASTE = "<ctrl>+<alt>+v"
DEFAULT_HOLD_KEY_NOTES = "<menu>"
DEFAULT_HOLD_KEY_PASTE = "<ctrl_r>"

# Toggle-mode hotkey env overrides (pynput combo syntax).
HOTKEY_NOTES_ENV = os.environ.get("VOICE_HOTKEY_NOTES")
HOTKEY_PASTE_ENV = os.environ.get("VOICE_HOTKEY_PASTE")

# Hold-mode hotkeys: single keys only (e.g. "<ctrl_r>", "<menu>", "a").
# Hold mode has a long-press guard below: shortcuts such as Ctrl+R cancel the
# pending recording before it starts, while holding the key by itself records.
HOLD_KEY_NOTES_ENV = os.environ.get("VOICE_HOLD_KEY_NOTES")
HOLD_KEY_PASTE_ENV = os.environ.get("VOICE_HOLD_KEY_PASTE")
HOLD_ARM_DELAY_MS = int(os.environ.get("VOICE_HOLD_ARM_DELAY_MS", "260"))

_AUTO_STOP_MS_ENV = os.environ.get("VOICE_AUTO_STOP_MS")
# Live, mutable copy. Defaults to env override if set, else the sidecar's
# settings value at startup, else 1200ms. Refreshed by reload_settings().
AUTO_STOP_MS = int(_AUTO_STOP_MS_ENV) if _AUTO_STOP_MS_ENV else 1200
_AUDIO_FEEDBACK_ENV = os.environ.get("VOICE_AUDIO_FEEDBACK")
AUDIO_FEEDBACK_ENABLED = (
    (_AUDIO_FEEDBACK_ENV or "").strip().lower() in {"1", "true", "yes", "on"}
)
VAD_AGGRESSIVENESS = int(os.environ.get("VOICE_VAD_AGGRESSIVENESS", "2"))
VAD_FRAME_MS = 20
VAD_FRAME_SAMPLES = SAMPLE_RATE * VAD_FRAME_MS // 1000

HAS_NOTIFY = shutil.which("notify-send") is not None
HAS_CANBERRA = shutil.which("canberra-gtk-play") is not None
HAS_XDOTOOL = shutil.which("xdotool") is not None
HAS_WTYPE = shutil.which("wtype") is not None
HAS_DOTOOL = shutil.which("dotool") is not None
HAS_XCLIP = shutil.which("xclip") is not None
HAS_WLCOPY = shutil.which("wl-copy") is not None
HAS_WLPASTE = shutil.which("wl-paste") is not None

# Window classes/titles (lowercased, substring-matched) that paste with
# Ctrl+Shift+V rather than Ctrl+V. Zed reports the editor window class even
# when focus is inside its terminal; Codex/Claude CLIs interpret Ctrl+V as an
# image-paste command, so they need terminal-style paste.
TERMINAL_PASTE_HINTS = (
    "terminal", "konsole", "xterm", "alacritty", "kitty", "wezterm",
    "foot", "st-256color", "tilix", "rxvt", "urxvt", "hyper", "qterminal",
    "termite", "terminator", "zed", "codex", "claude",
)
COMMAND_SOCKET = config.DATA_DIR / "daemon.sock"
_CUE_EVENTS = {
    "start": "audio-volume-change",
    "stop": "complete",
    "error": "dialog-error",
}


class VadAutoStop:
    def __init__(self, silence_ms: int, aggressiveness: int) -> None:
        self.vad = webrtcvad.Vad(aggressiveness)
        self.required_silence_frames = max(1, silence_ms // VAD_FRAME_MS)
        self.silence_count = 0
        self.seen_speech = False
        self._buf = bytearray()
        self._fired = False

    def feed(self, audio_float32: np.ndarray) -> bool:
        if self._fired:
            return False
        int16 = (np.clip(audio_float32, -1.0, 1.0) * 32767).astype("<i2")
        self._buf.extend(int16.tobytes())
        frame_bytes = VAD_FRAME_SAMPLES * 2
        while len(self._buf) >= frame_bytes:
            frame = bytes(self._buf[:frame_bytes])
            del self._buf[:frame_bytes]
            try:
                speech = self.vad.is_speech(frame, SAMPLE_RATE)
            except Exception:
                speech = True
            if speech:
                self.seen_speech = True
                self.silence_count = 0
            elif self.seen_speech:
                self.silence_count += 1
                if self.silence_count >= self.required_silence_frames:
                    self._fired = True
                    return True
        return False


@dataclass
class State:
    recording: bool = False
    busy: bool = False
    mode: Optional[str] = None
    stream: Optional[sd.InputStream] = None
    frames: list[np.ndarray] = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock)
    auto_stop: Optional[VadAutoStop] = None


state = State()


def notify(msg: str, title: str = "Yawp") -> None:
    log.info("%s", msg)
    if HAS_NOTIFY:
        try:
            subprocess.run(
                ["notify-send", "-a", "Yawp", "-t", "2200", title, msg],
                check=False,
                timeout=2,
            )
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass


def play_cue(kind: str) -> None:
    if not AUDIO_FEEDBACK_ENABLED:
        return
    if HAS_CANBERRA:
        event_id = _CUE_EVENTS.get(kind, "bell")
        try:
            subprocess.Popen(  # noqa: S603
                ["canberra-gtk-play", "-i", event_id, "-d", "Yawp"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return
        except OSError:
            pass
    try:
        print("\a", end="", flush=True)
    except OSError:
        pass


def audio_callback(indata, frames, time_info, status):  # noqa: ARG001
    if status:
        print(f"[audio status] {status}", flush=True)
    if not state.recording:
        return
    state.frames.append(indata.copy())
    # Bind to a local: _finish_recording can null state.auto_stop on another
    # thread between the None-check and feed(), which would raise here.
    vad = state.auto_stop
    if vad is not None and vad.feed(indata[:, 0]):
        threading.Thread(target=_auto_stop_trigger, daemon=True).start()


def _auto_stop_trigger() -> None:
    notify("Detected end of speech.")
    with state.lock:
        if state.recording:
            _finish_recording()


def start_stream(use_vad: bool) -> None:
    s = fetch_settings()
    input_device = s.get("input_device")
    if not isinstance(input_device, int):
        input_device = None
    state.frames = []
    state.auto_stop = (
        VadAutoStop(AUTO_STOP_MS, VAD_AGGRESSIVENESS)
        if use_vad and AUTO_STOP_MS > 0
        else None
    )
    state.stream = sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=CHANNELS,
        dtype="float32",
        device=input_device,
        callback=audio_callback,
        blocksize=0,
    )
    state.stream.start()


def close_stream() -> np.ndarray:
    if state.stream is not None:
        try:
            state.stream.stop()
            state.stream.close()
        finally:
            state.stream = None
    if not state.frames:
        return np.zeros(0, dtype=np.float32)
    audio = np.concatenate(state.frames).flatten().astype(np.float32)
    state.frames = []
    return audio


def encode_wav(audio: np.ndarray) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, audio, SAMPLE_RATE, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def post_transcribe(wav_bytes: bytes, *, enrich: bool = True) -> dict:
    files = {"audio": ("audio.wav", wav_bytes, "audio/wav")}
    # enrich=False skips tag/todo extraction inside the request so paste-mode
    # users see typed text immediately, without waiting for OpenRouter.
    data = {"enrich": "true" if enrich else "false"}
    r = requests.post(
        f"{SIDECAR}/transcribe", files=files, data=data, timeout=600
    )
    r.raise_for_status()
    return r.json()


def delete_orphan_audio(audio_path: str | None) -> None:
    """Best-effort cleanup for paste-mode audio that won't be referenced by
    any saved note. Silent on failure."""
    if not audio_path:
        return
    try:
        from pathlib import Path

        Path(audio_path).unlink(missing_ok=True)
    except OSError:
        pass


def post_note(data: dict, mode: str) -> None:
    payload = {
        "title": data["title"],
        "transcript": data["text"],
        "language": data.get("language"),
        "model": data["model"],
        "mode": mode,
        "duration_sec": data["duration"],
        "audio_path": data.get("audio_path") or None,
        "tags": data.get("tags") or [],
        "todos": data.get("todos") or [],
        "smart_metadata": data.get("smart_metadata") or {},
    }
    r = requests.post(f"{SIDECAR}/notes", json=payload, timeout=30)
    r.raise_for_status()


def type_text(text: str) -> bool:
    tool = paste_tool()
    if tool is None:
        notify(paste_setup_message())
        return False

    if tool == "xdotool":
        cmd = ["xdotool", "type", "--clearmodifiers", "--delay", "1", text]
    elif tool == "wtype":
        cmd = ["wtype", text]
    else:
        cmd = ["dotool", "type", text]

    try:
        subprocess.run(cmd, check=True)
        return True
    except subprocess.CalledProcessError as e:
        notify(f"{tool} failed: {e}")
        return False


def _clipboard_available() -> bool:
    return HAS_XCLIP or HAS_WLCOPY


def _clipboard_get() -> Optional[bytes]:
    """Read the current clipboard so we can restore it after pasting."""
    try:
        if HAS_WLPASTE and os.environ.get("XDG_SESSION_TYPE", "").lower() == "wayland":
            out = subprocess.run(["wl-paste", "-n"], capture_output=True, timeout=1.0)
            return out.stdout if out.returncode == 0 else None
        if HAS_XCLIP:
            out = subprocess.run(
                ["xclip", "-selection", "clipboard", "-o"],
                capture_output=True, timeout=1.0,
            )
            return out.stdout if out.returncode == 0 else None
    except (subprocess.SubprocessError, OSError):
        return None
    return None


def _clipboard_set(data: bytes) -> bool:
    try:
        if HAS_WLCOPY and os.environ.get("XDG_SESSION_TYPE", "").lower() == "wayland":
            subprocess.run(["wl-copy"], input=data, timeout=1.0, check=True)
            return True
        if HAS_XCLIP:
            subprocess.run(
                ["xclip", "-selection", "clipboard"],
                input=data, timeout=1.0, check=True,
            )
            return True
    except (subprocess.SubprocessError, OSError):
        return False
    return False


def _active_window_prefers_terminal_paste() -> bool:
    """X11 only: best-effort check of the focused window's class so we can use
    Ctrl+Shift+V in terminals. Returns False (→ Ctrl+V) when unknown."""
    if not HAS_XDOTOOL:
        return False
    values: list[str] = []
    try:
        cls = subprocess.run(
            ["xdotool", "getactivewindow", "getwindowclassname"],
            capture_output=True, text=True, timeout=1.0,
        )
        title = subprocess.run(
            ["xdotool", "getactivewindow", "getwindowname"],
            capture_output=True, text=True, timeout=1.0,
        )
    except (subprocess.SubprocessError, OSError):
        return False
    values.extend([(cls.stdout or "").strip().lower(), (title.stdout or "").strip().lower()])
    return any(value and any(t in value for t in TERMINAL_PASTE_HINTS) for value in values)


def paste_via_clipboard(text: str) -> bool:
    """Set the clipboard to `text` and send the paste shortcut. Near-instant
    regardless of length, unlike char-by-char typing. Restores the previous
    clipboard afterward. Returns False (→ caller types instead) if unavailable."""
    if not _clipboard_available():
        return False
    wayland = os.environ.get("XDG_SESSION_TYPE", "").lower() == "wayland"
    saved = _clipboard_get()
    if not _clipboard_set(text.encode("utf-8")):
        return False
    time.sleep(0.06)  # let the new selection settle before pasting

    terminal = (not wayland) and _active_window_prefers_terminal_paste()
    try:
        if wayland and HAS_WTYPE:
            cmd = (
                ["wtype", "-M", "ctrl", "-M", "shift", "v", "-m", "shift", "-m", "ctrl"]
                if terminal
                else ["wtype", "-M", "ctrl", "v", "-m", "ctrl"]
            )
        elif HAS_XDOTOOL:
            cmd = ["xdotool", "key", "--clearmodifiers",
                   "ctrl+shift+v" if terminal else "ctrl+v"]
        else:
            return False
        subprocess.run(cmd, check=True, timeout=3)
    except (subprocess.SubprocessError, OSError):
        return False

    if saved is not None:
        def _restore() -> None:
            time.sleep(0.4)
            _clipboard_set(saved)
        threading.Thread(target=_restore, daemon=True).start()
    return True


def paste_tool() -> Optional[str]:
    session = os.environ.get("XDG_SESSION_TYPE", "").lower()
    if session == "wayland":
        if HAS_WTYPE:
            return "wtype"
        if HAS_DOTOOL:
            return "dotool"
        if HAS_XDOTOOL:
            return "xdotool"
        return None
    if HAS_XDOTOOL:
        return "xdotool"
    if HAS_WTYPE:
        return "wtype"
    if HAS_DOTOOL:
        return "dotool"
    return None


def paste_setup_message() -> str:
    session = os.environ.get("XDG_SESSION_TYPE", "").lower()
    if session == "wayland":
        return "Install wtype or dotool for Wayland paste mode."
    return "Install xdotool for paste mode."


def _start_recording(mode: str, use_vad: bool) -> None:
    """Caller holds state.lock."""
    if state.busy or state.recording:
        return
    try:
        state.mode = mode
        start_stream(use_vad=use_vad)
        state.recording = True
        play_cue("start")
    except Exception as e:
        state.recording = False
        state.mode = None
        play_cue("error")
        notify(f"Could not start mic: {e}")


def _finish_recording() -> None:
    """Caller holds state.lock."""
    if not state.recording:
        return
    state.recording = False
    state.busy = True
    mode = state.mode or "notes"
    state.mode = None
    audio = close_stream()
    state.auto_stop = None
    play_cue("stop")
    threading.Thread(target=_process, args=(audio, mode), daemon=True).start()


def _process(audio: np.ndarray, mode: str) -> None:
    try:
        duration = len(audio) / SAMPLE_RATE if len(audio) else 0
        if duration < MIN_DURATION_S:
            play_cue("error")
            notify("Too short — discarded.")
            return
        notify("Transcribing…")
        wav = encode_wav(audio)
        # Paste mode skips enrichment so the typed text appears the moment
        # ASR finishes — no waiting on OpenRouter for tags/todos.
        enrich = mode != "paste"
        try:
            data = post_transcribe(wav, enrich=enrich)
        except requests.RequestException as e:
            play_cue("error")
            notify(f"Transcription failed: {e}")
            return
        enrichment_status = data.get("enrichment_status") or {}
        log.info(
            "transcribed request_id=%s mode=%s duration=%.2fs chars=%d enrichment_ok=%s",
            data.get("request_id") or "-",
            mode,
            float(data.get("duration") or duration),
            len(data.get("text") or ""),
            enrichment_status.get("ok"),
        )
        text = (data.get("text") or "").strip()
        if not text:
            play_cue("error")
            notify("Couldn't hear anything.")
            return
        if mode == "paste":
            # Clipboard-paste is near-instant for long dictations; fall back to
            # typing char-by-char if it's disabled or no clipboard tool exists.
            use_clipboard = fetch_settings().get("paste_use_clipboard", True)
            ok = (use_clipboard and paste_via_clipboard(text)) or type_text(text)
            try:
                post_note(data, mode="paste")
            except requests.RequestException:
                # Note save failed — don't orphan the audio file on disk.
                delete_orphan_audio(data.get("audio_path"))
            if ok:
                preview = text[:48] + ("…" if len(text) > 48 else "")
                notify(f"Pasted: {preview}")
        else:
            try:
                post_note(data, mode="notes")
            except requests.RequestException as e:
                play_cue("error")
                notify(f"Saved transcript locally, but DB save failed: {e}")
                return
            preview = data.get("title") or text[:48]
            notify(f"Saved: {preview}")
    finally:
        state.busy = False


# --- Toggle mode ---------------------------------------------------------


def toggle_notes() -> None:
    with state.lock:
        if state.busy:
            return
        if state.recording:
            _finish_recording()
        else:
            _start_recording("notes", use_vad=True)
    if state.recording:
        notify(f"Recording → Notes (auto-stops after {AUTO_STOP_MS/1000:.1f}s silence)")


def toggle_paste() -> None:
    with state.lock:
        if state.busy:
            return
        if state.recording:
            _finish_recording()
        else:
            _start_recording("paste", use_vad=True)
    if state.recording:
        notify(f"Recording → Paste (auto-stops after {AUTO_STOP_MS/1000:.1f}s silence)")


def cancel_recording() -> None:
    with state.lock:
        if state.recording:
            state.recording = False
            state.mode = None
            state.auto_stop = None
            close_stream()
            play_cue("error")
            notify("Recording cancelled.")


# --- Hold mode -----------------------------------------------------------


def _parse_key(spec: str):
    """Parse a key spec like '<f9>' or 'a' into a pynput key/keycode."""
    spec = spec.strip().lower()
    if spec.startswith("<") and spec.endswith(">"):
        name = spec[1:-1]
        attr = getattr(keyboard.Key, name, None)
        if attr is not None:
            return attr
        return None
    if len(spec) == 1:
        return keyboard.KeyCode.from_char(spec)
    return None


class HoldController:
    """Long-press a single key to record; chords stay normal shortcuts.

    A raw modifier key is risky because users also hold it for shortcuts
    like Ctrl+R and Ctrl+Shift+R. So we arm recording only after a short solo
    hold. If any other key is pressed before or during recording, this path
    cancels instead of transcribing/pasting.
    """

    def __init__(self, key_to_mode: dict) -> None:
        # Map pynput key → "notes" | "paste"
        self.key_to_mode = key_to_mode
        self.pending_key = None
        self.pending_mode: Optional[str] = None
        self.pending_timer: Optional[threading.Timer] = None
        self.active_key = None
        self.lock = threading.Lock()

    def _matches(self, k1, k2) -> bool:
        return k1 == k2 or (
            hasattr(k1, "vk") and hasattr(k2, "vk") and k1.vk == k2.vk
        )

    def on_press(self, key) -> None:
        with self.lock:
            if self.active_key is not None:
                if not self._matches(key, self.active_key):
                    self._cancel_active_locked()
                return
            if self.pending_key is not None:
                if not self._matches(key, self.pending_key):
                    self._cancel_pending_locked()
                return
            for hold_key, mode in self.key_to_mode.items():
                if self._matches(key, hold_key):
                    self.pending_key = hold_key
                    self.pending_mode = mode
                    self.pending_timer = threading.Timer(
                        HOLD_ARM_DELAY_MS / 1000,
                        self._arm_if_still_pending,
                    )
                    self.pending_timer.daemon = True
                    self.pending_timer.start()
                    return

    def _arm_if_still_pending(self) -> None:
        with self.lock:
            if self.pending_key is None or self.pending_mode is None:
                return
            hold_key = self.pending_key
            mode = self.pending_mode
            self.pending_key = None
            self.pending_mode = None
            self.pending_timer = None
            self.active_key = hold_key
        with state.lock:
            _start_recording(mode, use_vad=False)
        if state.recording:
            notify(f"Recording → {mode.title()} (release to stop)")

    def _cancel_pending_locked(self) -> None:
        if self.pending_timer is not None:
            self.pending_timer.cancel()
        self.pending_key = None
        self.pending_mode = None
        self.pending_timer = None

    def _cancel_active_locked(self) -> None:
        self.active_key = None
        with state.lock:
            if state.recording:
                state.recording = False
                state.mode = None
                state.auto_stop = None
                close_stream()

    def on_release(self, key) -> None:
        finish = False
        with self.lock:
            if self.pending_key is not None and self._matches(key, self.pending_key):
                self._cancel_pending_locked()
                return
            if self.active_key is None:
                return
            if self._matches(key, self.active_key):
                self.active_key = None
                finish = True
        if finish:
            with state.lock:
                if state.recording:
                    _finish_recording()

# --- Settings ------------------------------------------------------------


def fetch_settings() -> dict:
    """Read settings from the sidecar. Returns {} on failure."""
    try:
        r = requests.get(f"{SIDECAR}/settings", timeout=2)
        r.raise_for_status()
        return r.json()
    except requests.RequestException:
        return {}


# Live cached settings + the active hotkey listener. Replacing the listener
# in place lets `reload-settings` switch between toggle and hold mode without
# restarting the daemon.
_active_listener: Optional[object] = None
_active_mode: Optional[str] = None
_active_bindings: Optional[tuple[str, str, str, str]] = None


def _bindings_from_settings(s: dict) -> tuple[str, str, str, str]:
    hotkey_notes = HOTKEY_NOTES_ENV or s.get("hotkey_notes") or DEFAULT_HOTKEY_NOTES
    hotkey_paste = HOTKEY_PASTE_ENV or s.get("hotkey_paste") or DEFAULT_HOTKEY_PASTE
    hold_key_notes = HOLD_KEY_NOTES_ENV or s.get("hold_key_notes") or DEFAULT_HOLD_KEY_NOTES
    hold_key_paste = HOLD_KEY_PASTE_ENV or s.get("hold_key_paste") or DEFAULT_HOLD_KEY_PASTE
    return hotkey_notes, hotkey_paste, hold_key_notes, hold_key_paste


def _build_listener(
    hotkey_mode: str,
    bindings: tuple[str, str, str, str],
):
    hotkey_notes, hotkey_paste, hold_key_notes, hold_key_paste = bindings
    if hotkey_mode == "hold":
        kn = _parse_key(hold_key_notes)
        kp = _parse_key(hold_key_paste)
        if kn is None or kp is None:
            log.error(
                "could not parse hold keys (notes=%r, paste=%r)",
                hold_key_notes,
                hold_key_paste,
            )
            return None
        ctl = HoldController({kn: "notes", kp: "paste"})
        return keyboard.Listener(on_press=ctl.on_press, on_release=ctl.on_release)
    return keyboard.GlobalHotKeys(
        {hotkey_notes: toggle_notes, hotkey_paste: toggle_paste}
    )


def _swap_listener(
    hotkey_mode: str,
    bindings: tuple[str, str, str, str],
) -> str:
    """Replace the active hotkey listener with one for the given mode.
    Returns the mode actually applied (in case parsing failed)."""
    global _active_listener, _active_mode, _active_bindings
    if (
        hotkey_mode == _active_mode
        and bindings == _active_bindings
        and _active_listener is not None
    ):
        return _active_mode
    new_listener = _build_listener(hotkey_mode, bindings)
    if new_listener is None:
        return _active_mode or "toggle"
    if _active_listener is not None:
        try:
            _active_listener.stop()  # type: ignore[attr-defined]
        except Exception:
            log.exception("stopping previous listener failed")
    new_listener.start()
    _active_listener = new_listener
    _active_mode = hotkey_mode
    _active_bindings = bindings
    return hotkey_mode


def reload_settings() -> str:
    """Re-read settings from the sidecar and swap the listener if the
    activation mode changed. Also refreshes AUTO_STOP_MS so silence-stop
    changes take effect on the next recording."""
    global AUTO_STOP_MS, AUDIO_FEEDBACK_ENABLED
    s = fetch_settings()
    mode_env = os.environ.get("VOICE_HOTKEY_MODE")
    desired = mode_env or s.get("hotkey_mode") or "toggle"
    bindings = _bindings_from_settings(s)

    # Env var wins. Otherwise honour what the sidecar says, falling back to
    # the previous in-memory value if the key is missing.
    if _AUTO_STOP_MS_ENV is None and "auto_stop_ms" in s:
        try:
            AUTO_STOP_MS = max(0, min(10_000, int(s["auto_stop_ms"])))
        except (TypeError, ValueError):
            pass
    if _AUDIO_FEEDBACK_ENV is None and "audio_feedback_enabled" in s:
        AUDIO_FEEDBACK_ENABLED = bool(s["audio_feedback_enabled"])

    applied = _swap_listener(desired, bindings)
    log.info(
        "settings reloaded (mode=%s, auto_stop_ms=%d, audio_feedback=%s, bindings=%s)",
        applied,
        AUTO_STOP_MS,
        AUDIO_FEEDBACK_ENABLED,
        bindings,
    )
    notify(f"Hotkeys reloaded — {applied} mode.")
    return applied


def command_status() -> str:
    with state.lock:
        if state.recording:
            return f"recording:{state.mode or 'unknown'}"
        if state.busy:
            return "busy"
    return "idle"


def command_status_json() -> str:
    hotkey_notes = hotkey_paste = hold_key_notes = hold_key_paste = None
    if _active_bindings is not None:
        hotkey_notes, hotkey_paste, hold_key_notes, hold_key_paste = _active_bindings
    with state.lock:
        if state.recording:
            state_value = "recording"
            recording_mode = state.mode
        elif state.busy:
            state_value = "busy"
            recording_mode = None
        else:
            state_value = "idle"
            recording_mode = None
    return json.dumps(
        {
            "state": state_value,
            "recording_mode": recording_mode,
            "hotkey_mode": _active_mode,
            "auto_stop_ms": AUTO_STOP_MS,
            "audio_feedback_enabled": AUDIO_FEEDBACK_ENABLED,
            "bindings": {
                "hotkey_notes": hotkey_notes,
                "hotkey_paste": hotkey_paste,
                "hold_key_notes": hold_key_notes,
                "hold_key_paste": hold_key_paste,
            },
            "paste_tool": paste_tool(),
        },
        sort_keys=True,
    )


def handle_command(command: str) -> str:
    command = command.strip()
    if command == "toggle-notes":
        toggle_notes()
        return command_status()
    if command == "toggle-paste":
        toggle_paste()
        return command_status()
    if command == "cancel":
        cancel_recording()
        return command_status()
    if command == "status":
        return command_status()
    if command == "status-json":
        return command_status_json()
    if command == "reload-settings":
        applied = reload_settings()
        return f"reloaded:{applied}"
    return "error:unknown-command"


def start_command_server() -> socket.socket:
    COMMAND_SOCKET.parent.mkdir(parents=True, exist_ok=True)
    COMMAND_SOCKET.unlink(missing_ok=True)
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(str(COMMAND_SOCKET))
    server.listen(8)

    def run() -> None:
        while True:
            try:
                conn, _ = server.accept()
            except OSError:
                return
            with conn:
                try:
                    data = conn.recv(128).decode("utf-8", errors="replace")
                    response = handle_command(data)
                    conn.sendall(response.encode("utf-8"))
                except Exception as e:
                    log.exception("command failed")
                    try:
                        conn.sendall(f"error:{e}".encode("utf-8"))
                    except OSError:
                        pass

    threading.Thread(target=run, daemon=True).start()
    return server


def send_command(command: str) -> int:
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.connect(str(COMMAND_SOCKET))
            client.sendall(command.encode("utf-8"))
            response = client.recv(512).decode("utf-8", errors="replace")
    except FileNotFoundError:
        print("Yawp daemon is not running.", file=sys.stderr)
        return 1
    except ConnectionRefusedError:
        print("Yawp daemon socket exists but is not accepting connections.", file=sys.stderr)
        return 1
    print(response)
    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Yawp global hotkey daemon")
    parser.add_argument(
        "--toggle-notes",
        action="store_true",
        help="Ask a running daemon to toggle note recording.",
    )
    parser.add_argument(
        "--toggle-paste",
        action="store_true",
        help="Ask a running daemon to toggle paste recording.",
    )
    parser.add_argument(
        "--cancel",
        action="store_true",
        help="Ask a running daemon to cancel the current recording.",
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Print running daemon status.",
    )
    parser.add_argument(
        "--status-json",
        action="store_true",
        help="Print detailed running daemon status as JSON.",
    )
    parser.add_argument(
        "--reload-settings",
        action="store_true",
        help="Ask a running daemon to reload hotkey settings.",
    )
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    commands = [
        ("toggle-notes", args.toggle_notes),
        ("toggle-paste", args.toggle_paste),
        ("cancel", args.cancel),
        ("status", args.status),
        ("status-json", args.status_json),
        ("reload-settings", args.reload_settings),
    ]
    requested = [name for name, enabled in commands if enabled]
    if len(requested) > 1:
        print("Choose only one command flag.", file=sys.stderr)
        return 2
    if requested:
        return send_command(requested[0])

    settings = fetch_settings()
    mode_env = os.environ.get("VOICE_HOTKEY_MODE")
    hotkey_mode = mode_env or settings.get("hotkey_mode") or "toggle"
    bindings = _bindings_from_settings(settings)
    hotkey_notes, hotkey_paste, hold_key_notes, hold_key_paste = bindings

    # Honour the user's silence threshold from the sidecar settings unless
    # the env var overrides it.
    global AUTO_STOP_MS, AUDIO_FEEDBACK_ENABLED
    if _AUTO_STOP_MS_ENV is None and "auto_stop_ms" in settings:
        try:
            AUTO_STOP_MS = max(0, min(10_000, int(settings["auto_stop_ms"])))
        except (TypeError, ValueError):
            pass
    if _AUDIO_FEEDBACK_ENV is None and "audio_feedback_enabled" in settings:
        AUDIO_FEEDBACK_ENABLED = bool(settings["audio_feedback_enabled"])

    command_server = start_command_server()

    print("Yawp — global hotkey daemon")
    print(f"  · Sidecar:    {SIDECAR}")
    print(f"  · Commands:   {COMMAND_SOCKET}")
    print(f"  · Mode:       {hotkey_mode}")
    if hotkey_mode == "toggle":
        print(f"  · Notes:      {hotkey_notes}")
        print(f"  · Paste:      {hotkey_paste}")
        if AUTO_STOP_MS > 0:
            print(
                f"  · Auto-stop:  after {AUTO_STOP_MS/1000:.1f}s of silence "
                f"(VAD level {VAD_AGGRESSIVENESS})"
            )
    else:
        print(f"  · Notes:      hold {hold_key_notes}")
        print(f"  · Paste:      hold {hold_key_paste}")
    print(f"  · Audio cue:  {'on' if AUDIO_FEEDBACK_ENABLED else 'off'}")

    try:
        h = requests.get(f"{SIDECAR}/health", timeout=3).json()
        if not h.get("model_ready"):
            print(
                "  · Note: model still loading — first hotkey will wait.",
                file=sys.stderr,
            )
    except Exception as e:
        print(f"  · WARNING: sidecar not reachable: {e}", file=sys.stderr)
        notify("Sidecar isn't running — hotkeys won't transcribe.")

    tool = paste_tool()
    if tool:
        print(f"  · Paste tool: {tool}")
    else:
        print(
            f"  · WARNING: {paste_setup_message()} Paste mode degrades to notes-only.",
            file=sys.stderr,
        )

    applied = _swap_listener(hotkey_mode, bindings)
    if _active_listener is None:
        print(
            f"ERROR: could not parse hold keys "
            f"(notes={hold_key_notes!r}, paste={hold_key_paste!r})",
            file=sys.stderr,
        )
        return 2
    if applied != hotkey_mode:
        print(f"  · Falling back to: {applied}", file=sys.stderr)

    try:
        # Block until interrupted. The listener runs in its own thread; the
        # main thread just waits.
        threading.Event().wait()
    except KeyboardInterrupt:
        print("\n[voice] stopping daemon")
        with state.lock:
            if state.recording:
                close_stream()
        if _active_listener is not None:
            try:
                _active_listener.stop()  # type: ignore[attr-defined]
            except Exception:
                pass
    finally:
        command_server.close()
        COMMAND_SOCKET.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
