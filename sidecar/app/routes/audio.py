from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
import sounddevice as sd

from .. import config, settings


router = APIRouter()


@router.get("/audio/input-devices")
def list_input_devices() -> dict:
    try:
        devices = sd.query_devices()
        default_input = sd.default.device[0]
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"audio devices unavailable: {e}")
    s = settings.get()
    out = []
    for index, device in enumerate(devices):
        channels = int(device.get("max_input_channels", 0))
        if channels <= 0:
            continue
        out.append(
            {
                "index": index,
                "name": device.get("name") or f"Input {index}",
                "channels": channels,
                "defaultSamplerate": device.get("default_samplerate"),
                "isDefault": index == default_input,
                "selected": s.input_device == index
                or (s.input_device is None and index == default_input),
            }
        )
    return {"devices": out, "selected": s.input_device}


@router.get("/audio/{filename}")
def get_audio(filename: str) -> FileResponse:
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
