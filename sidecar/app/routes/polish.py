from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from .. import cleanup, db, openrouter, settings
from ..events import broadcast_event
from ..schemas import PolishRequest, PolishResponse
from ..services import auto_export_if_enabled


router = APIRouter()
log = logging.getLogger("voice.sidecar")


@router.post("/polish", response_model=PolishResponse)
def polish_endpoint(req: PolishRequest) -> PolishResponse:
    s = settings.get()
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="empty text")

    if not s.openrouter_api_key:
        polished = cleanup.clean(text)
        source = "cleanup-only"
    else:
        try:
            polished = openrouter.polish_text(
                api_key=s.openrouter_api_key,
                model=s.openrouter_model,
                text=text,
            )
        except openrouter.OpenRouterError as e:
            log.warning("OpenRouter polish failed: %s", e)
            raise HTTPException(status_code=502, detail=f"openrouter: {e}")
        except Exception as e:
            log.exception("polish endpoint crashed")
            raise HTTPException(status_code=500, detail=f"polish: {e}")
        source = "openrouter"

    if req.note_id:
        note = db.update_note(req.note_id, transcript=polished)
        if not note:
            raise HTTPException(status_code=404, detail="not found")
        auto_export_if_enabled()
        broadcast_event("note.updated", note.to_dict())

    return PolishResponse(text=polished, source=source)
