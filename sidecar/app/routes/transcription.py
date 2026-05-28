from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from .. import transcription_service
from ..runtime import default_backend, run_in_asr
from ..schemas import EnrichmentStatus, TranscribeResponse


router = APIRouter()
log = logging.getLogger("voice.sidecar")


def transcribe_response(
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


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    audio: UploadFile = File(...),
    language: Optional[str] = Form(default=None),
    keep_audio: bool = Form(default=True),
    enrich: bool = Form(default=True),
) -> TranscribeResponse:
    request_id = uuid.uuid4().hex
    loop = asyncio.get_running_loop()
    try:
        result = await run_in_asr(
            transcription_service.transcribe_file,
            backend=default_backend,
            source=audio.file,
            filename=audio.filename or "audio.wav",
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
                "transcription enrichment failed request_id=%s error=%s",
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

    return transcribe_response(
        result,
        tags,
        todos_list,
        metadata,
        request_id=request_id,
        enrichment_status=enrichment_status,
    )
