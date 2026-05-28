from __future__ import annotations

import logging
import socket

from . import config, exporter, settings


log = logging.getLogger("voice.sidecar")


def auto_export_if_enabled() -> None:
    s = settings.get()
    if not s.auto_export_enabled or not s.export_path.strip():
        return
    try:
        exporter.export_all(s.export_path)
    except Exception:
        log.exception("auto export failed")


def poke_daemon_reload() -> None:
    sock_path = config.DATA_DIR / "daemon.sock"
    if not sock_path.exists():
        return
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            s.connect(str(sock_path))
            s.sendall(b"reload-settings")
            s.recv(64)
    except OSError:
        pass
