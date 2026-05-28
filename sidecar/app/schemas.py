from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class SegmentResponse(BaseModel):
    start: float
    end: float
    text: str


class TodoItem(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: Optional[str] = None
    text: str = ""
    done: bool = False


class SmartMetadata(BaseModel):
    model_config = ConfigDict(extra="allow")

    summary: str = ""
    kind: str = ""
    collection: str = ""
    people: list[str] = Field(default_factory=list)
    projects: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    confidence: Optional[float] = None
    source: str = ""


class EnrichmentStatus(BaseModel):
    requested: bool
    ok: bool
    code: Optional[str] = None
    message: Optional[str] = None


class HealthResponse(BaseModel):
    ok: bool
    backends: list[str]
    default_model: str
    model_ready: bool
    db_path: str
    notes_count: int
    openrouter_configured: bool


class TranscribeResponse(BaseModel):
    request_id: str
    text: str
    text_raw: str
    title: str
    language: str
    duration: float
    model: str
    segments: list[SegmentResponse]
    audio_path: str
    tags: list[str]
    todos: list[TodoItem]
    smart_metadata: SmartMetadata
    enrichment_status: EnrichmentStatus


class CaptureStatusResponse(BaseModel):
    recording: bool


class CaptureStopAndSaveRequest(BaseModel):
    mode: str = Field(pattern="^(notes|paste)$")
    language: Optional[str] = None
    keep_audio: bool = True
    enrich: bool = True


class CreateNoteRequest(BaseModel):
    title: str
    transcript: str
    language: Optional[str] = None
    model: str
    mode: str = Field(pattern="^(notes|paste)$")
    duration_sec: float = Field(ge=0)
    audio_path: Optional[str] = None
    tags: Optional[list[str]] = None
    todos: Optional[list[dict]] = None
    smart_metadata: Optional[dict] = None
    folder_id: Optional[str] = None


class UpdateNoteRequest(BaseModel):
    title: Optional[str] = None
    transcript: Optional[str] = None
    tags: Optional[list[str]] = None
    todos: Optional[list[dict]] = None
    smart_metadata: Optional[dict] = None


class CreateFolderRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class UpdateFolderRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class AssignFolderRequest(BaseModel):
    folder_id: Optional[str] = None


class BulkNoteIdsRequest(BaseModel):
    ids: list[str] = Field(default_factory=list)


class AskRequest(BaseModel):
    question: str


class ExportRequest(BaseModel):
    dest: str


class PolishRequest(BaseModel):
    text: str
    note_id: Optional[str] = None


class PolishResponse(BaseModel):
    text: str
    source: str


class GrammarRequest(BaseModel):
    text: str


class GrammarApplyRequest(BaseModel):
    text: str
    note_id: Optional[str] = None


class SettingsUpdate(BaseModel):
    asr_model: Optional[str] = Field(
        default=None,
        pattern=(
            r"^(base\.en|small\.en|medium\.en|large-v3-turbo|"
            r"distil-large-v3|parakeet-tdt-0\.6b-v3-int8)$"
        ),
    )
    input_device: Optional[int] = Field(default=None, ge=0)
    cleanup_enabled: Optional[bool] = None
    voice_commands_enabled: Optional[bool] = None
    auto_tag_enabled: Optional[bool] = None
    extract_todos_enabled: Optional[bool] = None
    auto_organize_enabled: Optional[bool] = None
    auto_organize_min_confidence: Optional[float] = Field(default=None, ge=0, le=1)
    categorization_prompt: Optional[str] = Field(default=None, max_length=2000)
    openrouter_api_key: Optional[str] = None
    openrouter_model: Optional[str] = None
    max_tags: Optional[int] = Field(default=None, ge=0, le=12)
    hotkey_mode: Optional[str] = Field(default=None, pattern="^(toggle|hold)$")
    hotkey_notes: Optional[str] = Field(
        default=None,
        pattern=r"^<ctrl>\+<alt>\+(n|m|<f8>|<f9>|<f10>|<f12>)$",
    )
    hotkey_paste: Optional[str] = Field(
        default=None,
        pattern=r"^<ctrl>\+<alt>\+(v|m|<f8>|<f9>|<f10>|<f12>)$",
    )
    hold_key_notes: Optional[str] = Field(
        default=None,
        pattern=r"^(<menu>|<scroll_lock>|<pause>|<insert>|<f8>|<f9>|<f10>|<f12>)$",
    )
    hold_key_paste: Optional[str] = Field(
        default=None,
        pattern=r"^(<ctrl_r>|<menu>|<scroll_lock>|<pause>|<insert>|<f8>|<f9>|<f10>|<f12>)$",
    )
    auto_stop_ms: Optional[int] = Field(default=None, ge=0, le=10_000)
    audio_feedback_enabled: Optional[bool] = None
    paste_use_clipboard: Optional[bool] = None
    export_path: Optional[str] = None
    auto_export_enabled: Optional[bool] = None


class OpenRouterTestRequest(BaseModel):
    api_key: Optional[str] = None
    model: Optional[str] = None
