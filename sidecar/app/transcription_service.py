from __future__ import annotations

import shutil
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Optional, Protocol

from . import cleanup, config, settings, tagging, todos as todos_mod, voice_commands
from .asr import Segment


class TranscriptionBackend(Protocol):
    def transcribe(
        self,
        audio_path: str,
        language: Optional[str] = None,
        initial_prompt: Optional[str] = None,
    ): ...


@dataclass
class TranscriptionOutput:
    text: str
    text_raw: str
    title: str
    language: str
    duration: float
    model: str
    segments: list[Segment]
    audio_path: str
    tags: list[str]
    todos: list[dict]


def transcribe_file(
    *,
    backend: TranscriptionBackend,
    source: BinaryIO,
    filename: str,
    language: Optional[str] = None,
    keep_audio: bool = True,
) -> TranscriptionOutput:
    s = settings.get()
    audio_path = _persist_audio(source, filename, keep_audio=keep_audio)

    try:
        result = backend.transcribe(
            audio_path,
            language=language,
            initial_prompt=cleanup.WHISPER_INITIAL_PROMPT if s.cleanup_enabled else None,
        )
    finally:
        if not keep_audio:
            Path(audio_path).unlink(missing_ok=True)

    text_raw = result.text
    text_intermediate = (
        voice_commands.apply(text_raw) if s.voice_commands_enabled else text_raw
    )
    text_clean = (
        cleanup.clean(text_intermediate) if s.cleanup_enabled else text_intermediate
    )

    tags = []
    if s.auto_tag_enabled and text_clean:
        tags = tagging.extract(
            text_clean,
            openrouter_key=s.openrouter_api_key or None,
            openrouter_model=s.openrouter_model if s.openrouter_api_key else None,
            k=s.max_tags,
        )

    extracted_todos: list[dict] = []
    if s.extract_todos_enabled and s.openrouter_api_key and text_clean:
        extracted_todos = todos_mod.extract(
            text_clean,
            api_key=s.openrouter_api_key,
            model=s.openrouter_model,
        )

    return TranscriptionOutput(
        text=text_clean,
        text_raw=text_raw,
        title=make_title(text_clean),
        language=result.language,
        duration=result.duration,
        model=result.model,
        segments=list(result.segments),
        audio_path=audio_path if keep_audio else "",
        tags=tags,
        todos=extracted_todos,
    )


def make_title(text: str) -> str:
    text = text.strip()
    if not text:
        return "Untitled"
    first_sentence = text.split(". ")[0]
    if len(first_sentence) > 70:
        first_sentence = first_sentence[:67].rsplit(" ", 1)[0] + "..."
    return first_sentence.rstrip(".,;: ")


def _persist_audio(source: BinaryIO, filename: str, *, keep_audio: bool) -> str:
    suffix = Path(filename or "audio.wav").suffix or ".wav"
    if keep_audio:
        target_path = config.AUDIO_DIR / f"{uuid.uuid4().hex}{suffix}"
        with target_path.open("wb") as out:
            shutil.copyfileobj(source, out)
        return str(target_path)

    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    try:
        shutil.copyfileobj(source, tmp)
        tmp.close()
        return tmp.name
    except Exception:
        tmp.close()
        Path(tmp.name).unlink(missing_ok=True)
        raise
