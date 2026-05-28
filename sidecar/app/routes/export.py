from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import exporter
from ..schemas import ExportRequest


router = APIRouter()


@router.post("/export/markdown")
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
