import os
from pathlib import Path

HOST = os.environ.get("VOICE_HOST", "127.0.0.1")
PORT = int(os.environ.get("VOICE_PORT", "17893"))

DATA_DIR = Path(os.environ.get("VOICE_DATA", str(Path.home() / ".voice")))
AUDIO_DIR = DATA_DIR / "audio"
DB_PATH = DATA_DIR / "notes.db"

DEFAULT_MODEL = os.environ.get("VOICE_MODEL", "base.en")
DEFAULT_COMPUTE_TYPE = os.environ.get("VOICE_COMPUTE_TYPE", "int8")
DEFAULT_DEVICE = os.environ.get("VOICE_DEVICE", "cpu")

DATA_DIR.mkdir(parents=True, exist_ok=True)
AUDIO_DIR.mkdir(parents=True, exist_ok=True)
