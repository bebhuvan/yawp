from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from .. import db, openrouter, settings
from ..schemas import AskRequest


router = APIRouter()
log = logging.getLogger("voice.sidecar")

MAX_SOURCES = 8
MAX_NOTE_CHARS = 1500


@router.post("/ask")
def ask_endpoint(req: AskRequest) -> dict:
    s = settings.get()
    question = (req.question or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="empty question")

    # Retrieve candidate notes via full-text search; fall back to recent notes
    # so the model still has context when the keywords don't match anything.
    hits = db.search_notes(question, limit=MAX_SOURCES)
    if not hits:
        hits = db.list_notes(limit=MAX_SOURCES)

    sources = [{"id": n.id, "title": n.title or "Untitled"} for n in hits]

    if not s.openrouter_api_key:
        return {"answer": "", "sources": sources, "answered": False}

    if not hits:
        return {
            "answer": "You don't have any notes yet.",
            "sources": [],
            "answered": True,
        }

    context = "\n\n".join(
        f"[{i + 1}] {n.title or 'Untitled'}\n{n.transcript[:MAX_NOTE_CHARS]}"
        for i, n in enumerate(hits)
    )
    try:
        answer = openrouter.ask_notes(
            api_key=s.openrouter_api_key,
            model=s.openrouter_model,
            question=question,
            context=context,
        )
    except openrouter.OpenRouterError as e:
        raise HTTPException(status_code=502, detail=f"openrouter: {e}") from e
    except Exception as e:
        log.exception("ask endpoint crashed")
        raise HTTPException(status_code=500, detail=f"ask: {e}") from e

    return {"answer": answer, "sources": sources, "answered": True}
