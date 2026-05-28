from __future__ import annotations

import importlib.util
import json
import shutil
import socket
from pathlib import Path
from typing import Any

from . import config, db, settings


RUNTIME_IMPORTS = (
    "fastapi",
    "faster_whisper",
    "numpy",
    "onnx_asr",
    "onnxruntime",
    "pydantic",
    "pynput",
    "requests",
    "sounddevice",
    "soundfile",
    "uvicorn",
    "webrtcvad",
)


def runtime_report() -> dict:
    s = settings.get()
    tools = _tools()
    return {
        "host": config.HOST,
        "port": config.PORT,
        "data_dir": str(config.DATA_DIR),
        "audio_dir": str(config.AUDIO_DIR),
        "db_path": str(config.DB_PATH),
        "imports": {name: importlib.util.find_spec(name) is not None for name in RUNTIME_IMPORTS},
        "tools": tools,
        "paste": _paste_report(tools),
        "daemon": _daemon_report(),
        "database": _database_report(),
        "model": _model_report(s),
        "settings": {
            "asr_model": s.asr_model,
            "input_device": s.input_device,
            "hotkey_mode": s.hotkey_mode,
            "hotkey_notes": s.hotkey_notes,
            "hotkey_paste": s.hotkey_paste,
            "hold_key_notes": s.hold_key_notes,
            "hold_key_paste": s.hold_key_paste,
            "auto_stop_ms": s.auto_stop_ms,
            "audio_feedback_enabled": s.audio_feedback_enabled,
            "auto_organize_enabled": s.auto_organize_enabled,
            "auto_organize_min_confidence": s.auto_organize_min_confidence,
            "openrouter_configured": bool(s.openrouter_api_key),
        },
        "microphone": _microphone_report(),
        "port_available": _port_available(config.HOST, config.PORT),
    }


def _tools() -> dict[str, bool]:
    return {
        "xdotool": shutil.which("xdotool") is not None,
        "wtype": shutil.which("wtype") is not None,
        "dotool": shutil.which("dotool") is not None,
        "notify-send": shutil.which("notify-send") is not None,
        "canberra-gtk-play": shutil.which("canberra-gtk-play") is not None,
    }


def _paste_report(tools: dict[str, bool]) -> dict[str, Any]:
    import os

    session = os.environ.get("XDG_SESSION_TYPE", "").lower() or "unknown"
    if session == "wayland":
        selected = "wtype" if tools["wtype"] else "dotool" if tools["dotool"] else None
    elif session == "x11":
        selected = "xdotool" if tools["xdotool"] else None
    else:
        selected = (
            "xdotool"
            if tools["xdotool"]
            else "wtype"
            if tools["wtype"]
            else "dotool"
            if tools["dotool"]
            else None
        )
    return {
        "session": session,
        "selected_tool": selected,
        "ready": selected is not None,
    }


def _daemon_report() -> dict[str, Any]:
    sock_path = config.DATA_DIR / "daemon.sock"
    if not sock_path.exists():
        return {"running": False, "socket": str(sock_path), "status": "not-running"}
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(0.4)
            client.connect(str(sock_path))
            client.sendall(b"status-json")
            status = client.recv(2048).decode("utf-8", errors="replace")
        try:
            detail = json.loads(status)
        except json.JSONDecodeError:
            detail = None
        return {
            "running": True,
            "socket": str(sock_path),
            "status": (detail or {}).get("state") or status or "unknown",
            "detail": detail,
        }
    except OSError as e:
        return {
            "running": False,
            "socket": str(sock_path),
            "status": "unreachable",
            "error": str(e),
        }


def _database_report() -> dict[str, Any]:
    try:
        return {
            "ready": True,
            "path": str(config.DB_PATH),
            "notes_count": db.count_notes(),
        }
    except Exception as e:
        return {
            "ready": False,
            "path": str(config.DB_PATH),
            "error": str(e),
        }


def _model_report(s: settings.Settings) -> dict[str, Any]:
    try:
        from . import runtime
        from .backends import parakeet

        backend = runtime.default_backend
        active_model = getattr(backend, "model_name", backend.name)
        report: dict[str, Any] = {
            "configured": s.asr_model,
            "active_backend": backend.name,
            "active_model": active_model,
            "loaded": bool(getattr(backend, "loaded", False)),
            "restart_required": active_model != s.asr_model,
        }
        if hasattr(backend, "device"):
            report["device"] = getattr(backend, "device")
        if hasattr(backend, "compute_type"):
            report["compute_type"] = getattr(backend, "compute_type")
        if s.asr_model == parakeet.MODEL_ID:
            candidates = [
                str(p) for p in parakeet._default_model_dirs()  # noqa: SLF001
            ]
            ready_paths = [
                path for path in candidates if parakeet._onnx_asr_compatible(Path(path))  # noqa: SLF001
            ]
            report["parakeet_candidates"] = candidates
            report["parakeet_ready"] = bool(ready_paths)
            if ready_paths:
                report["parakeet_path"] = ready_paths[0]
        return report
    except Exception as e:
        return {
            "configured": s.asr_model,
            "active_backend": "unknown",
            "loaded": False,
            "restart_required": False,
            "error": str(e),
        }


def _microphone_report() -> dict[str, Any]:
    s = settings.get()
    if importlib.util.find_spec("sounddevice") is None:
        return {"available": False, "error": "sounddevice is not installed"}
    try:
        import sounddevice as sd

        device = sd.query_devices(s.input_device, kind="input") if s.input_device is not None else sd.query_devices(kind="input")
        return {
            "available": True,
            "name": device.get("name"),
            "channels": device.get("max_input_channels"),
            "default_samplerate": device.get("default_samplerate"),
            "selected_index": s.input_device,
        }
    except Exception as e:
        return {"available": False, "error": str(e)}


def _port_available(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((host, port))
        except OSError:
            return False
    return True
