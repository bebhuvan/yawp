from __future__ import annotations

import shutil
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Optional, Protocol

import numpy as np
import soundfile as sf

from . import cleanup, config, settings, smart_metadata, tagging, todos as todos_mod, voice_commands
from .asr import Segment


class AudioInputError(ValueError):
    pass


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
    smart_metadata: dict


def transcribe_file(
    *,
    backend: TranscriptionBackend,
    source: BinaryIO,
    filename: str,
    language: Optional[str] = None,
    keep_audio: bool = True,
    enrich: bool = True,
) -> TranscriptionOutput:
    """Transcribe + clean. Tag/todo extraction is only run when enrich=True.

    enrich=False keeps the ASR worker free of OpenRouter latency — used by
    paste mode so the text appears immediately. Callers can run enrich_text()
    afterwards in a background task if needed.
    """
    s = settings.get()
    audio_path = _persist_audio(source, filename, keep_audio=keep_audio)
    asr_path = audio_path
    prepared_path: str | None = None

    try:
        prepared_path = _prepare_audio_for_asr(audio_path)
        if prepared_path:
            asr_path = prepared_path
        result = backend.transcribe(
            asr_path,
            language=language,
            initial_prompt=cleanup.WHISPER_INITIAL_PROMPT if s.cleanup_enabled else None,
        )
    finally:
        if prepared_path:
            Path(prepared_path).unlink(missing_ok=True)
        if not keep_audio:
            Path(audio_path).unlink(missing_ok=True)

    text_raw = result.text
    text_intermediate = (
        voice_commands.apply(text_raw) if s.voice_commands_enabled else text_raw
    )
    text_clean = (
        cleanup.clean(text_intermediate) if s.cleanup_enabled else text_intermediate
    )

    tags: list[str] = []
    extracted_todos: list[dict] = []
    if enrich:
        tags, extracted_todos, metadata = enrich_text(
            text_clean,
            title=make_title(text_clean),
        )
    else:
        metadata = {}

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
        smart_metadata=metadata,
    )


def enrich_text(
    text: str,
    *,
    title: str = "",
    tags: list[str] | None = None,
    todos: list[dict] | None = None,
) -> tuple[list[str], list[dict], dict]:
    """Run tagging + todo extraction. Network-bound (OpenRouter); safe to call
    outside the ASR executor."""
    s = settings.get()
    tags: list[str] = []
    if tags is not None:
        tags = list(tags)
    if s.auto_tag_enabled and text:
        tags = tagging.extract(
            text,
            openrouter_key=s.openrouter_api_key or None,
            openrouter_model=s.openrouter_model if s.openrouter_api_key else None,
            k=s.max_tags,
        )

    extracted_todos: list[dict] = []
    if s.extract_todos_enabled and s.openrouter_api_key and text:
        extracted_todos = todos_mod.extract(
            text,
            api_key=s.openrouter_api_key,
            model=s.openrouter_model,
        )
    if todos is not None:
        extracted_todos = list(todos)

    metadata = smart_metadata.extract(
        title=title or make_title(text),
        transcript=text,
        tags=tags,
        todos=extracted_todos,
        api_key=s.openrouter_api_key,
        model=s.openrouter_model,
        guidance=s.categorization_prompt,
    )
    tags = smart_metadata.tags_from_metadata(metadata, tags, limit=s.max_tags)
    return tags, extracted_todos, metadata


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


def _prepare_audio_for_asr(audio_path: str) -> str | None:
    """Best-effort WAV preparation for ASR.

    If libsndfile cannot read the input, return None and let the backend handle
    the original file. For readable PCM-like inputs, trim long leading/trailing
    silence, reject near-silent clips, and normalize conservatively. The
    original saved audio is left untouched.
    """
    try:
        audio, sample_rate = sf.read(audio_path, dtype="float32", always_2d=True)
    except Exception:
        return None
    if audio.size == 0:
        raise AudioInputError("empty audio")
    mono = audio.mean(axis=1)
    if mono.size == 0:
        raise AudioInputError("empty audio")
    peak = float(np.max(np.abs(mono)))
    if peak < 0.003:
        raise AudioInputError("audio is too quiet")

    trimmed = _trim_silence(mono, sample_rate)
    if trimmed.size < int(sample_rate * 0.25):
        raise AudioInputError("recording is too short after trimming silence")

    # Normalize only when it helps. Target roughly -3 dBFS and never amplify
    # more than 12x, which avoids turning room noise into a loud signal.
    trimmed_peak = float(np.max(np.abs(trimmed)))
    if 0 < trimmed_peak < 0.70:
        gain = min(12.0, 0.70 / trimmed_peak)
        trimmed = np.clip(trimmed * gain, -1.0, 1.0)

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    sf.write(tmp.name, trimmed, sample_rate, format="WAV", subtype="PCM_16")
    return tmp.name


def _trim_silence(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    threshold = max(0.004, float(np.max(np.abs(audio))) * 0.035)
    active = np.flatnonzero(np.abs(audio) >= threshold)
    if active.size == 0:
        return audio[:0]
    pad = int(sample_rate * 0.12)
    start = max(0, int(active[0]) - pad)
    end = min(audio.size, int(active[-1]) + pad + 1)
    return audio[start:end]
