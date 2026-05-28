from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import db, settings, smart_metadata, todos as todos_mod
from ..events import broadcast_event
from ..schemas import (
    AssignFolderRequest,
    BulkNoteIdsRequest,
    CreateFolderRequest,
    CreateNoteRequest,
    UpdateFolderRequest,
    UpdateNoteRequest,
)
from ..services import auto_export_if_enabled


router = APIRouter()


@router.get("/notes")
def list_notes_endpoint(folder_id: str | None = None) -> dict:
    return {"notes": [n.to_dict() for n in db.list_notes(folder_id=folder_id)]}


@router.get("/folders")
def list_folders_endpoint() -> dict:
    return {"folders": [f.to_dict() for f in db.list_folders()]}


@router.post("/folders", status_code=201)
def create_folder_endpoint(req: CreateFolderRequest) -> dict:
    try:
        folder = db.create_folder(req.name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    payload = folder.to_dict()
    broadcast_event("folder.created", payload)
    return payload


@router.patch("/folders/{folder_id}")
def update_folder_endpoint(folder_id: str, req: UpdateFolderRequest) -> dict:
    try:
        folder = db.update_folder(folder_id, req.name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if not folder:
        raise HTTPException(status_code=404, detail="not found")
    payload = folder.to_dict()
    broadcast_event("folder.updated", payload)
    return payload


@router.delete("/folders/{folder_id}", status_code=204)
def delete_folder_endpoint(folder_id: str) -> None:
    if not db.delete_folder(folder_id):
        raise HTTPException(status_code=404, detail="not found")
    auto_export_if_enabled()
    broadcast_event("folder.deleted", {"id": folder_id})
    return None


# Registered before the /notes/{note_id} param route below so the literal
# "trash" segment isn't captured as a note id (Starlette matches in order).
@router.get("/notes/trash")
def list_trash_endpoint() -> dict:
    return {"notes": [n.to_dict() for n in db.list_deleted_notes()]}


@router.get("/notes/{note_id}")
def get_note_endpoint(note_id: str) -> dict:
    note = db.get_note(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="not found")
    return note.to_dict()


@router.post("/notes", status_code=201)
def create_note_endpoint(req: CreateNoteRequest) -> dict:
    s = settings.get()
    try:
        note = db.create_note(
            title=req.title,
            transcript=req.transcript,
            language=req.language,
            model=req.model,
            mode=req.mode,
            duration_sec=req.duration_sec,
            audio_path=req.audio_path,
            tags=req.tags or [],
            todos=req.todos or [],
            smart_metadata=req.smart_metadata or {},
            folder_id=req.folder_id,
            auto_folder_from_metadata=s.auto_organize_enabled,
            auto_folder_min_confidence=s.auto_organize_min_confidence,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    auto_export_if_enabled()
    payload = note.to_dict()
    if note.folder_id:
        folder = db.get_folder(note.folder_id)
        if folder:
            broadcast_event("folder.updated", folder.to_dict())
    broadcast_event("note.created", payload)
    return payload


@router.patch("/notes/{note_id}")
def update_note_endpoint(note_id: str, req: UpdateNoteRequest) -> dict:
    note = db.update_note(
        note_id,
        title=req.title,
        transcript=req.transcript,
        tags=req.tags,
        todos=req.todos,
        smart_metadata=req.smart_metadata,
    )
    if not note:
        raise HTTPException(status_code=404, detail="not found")
    auto_export_if_enabled()
    payload = note.to_dict()
    broadcast_event("note.updated", payload)
    return payload


@router.post("/notes/{note_id}/organize")
def organize_note_endpoint(note_id: str) -> dict:
    s = settings.get()
    note = db.get_note(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="not found")
    metadata = smart_metadata.extract(
        title=note.title,
        transcript=note.transcript,
        tags=note.tags,
        todos=note.todos,
        api_key=s.openrouter_api_key,
        model=s.openrouter_model,
        guidance=s.categorization_prompt,
    )
    tags = smart_metadata.tags_from_metadata(metadata, note.tags, limit=s.max_tags)
    updated = db.update_note(note_id, tags=tags, smart_metadata=metadata)
    if not updated:
        raise HTTPException(status_code=404, detail="not found")
    if str(metadata.get("collection") or "").strip():
        updated = db.auto_assign_folder_from_metadata(
            note_id,
            metadata,
            min_confidence=0.0,
        )
        if not updated:
            raise HTTPException(status_code=404, detail="not found")
        refreshed = db.get_folder(updated.folder_id) if updated.folder_id else None
        if refreshed:
            broadcast_event("folder.updated", refreshed.to_dict())
    auto_export_if_enabled()
    payload = updated.to_dict()
    broadcast_event("note.updated", payload)
    return payload


@router.post("/notes/{note_id}/folder")
def assign_note_folder_endpoint(note_id: str, req: AssignFolderRequest) -> dict:
    try:
        note = db.assign_note_folder(note_id, req.folder_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if not note:
        raise HTTPException(status_code=404, detail="not found")
    auto_export_if_enabled()
    if note.folder_id:
        folder = db.get_folder(note.folder_id)
        if folder:
            broadcast_event("folder.updated", folder.to_dict())
    payload = note.to_dict()
    broadcast_event("note.updated", payload)
    return payload


@router.post("/notes/{note_id}/extract-todos")
def extract_todos_endpoint(note_id: str) -> dict:
    s = settings.get()
    note = db.get_note(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="not found")
    if not s.openrouter_api_key:
        raise HTTPException(status_code=400, detail="OpenRouter key not configured")
    extracted = todos_mod.extract(
        note.transcript,
        api_key=s.openrouter_api_key,
        model=s.openrouter_model,
    )
    updated = db.update_note(note_id, todos=extracted)
    if not updated:
        raise HTTPException(status_code=404, detail="not found")
    auto_export_if_enabled()
    payload = updated.to_dict()
    broadcast_event("note.updated", payload)
    return payload


@router.delete("/notes/{note_id}", status_code=204)
def delete_note_endpoint(note_id: str) -> None:
    ok = db.soft_delete_note(note_id)
    if not ok:
        raise HTTPException(status_code=404, detail="not found")
    auto_export_if_enabled()
    broadcast_event("note.deleted", {"id": note_id})
    return None


@router.post("/notes/{note_id}/restore")
def restore_note_endpoint(note_id: str) -> dict:
    note = db.restore_note(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="already purged")
    auto_export_if_enabled()
    payload = note.to_dict()
    broadcast_event("note.restored", payload)
    return payload


@router.post("/notes/{note_id}/purge", status_code=204)
def purge_note_endpoint(note_id: str) -> None:
    if not db.purge_note(note_id):
        raise HTTPException(status_code=404, detail="not found")
    return None


@router.post("/notes/empty-trash")
def empty_trash_endpoint() -> dict:
    ids = [n.id for n in db.list_deleted_notes()]
    purged = sum(1 for nid in ids if db.purge_note(nid))
    return {"purged": purged}


@router.post("/notes/bulk-delete")
def bulk_delete_notes_endpoint(req: BulkNoteIdsRequest) -> dict:
    deleted = [nid for nid in req.ids if db.soft_delete_note(nid)]
    if deleted:
        auto_export_if_enabled()
        for nid in deleted:
            broadcast_event("note.deleted", {"id": nid})
    return {"deleted": deleted}


@router.post("/notes/bulk-restore")
def bulk_restore_notes_endpoint(req: BulkNoteIdsRequest) -> dict:
    restored = []
    for nid in req.ids:
        note = db.restore_note(nid)
        if note:
            restored.append(note.to_dict())
    if restored:
        auto_export_if_enabled()
        for payload in restored:
            broadcast_event("note.restored", payload)
    return {"notes": restored}


@router.post("/notes/reorganize")
def reorganize_notes_endpoint() -> dict:
    """Re-file unfiled notes into folders using smart metadata and the user's
    categorization prompt. Manually-filed notes are never touched."""
    s = settings.get()
    organized = 0
    touched_folders: set[str] = set()
    for note in db.list_notes(limit=1000):
        if note.folder_id or note.folder_manually_set:
            continue
        metadata = note.smart_metadata or {}
        if not str(metadata.get("collection") or "").strip():
            metadata = smart_metadata.extract(
                title=note.title,
                transcript=note.transcript,
                tags=note.tags,
                todos=note.todos,
                api_key=s.openrouter_api_key,
                model=s.openrouter_model,
                guidance=s.categorization_prompt,
            )
            db.update_note(note.id, smart_metadata=metadata)
        updated = db.auto_assign_folder_from_metadata(
            note.id, metadata, min_confidence=0.0
        )
        if updated and updated.folder_id:
            organized += 1
            touched_folders.add(updated.folder_id)
            broadcast_event("note.updated", updated.to_dict())
    for folder_id in touched_folders:
        folder = db.get_folder(folder_id)
        if folder:
            broadcast_event("folder.updated", folder.to_dict())
    if organized:
        auto_export_if_enabled()
    return {"organized": organized}


@router.get("/search")
def search_endpoint(q: str = "") -> dict:
    q = (q or "").strip()
    if not q:
        return {"query": q, "notes": []}
    notes = []
    for note, snippet in db.search_notes_with_snippets(q):
        payload = note.to_dict()
        payload["searchSnippet"] = snippet
        notes.append(payload)
    return {"query": q, "notes": notes}
