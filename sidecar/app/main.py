from __future__ import annotations

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config, db, logging_config


logging_config.configure(name="sidecar")

from .diagnostics import runtime_report
from .events import router as events_router
from .routes import (
    ask,
    audio,
    capture,
    diagnostics,
    export,
    grammar,
    health,
    notes,
    polish,
    settings,
    transcription,
)
from .runtime import preload_model_once


log = logging.getLogger("voice.sidecar")
req_log = logging.getLogger("voice.req")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    preload_model_once()
    report = runtime_report()
    missing = [name for name, ok in report["imports"].items() if not ok]
    if missing:
        log.warning("missing runtime imports: %s", ", ".join(missing))
    log.info(
        "sidecar diagnostics: data_dir=%s db=%s tools=%s",
        report["data_dir"],
        report["db_path"],
        report["tools"],
    )
    purge_task = asyncio.create_task(_purge_loop())
    try:
        yield
    finally:
        purge_task.cancel()
        try:
            await purge_task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Yawp ASR Sidecar", version="0.2.0", lifespan=lifespan)


@app.middleware("http")
async def log_requests(request, call_next):
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        elapsed = (time.perf_counter() - start) * 1000
        req_log.exception(
            "%s %s -> exception after %.1fms",
            request.method,
            request.url.path,
            elapsed,
        )
        raise
    elapsed = (time.perf_counter() - start) * 1000
    if request.url.path in ("/health", "/settings") and response.status_code < 400:
        req_log.debug(
            "%s %s -> %d  %.1fms",
            request.method,
            request.url.path,
            response.status_code,
            elapsed,
        )
    else:
        req_log.info(
            "%s %s -> %d  %.1fms",
            request.method,
            request.url.path,
            response.status_code,
            elapsed,
        )
    return response


_DEFAULT_ORIGINS = [
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "http://localhost:1420",
    "http://127.0.0.1:1420",
]
_extra = os.environ.get("VOICE_EXTRA_ORIGINS", "").strip()
_allowed_origins = _DEFAULT_ORIGINS + [o.strip() for o in _extra.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


db.init_db()


_PURGE_AFTER_SECONDS = int(os.environ.get("VOICE_PURGE_AFTER_SECONDS", "60"))
_PURGE_INTERVAL_SECONDS = 30


def _purge_due_notes() -> None:
    from datetime import datetime, timedelta, timezone

    cutoff = (
        datetime.now(timezone.utc) - timedelta(seconds=_PURGE_AFTER_SECONDS)
    ).isoformat(timespec="milliseconds")
    with db.cursor() as conn:
        rows = conn.execute(
            "SELECT id FROM notes "
            "WHERE deleted_at IS NOT NULL AND deleted_at < ?",
            (cutoff,),
        ).fetchall()
    for r in rows:
        db.purge_note(r["id"])


async def _purge_loop() -> None:
    loop = asyncio.get_running_loop()
    while True:
        try:
            await loop.run_in_executor(None, _purge_due_notes)
        except Exception:
            log.exception("purge loop tick failed")
        await asyncio.sleep(_PURGE_INTERVAL_SECONDS)


for router in (
    health.router,
    settings.router,
    capture.router,
    transcription.router,
    notes.router,
    export.router,
    polish.router,
    grammar.router,
    audio.router,
    diagnostics.router,
    ask.router,
    events_router,
):
    app.include_router(router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=config.HOST,
        port=config.PORT,
        log_level="info",
    )
