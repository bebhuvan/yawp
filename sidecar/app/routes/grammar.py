from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from .. import db
from ..events import broadcast_event
from ..runtime import grammar_checker
from ..schemas import GrammarApplyRequest, GrammarRequest
from ..services import auto_export_if_enabled


router = APIRouter()
log = logging.getLogger("voice.sidecar")


@router.post("/grammar")
def grammar_check_endpoint(req: GrammarRequest) -> dict:
    text = (req.text or "").strip()
    if not text:
        return {"issues": []}
    try:
        issues = grammar_checker.check(text)
    except Exception as e:
        log.exception("grammar check failed")
        raise HTTPException(
            status_code=503,
            detail=f"grammar service unavailable: {e}",
        )
    return {"issues": [i.to_dict() for i in issues]}


@router.post("/grammar/apply")
def grammar_apply_endpoint(req: GrammarApplyRequest) -> dict:
    text = (req.text or "").strip()
    if not text:
        return {"text": text}
    try:
        corrected = grammar_checker.apply(text)
    except Exception as e:
        log.exception("grammar apply failed")
        raise HTTPException(
            status_code=503,
            detail=f"grammar service unavailable: {e}",
        )
    if req.note_id:
        note = db.update_note(req.note_id, transcript=corrected)
        if not note:
            raise HTTPException(status_code=404, detail="not found")
        auto_export_if_enabled()
        broadcast_event("note.updated", note.to_dict())
    return {"text": corrected}
