from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import storage
from ..diagnostics import runtime_report


router = APIRouter()


@router.get("/diagnostics")
def diagnostics_endpoint() -> dict:
    return runtime_report()


@router.get("/cache")
def cache_usage_endpoint() -> dict:
    return storage.usage()


@router.post("/cache/clear")
def cache_clear_endpoint(req: dict) -> dict:
    target = str(req.get("target", "")).strip()
    try:
        return storage.clear(target)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
