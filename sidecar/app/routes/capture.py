from __future__ import annotations

import asyncio
import io
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Form, HTTPException

from .. import db, native_capture, settings, transcription_service
from ..events import broadcast_event
from ..runtime import default_backend, run_in_asr
from ..schemas import (
    CaptureStatusResponse,
    CaptureStopAndSaveRequest,
    EnrichmentStatus,
    TranscribeResponse,
)
from ..services import auto_export_if_enabled


router = APIRouter()
log = logging.getLogger("voice.sidecar")


def _transcribe_response(
    result,
    tags: list[str],
    todos_list: list[dict],
    metadata: dict,
    *,
    request_id: str,
    enrichment_status: EnrichmentStatus,
) -> TranscribeResponse:
    return TranscribeResponse(
        request_id=request_id,
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
        tags=tags,
        todos=todos_list,
        smart_metadata=metadata,
        enrichment_status=enrichment_status,
    )


async def _stop_and_transcribe(
    *,
    language: Optional[str],
    keep_audio: bool,
    enrich: bool,
):
    request_id = uuid.uuid4().hex
    try:
        wav, _duration = native_capture.stop_wav()
    except native_capture.CaptureError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if not wav:
        raise HTTPException(status_code=400, detail="empty recording")

    loop = asyncio.get_running_loop()
    try:
        result = await run_in_asr(
            transcription_service.transcribe_file,
            backend=default_backend,
            source=io.BytesIO(wav),
            filename="audio.wav",
            language=language,
            keep_audio=keep_audio,
            enrich=False,
        )
    except transcription_service.AudioInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    tags: list[str] = []
    todos_list: list[dict] = []
    metadata: dict = {}
    enrichment_status = EnrichmentStatus(requested=enrich, ok=not enrich)
    if enrich:
        try:
            tags, todos_list, metadata = await loop.run_in_executor(
                None,
                lambda: transcription_service.enrich_text(
                    result.text,
                    title=result.title,
                ),
            )
            enrichment_status = EnrichmentStatus(requested=True, ok=True)
        except Exception as e:
            log.warning(
                "capture enrichment failed request_id=%s error=%s",
                request_id,
                type(e).__name__,
                exc_info=True,
            )
            enrichment_status = EnrichmentStatus(
                requested=True,
                ok=False,
                code=type(e).__name__,
                message=str(e)[:200] or "enrichment failed",
            )

    return result, tags, todos_list, metadata, request_id, enrichment_status


@router.get("/capture/status", response_model=CaptureStatusResponse)
def capture_status() -> CaptureStatusResponse:
    return CaptureStatusResponse(recording=native_capture.is_recording())


@router.post("/capture/start", response_model=CaptureStatusResponse)
def capture_start() -> CaptureStatusResponse:
    try:
        native_capture.start()
    except native_capture.CaptureError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return CaptureStatusResponse(recording=True)


@router.post("/capture/cancel", response_model=CaptureStatusResponse)
def capture_cancel() -> CaptureStatusResponse:
    native_capture.cancel()
    return CaptureStatusResponse(recording=False)


@router.post("/capture/stop", response_model=TranscribeResponse)
async def capture_stop(
    language: Optional[str] = Form(default=None),
    keep_audio: bool = Form(default=True),
    enrich: bool = Form(default=True),
) -> TranscribeResponse:
    result, tags, todos_list, metadata, request_id, enrichment_status = await _stop_and_transcribe(
        language=language,
        keep_audio=keep_audio,
        enrich=enrich,
    )
    return _transcribe_response(
        result,
        tags,
        todos_list,
        metadata,
        request_id=request_id,
        enrichment_status=enrichment_status,
    )


@router.post("/capture/stop-and-save")
async def capture_stop_and_save(req: CaptureStopAndSaveRequest) -> dict:
    result, tags, todos_list, metadata, request_id, enrichment_status = await _stop_and_transcribe(
        language=req.language,
        keep_audio=req.keep_audio,
        enrich=req.enrich,
    )
    if not enrichment_status.ok:
        log.info(
            "saving note without enrichment request_id=%s reason=%s",
            request_id,
            enrichment_status.code,
        )
    if not result.text.strip():
        raise HTTPException(status_code=400, detail="empty transcript")

    s = settings.get()
    note = db.create_note(
        title=result.title,
        transcript=result.text,
        language=result.language,
        model=result.model,
        mode=req.mode,
        duration_sec=result.duration,
        audio_path=result.audio_path or None,
        tags=tags,
        todos=todos_list,
        smart_metadata=metadata,
        auto_folder_from_metadata=s.auto_organize_enabled,
        auto_folder_min_confidence=s.auto_organize_min_confidence,
    )
    auto_export_if_enabled()
    payload = note.to_dict()
    if note.folder_id:
        folder = db.get_folder(note.folder_id)
        if folder:
            broadcast_event("folder.updated", folder.to_dict())
    broadcast_event("note.created", payload)
    return payload
