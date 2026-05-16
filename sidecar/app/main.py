from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import (
    FastAPI,
    File,
    Form,
    HTTPException,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import (
    asr,
    cleanup,
    config,
    db,
    exporter,
    grammar,
    logging_config,
    openrouter,
    settings,
    transcription_service,
)

# Initialise centralized logging BEFORE anything that creates loggers.
logging_config.configure(name="sidecar")
from .backends.whisper import FasterWhisperBackend

log = logging.getLogger("voice.sidecar")
req_log = logging.getLogger("voice.req")

app = FastAPI(title="Yawp ASR Sidecar", version="0.2.0")


@app.middleware("http")
async def log_requests(request, call_next):
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        elapsed = (time.perf_counter() - start) * 1000
        req_log.exception(
            "%s %s → exception after %.1fms",
            request.method,
            request.url.path,
            elapsed,
        )
        raise
    elapsed = (time.perf_counter() - start) * 1000
    # Quiet polls — health/settings polled every few seconds by the UI.
    if request.url.path in ("/health", "/settings") and response.status_code < 400:
        req_log.debug(
            "%s %s → %d  %.1fms",
            request.method,
            request.url.path,
            response.status_code,
            elapsed,
        )
    else:
        req_log.info(
            "%s %s → %d  %.1fms",
            request.method,
            request.url.path,
            response.status_code,
            elapsed,
        )
    return response

# Restrict to the local Tauri webview and Vite dev server. The sidecar binds
# to 127.0.0.1 already, but a wildcard origin lets any browser tab on the box
# read every note. Tauri 2 uses tauri://localhost on macOS/Linux and
# http://tauri.localhost on Windows.
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

_default_backend = FasterWhisperBackend(model_name=settings.get().asr_model)
asr.register(_default_backend)


def _preload_in_bg() -> None:
    try:
        log.info("Preloading model %s in the background…", _default_backend.model_name)
        _default_backend.preload()
        log.info("Model ready.")
    except Exception:
        log.exception("Model preload failed; will retry on first /transcribe.")


threading.Thread(target=_preload_in_bg, daemon=True).start()

_grammar = grammar.Grammar()

# Single-worker executor pinned to the model. faster-whisper is not safe under
# concurrent decodes, and sharing the default executor with /stream ticks
# means /transcribe queues behind partial passes (and vice versa). One worker
# guarantees serialised access without starving anything else on the loop.
_asr_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="yawp-asr")


def _run_in_asr(fn, *args, **kwargs):
    loop = asyncio.get_event_loop()
    return loop.run_in_executor(_asr_executor, lambda: fn(*args, **kwargs))


# ----- Schemas --------------------------------------------------------------


class HealthResponse(BaseModel):
    ok: bool
    backends: list[str]
    default_model: str
    model_ready: bool
    db_path: str
    notes_count: int
    openrouter_configured: bool


class TranscribeResponse(BaseModel):
    text: str  # cleaned (if cleanup_enabled) else raw
    text_raw: str  # always the model's raw output
    title: str
    language: str
    duration: float
    model: str
    segments: list[dict]
    audio_path: str
    tags: list[str]
    todos: list[dict]


class CreateNoteRequest(BaseModel):
    title: str
    transcript: str
    language: Optional[str] = None
    model: str
    mode: str = Field(pattern="^(notes|paste)$")
    duration_sec: float = Field(ge=0)
    audio_path: Optional[str] = None
    tags: Optional[list[str]] = None
    todos: Optional[list[dict]] = None


class UpdateNoteRequest(BaseModel):
    title: Optional[str] = None
    transcript: Optional[str] = None
    tags: Optional[list[str]] = None
    todos: Optional[list[dict]] = None


class ExportRequest(BaseModel):
    dest: str


class PolishRequest(BaseModel):
    text: str
    note_id: Optional[str] = None  # if set, persist polished text back


class PolishResponse(BaseModel):
    text: str
    source: str  # "openrouter" | "cleanup-only"


class GrammarRequest(BaseModel):
    text: str


class GrammarApplyRequest(BaseModel):
    text: str
    note_id: Optional[str] = None


class SettingsUpdate(BaseModel):
    asr_model: Optional[str] = None
    cleanup_enabled: Optional[bool] = None
    voice_commands_enabled: Optional[bool] = None
    live_transcription_enabled: Optional[bool] = None
    auto_tag_enabled: Optional[bool] = None
    extract_todos_enabled: Optional[bool] = None
    openrouter_api_key: Optional[str] = None
    openrouter_model: Optional[str] = None
    max_tags: Optional[int] = Field(default=None, ge=0, le=12)
    hotkey_mode: Optional[str] = Field(default=None, pattern="^(toggle|hold)$")
    export_path: Optional[str] = None
    auto_export_enabled: Optional[bool] = None


# ----- Health & settings ----------------------------------------------------


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    s = settings.get()
    return HealthResponse(
        ok=True,
        backends=asr.available(),
        default_model=_default_backend.name,
        model_ready=_default_backend.loaded,
        db_path=str(config.DB_PATH),
        notes_count=db.count_notes(),
        openrouter_configured=bool(s.openrouter_api_key),
    )


@app.get("/settings")
def get_settings() -> dict:
    return settings.get().to_safe_dict()


@app.put("/settings")
def put_settings(req: SettingsUpdate) -> dict:
    incoming = {k: v for k, v in req.model_dump(exclude_none=True).items()}
    # Convention: an empty string clears the api key; missing → no change.
    settings.update(incoming)
    return settings.get().to_safe_dict()


# ----- Transcribe -----------------------------------------------------------


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    audio: UploadFile = File(...),
    language: Optional[str] = Form(default=None),
    keep_audio: bool = Form(default=True),
) -> TranscribeResponse:
    try:
        result = await _run_in_asr(
            transcription_service.transcribe_file,
            backend=_default_backend,
            source=audio.file,
            filename=audio.filename or "audio.wav",
            language=language,
            keep_audio=keep_audio,
        )
    except Exception as e:
        log.exception("Transcription failed")
        raise HTTPException(status_code=500, detail=str(e))

    return TranscribeResponse(
        text=result.text,
        text_raw=result.text_raw,
        title=result.title,
        language=result.language,
        duration=result.duration,
        model=result.model,
        segments=[
            {"start": segment.start, "end": segment.end, "text": segment.text}
            for segment in result.segments
        ],
        audio_path=result.audio_path,
        tags=result.tags,
        todos=result.todos,
    )


# ----- Notes CRUD -----------------------------------------------------------


@app.get("/notes")
def list_notes_endpoint() -> dict:
    return {"notes": [n.to_dict() for n in db.list_notes()]}


@app.get("/notes/{note_id}")
def get_note_endpoint(note_id: str) -> dict:
    note = db.get_note(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="not found")
    return note.to_dict()


@app.post("/notes", status_code=201)
def create_note_endpoint(req: CreateNoteRequest) -> dict:
    note = db.create_note(
        title=req.title,
        transcript=req.transcript,
        language=req.language,
        model=req.model,
        mode=req.mode,
        duration_sec=req.duration_sec,
        audio_path=req.audio_path,
        tags=req.tags or [],
        todos=req.todos or [],
    )
    _auto_export_if_enabled()
    return note.to_dict()


@app.patch("/notes/{note_id}")
def update_note_endpoint(note_id: str, req: UpdateNoteRequest) -> dict:
    note = db.update_note(
        note_id,
        title=req.title,
        transcript=req.transcript,
        tags=req.tags,
        todos=req.todos,
    )
    if not note:
        raise HTTPException(status_code=404, detail="not found")
    _auto_export_if_enabled()
    return note.to_dict()


@app.post("/notes/{note_id}/extract-todos")
def extract_todos_endpoint(note_id: str) -> dict:
    """Manually re-extract action items for an existing note."""
    s = settings.get()
    note = db.get_note(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="not found")
    if not s.openrouter_api_key:
        raise HTTPException(
            status_code=400,
            detail="OpenRouter key not configured",
        )
    extracted = todos_mod.extract(
        note.transcript,
        api_key=s.openrouter_api_key,
        model=s.openrouter_model,
    )
    updated = db.update_note(note_id, todos=extracted)
    _auto_export_if_enabled()
    return updated.to_dict() if updated else {}


@app.post("/export/markdown")
def export_endpoint(req: ExportRequest) -> dict:
    dest = req.dest.strip()
    if not dest:
        raise HTTPException(status_code=400, detail="empty dest")
    try:
        return exporter.export_all(dest)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except OSError as e:
        raise HTTPException(status_code=400, detail=f"write failed: {e}")


@app.delete("/notes/{note_id}", status_code=204)
def delete_note_endpoint(note_id: str) -> None:
    ok = db.delete_note(note_id)
    if not ok:
        raise HTTPException(status_code=404, detail="not found")
    _auto_export_if_enabled()
    return None


def _auto_export_if_enabled() -> None:
    s = settings.get()
    if not s.auto_export_enabled or not s.export_path.strip():
        return
    try:
        exporter.export_all(s.export_path)
    except Exception:
        log.exception("auto export failed")


# ----- Search ---------------------------------------------------------------


@app.get("/search")
def search_endpoint(q: str = "") -> dict:
    q = (q or "").strip()
    if not q:
        return {"query": q, "notes": []}
    notes = db.search_notes(q)
    return {"query": q, "notes": [n.to_dict() for n in notes]}


# ----- Polish (OpenRouter) --------------------------------------------------


@app.post("/polish", response_model=PolishResponse)
def polish_endpoint(req: PolishRequest) -> PolishResponse:
    s = settings.get()
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="empty text")

    if not s.openrouter_api_key:
        # No key configured — fall back to Tier 1 cleanup only.
        return PolishResponse(text=cleanup.clean(text), source="cleanup-only")

    try:
        polished = openrouter.polish_text(
            api_key=s.openrouter_api_key,
            model=s.openrouter_model,
            text=text,
        )
    except openrouter.OpenRouterError as e:
        # Surface as 502 with a useful message rather than crashing.
        log.warning("OpenRouter polish failed: %s", e)
        raise HTTPException(status_code=502, detail=f"openrouter: {e}")
    except Exception as e:  # pragma: no cover — defensive
        log.exception("polish endpoint crashed")
        raise HTTPException(status_code=500, detail=f"polish: {e}")

    if req.note_id:
        db.update_note(req.note_id, transcript=polished)
        _auto_export_if_enabled()

    return PolishResponse(text=polished, source="openrouter")


# ----- Audio ----------------------------------------------------------------


# ----- Grammar (LanguageTool, Tier 2) ---------------------------------------


@app.post("/grammar")
def grammar_check_endpoint(req: GrammarRequest) -> dict:
    text = (req.text or "").strip()
    if not text:
        return {"issues": []}
    try:
        issues = _grammar.check(text)
    except Exception as e:
        log.exception("grammar check failed")
        raise HTTPException(
            status_code=503,
            detail=f"grammar service unavailable: {e}",
        )
    return {"issues": [i.to_dict() for i in issues]}


@app.post("/grammar/apply")
def grammar_apply_endpoint(req: GrammarApplyRequest) -> dict:
    text = (req.text or "").strip()
    if not text:
        return {"text": text}
    try:
        corrected = _grammar.apply(text)
    except Exception as e:
        log.exception("grammar apply failed")
        raise HTTPException(
            status_code=503,
            detail=f"grammar service unavailable: {e}",
        )
    if req.note_id:
        db.update_note(req.note_id, transcript=corrected)
        _auto_export_if_enabled()
    return {"text": corrected}


@app.get("/audio/{filename}")
def get_audio(filename: str) -> FileResponse:
    # Reject anything that smells like a traversal before resolving — paths with
    # separators or '..' shouldn't reach the filesystem at all.
    if "/" in filename or "\\" in filename or filename.startswith(".."):
        raise HTTPException(status_code=400, detail="bad path")
    audio_root = config.AUDIO_DIR.resolve()
    target = (config.AUDIO_DIR / filename).resolve()
    try:
        target.relative_to(audio_root)
    except ValueError:
        raise HTTPException(status_code=400, detail="bad path")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(str(target))


# ----- Streaming partial transcription --------------------------------------


# How often to run Whisper on the in-flight buffer. Lower = livelier text but
# more CPU. With small.en on ~3× rtf, 1.5s feels good.
STREAM_TICK_SECONDS = 1.5
# Skip the first tick (text is meaningless on <1s of audio).
STREAM_WARMUP_SECONDS = 1.0


def _resample_to_16k(audio: np.ndarray, src_rate: int) -> np.ndarray:
    if src_rate == 16000:
        return audio.astype(np.float32, copy=False)
    ratio = 16000.0 / src_rate
    n_dst = int(len(audio) * ratio)
    if n_dst <= 0:
        return np.zeros(0, dtype=np.float32)
    idx = np.linspace(0, len(audio) - 1, n_dst)
    return np.interp(idx, np.arange(len(audio)), audio).astype(np.float32)


@app.websocket("/stream")
async def stream(websocket: WebSocket) -> None:
    """Live partial transcripts.

    Protocol (client → server):
      · TEXT frame  `{"type":"config","sample_rate":48000}` — once at start.
      · BINARY frames — raw Float32 PCM at the configured sample rate.
      · TEXT frame  `{"type":"stop"}` — optional; close also works.

    Server → client:
      · `{"type":"ready"}` immediately after accept.
      · `{"type":"partial","text":"…"}` every ~1.5 s after warmup.
      · `{"type":"final","text":"…"}` once on stop (best-quality pass on full
        buffer). Title/tags are not produced here — use POST /transcribe with
        the WAV blob for the canonical final result.
    """
    await websocket.accept()
    await websocket.send_json({"type": "ready"})

    sample_rate = 16000
    chunks: list[np.ndarray] = []
    chunks_lock = threading.Lock()
    stopped = False
    loop = asyncio.get_event_loop()

    s = settings.get()
    initial_prompt = cleanup.WHISPER_INITIAL_PROMPT if s.cleanup_enabled else None

    async def transcribe_loop() -> None:
        nonlocal stopped
        await asyncio.sleep(STREAM_WARMUP_SECONDS)
        while not stopped:
            await asyncio.sleep(STREAM_TICK_SECONDS)
            if stopped:
                break
            with chunks_lock:
                if not chunks:
                    continue
                # Concatenate everything received so far. For dictation clips
                # under ~60s this is a few hundred KB — fine.
                concat = np.concatenate(chunks)
                sr = sample_rate
            try:
                resampled = await loop.run_in_executor(
                    None, _resample_to_16k, concat, sr
                )
                result = await _run_in_asr(
                    _default_backend.transcribe,
                    resampled,
                    initial_prompt=initial_prompt,
                )
            except Exception as e:
                log.exception("stream partial failed")
                try:
                    await websocket.send_json({"type": "error", "detail": str(e)})
                except Exception:
                    pass
                continue
            text = result.text.strip()
            if s.cleanup_enabled:
                text = cleanup.clean(text)
            try:
                await websocket.send_json({"type": "partial", "text": text})
            except Exception:
                # Socket closed mid-send; bail out.
                stopped = True
                return

    worker = asyncio.create_task(transcribe_loop())

    try:
        while True:
            msg = await websocket.receive()
            mtype = msg.get("type")
            if mtype == "websocket.disconnect":
                break
            text_frame = msg.get("text")
            if text_frame:
                try:
                    data = json.loads(text_frame)
                except json.JSONDecodeError:
                    continue
                kind = data.get("type")
                if kind == "config":
                    sr = int(data.get("sample_rate", 16000))
                    sample_rate = sr if sr > 0 else 16000
                elif kind == "stop":
                    break
                continue
            payload = msg.get("bytes")
            if payload:
                # Float32 little-endian PCM
                buf = np.frombuffer(payload, dtype=np.float32)
                if buf.size:
                    with chunks_lock:
                        chunks.append(buf)
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("/stream loop error")
    finally:
        stopped = True
        worker.cancel()
        try:
            await worker
        except (asyncio.CancelledError, Exception):
            pass

        # Final, best-effort transcription of the full buffer.
        try:
            with chunks_lock:
                full = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)
                sr = sample_rate
            if full.size:
                resampled = await loop.run_in_executor(
                    None, _resample_to_16k, full, sr
                )
                result = await _run_in_asr(
                    _default_backend.transcribe,
                    resampled,
                    initial_prompt=initial_prompt,
                )
                final_text = result.text.strip()
                if s.cleanup_enabled:
                    final_text = cleanup.clean(final_text)
                try:
                    await websocket.send_json({"type": "final", "text": final_text})
                except Exception:
                    pass
        except Exception:
            log.exception("stream final transcription failed")

        try:
            await websocket.close()
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=config.HOST,
        port=config.PORT,
        log_level="info",
    )
