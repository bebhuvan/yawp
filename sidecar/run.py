"""Entry point for the Voice ASR sidecar service.

Run with:
    .venv/bin/python run.py

Or for development:
    .venv/bin/uvicorn app.main:app --reload --port 17893
"""

import uvicorn

from app import config

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=config.HOST,
        port=config.PORT,
        log_level="info",
    )
