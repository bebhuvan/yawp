"""Centralized logging for the sidecar + daemon.

Writes to both stdout (console) and a rotating file at ~/.voice/logs/<name>.log.
Modules grab a logger via `logging.getLogger("voice.<area>")`.
"""

from __future__ import annotations

import logging
import logging.handlers
from pathlib import Path
from typing import Optional

from . import config


LOG_DIR = config.DATA_DIR / "logs"
DEFAULT_LEVEL = logging.INFO


class _MillisFormatter(logging.Formatter):
    """ISO-like timestamps with milliseconds and a short level field."""

    def format(self, record: logging.LogRecord) -> str:  # noqa: A003
        record.shortlevel = record.levelname[:4]
        return super().format(record)


_FORMAT = "%(asctime)s.%(msecs)03d %(shortlevel)-4s %(name)-22s %(message)s"
_DATEFMT = "%Y-%m-%dT%H:%M:%S"


_configured = False


def configure(name: str = "sidecar", level: Optional[int] = None) -> None:
    """Initialise logging. Call once at process start.

    *name* controls the log filename: `~/.voice/logs/{name}.log`.
    """
    global _configured
    if _configured:
        return
    _configured = True

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / f"{name}.log"

    root = logging.getLogger()
    root.setLevel(level or DEFAULT_LEVEL)
    # Clear handlers set by basicConfig elsewhere
    for h in list(root.handlers):
        root.removeHandler(h)

    fmt = _MillisFormatter(_FORMAT, datefmt=_DATEFMT)

    # Stdout — for `tail -f` / running in a terminal
    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    root.addHandler(sh)

    # Rotating file — survives crashes, useful when daemon runs detached
    fh = logging.handlers.RotatingFileHandler(
        log_path,
        maxBytes=5 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8",
    )
    fh.setFormatter(fmt)
    root.addHandler(fh)

    # Quiet noisy libraries
    for noisy in ("urllib3", "httpcore", "httpx", "huggingface_hub"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    logging.getLogger("voice.config").info(
        "logging configured: file=%s level=%s",
        log_path,
        logging.getLevelName(root.level),
    )
