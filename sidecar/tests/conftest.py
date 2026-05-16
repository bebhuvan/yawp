"""Test fixtures.

Points the sidecar at a throw-away data directory so tests never touch the
user's real ~/.voice/ database or audio files.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest


@pytest.fixture(scope="session", autouse=True)
def _isolated_voice_dir():
    tmp = tempfile.mkdtemp(prefix="yawp-tests-")
    os.environ["VOICE_DATA"] = tmp
    yield Path(tmp)


@pytest.fixture
def fresh_db(_isolated_voice_dir):
    """Return the db module after pointing it at a fresh DB file. Each test
    that asserts row counts should request this fixture."""
    from app import config, db

    db_path = _isolated_voice_dir / f"notes-{os.urandom(4).hex()}.db"
    config.DB_PATH = db_path
    config.AUDIO_DIR = _isolated_voice_dir / "audio"
    config.AUDIO_DIR.mkdir(exist_ok=True)

    # Drop the thread-local connection cached from any previous test so the
    # next db.cursor() opens against the new DB_PATH.
    cached = getattr(db._local, "conn", None)
    if cached is not None:
        try:
            cached.close()
        except Exception:
            pass
        db._local.conn = None

    db.init_db()
    return db
