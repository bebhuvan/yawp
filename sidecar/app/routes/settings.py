from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import openrouter, settings
from ..schemas import OpenRouterTestRequest, SettingsUpdate
from ..services import poke_daemon_reload


router = APIRouter()


@router.get("/settings")
def get_settings() -> dict:
    return settings.get().to_safe_dict()


@router.put("/settings")
def put_settings(req: SettingsUpdate) -> dict:
    incoming = {k: v for k, v in req.model_dump(exclude_unset=True).items()}
    current = settings.get()
    hotkey_notes = incoming.get("hotkey_notes", current.hotkey_notes)
    hotkey_paste = incoming.get("hotkey_paste", current.hotkey_paste)
    hold_key_notes = incoming.get("hold_key_notes", current.hold_key_notes)
    hold_key_paste = incoming.get("hold_key_paste", current.hold_key_paste)
    if hotkey_notes == hotkey_paste:
        raise HTTPException(status_code=400, detail="toggle hotkeys must be different")
    if hold_key_notes == hold_key_paste:
        raise HTTPException(status_code=400, detail="hold hotkeys must be different")
    settings.update(incoming)
    if {
        "hotkey_mode",
        "hotkey_notes",
        "hotkey_paste",
        "hold_key_notes",
        "hold_key_paste",
        "auto_stop_ms",
        "audio_feedback_enabled",
    } & incoming.keys():
        poke_daemon_reload()
    return settings.get().to_safe_dict()


@router.post("/settings/openrouter/test")
def test_openrouter(req: OpenRouterTestRequest) -> dict:
    current = settings.get()
    api_key = (req.api_key or current.openrouter_api_key).strip()
    model = (req.model or current.openrouter_model).strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="OpenRouter key not configured")
    if not model:
        raise HTTPException(status_code=400, detail="OpenRouter model not configured")
    try:
        response = openrouter.test_connection(api_key=api_key, model=model)
    except openrouter.OpenRouterError as e:
        raise HTTPException(status_code=502, detail=f"openrouter: {e}")
    return {"ok": True, "model": model, "response": response[:200]}
