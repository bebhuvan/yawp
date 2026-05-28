from __future__ import annotations

from fastapi import APIRouter

from .. import asr, config, db, settings
from ..runtime import default_backend
from ..schemas import HealthResponse


router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    s = settings.get()
    return HealthResponse(
        ok=True,
        backends=asr.available(),
        default_model=default_backend.name,
        model_ready=default_backend.loaded,
        db_path=str(config.DB_PATH),
        notes_count=db.count_notes(),
        openrouter_configured=bool(s.openrouter_api_key),
    )
