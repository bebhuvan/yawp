from __future__ import annotations

import logging
import os
import threading
import time
from typing import Optional, Union

import numpy as np
from faster_whisper import WhisperModel

from ..asr import ASRBackend, TranscriptResult, Segment
from .. import config


log = logging.getLogger("voice.asr")


# Use more of the user's cores. Default in CT2 is 4; we have 14 threads on
# this machine. Allow override via env.
_CPU_THREADS = int(os.environ.get("VOICE_CPU_THREADS", "8"))
_BEAM_SIZE = int(os.environ.get("VOICE_BEAM_SIZE", "1"))


class FasterWhisperBackend:
    """faster-whisper backend. Lazy-loads the model on first use."""

    def __init__(
        self,
        model_name: str = config.DEFAULT_MODEL,
        device: str = config.DEFAULT_DEVICE,
        compute_type: str = config.DEFAULT_COMPUTE_TYPE,
    ):
        self.model_name = model_name
        self.device = device
        self.compute_type = compute_type
        self._model: Optional[WhisperModel] = None
        self._lock = threading.Lock()

    @property
    def name(self) -> str:
        return f"faster-whisper:{self.model_name}"

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def preload(self) -> None:
        """Force model download + load. Safe to call from a background thread."""
        self._ensure_loaded()

    def _ensure_loaded(self) -> WhisperModel:
        if self._model is None:
            with self._lock:
                if self._model is None:
                    self._model = WhisperModel(
                        self.model_name,
                        device=self.device,
                        compute_type=self.compute_type,
                        cpu_threads=_CPU_THREADS,
                        num_workers=1,
                    )
        return self._model

    def transcribe(
        self,
        audio_path: Union[str, np.ndarray],
        language: Optional[str] = None,
        initial_prompt: Optional[str] = None,
    ) -> TranscriptResult:
        model = self._ensure_loaded()
        t0 = time.perf_counter()
        segments_iter, info = model.transcribe(
            audio_path,
            language=language,
            initial_prompt=initial_prompt,
            beam_size=_BEAM_SIZE,
            best_of=1,
            temperature=0.0,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
            condition_on_previous_text=False,
            without_timestamps=True,
        )

        segments: list[Segment] = []
        parts: list[str] = []
        for seg in segments_iter:
            text = seg.text.strip()
            if not text:
                continue
            segments.append(Segment(start=seg.start, end=seg.end, text=text))
            parts.append(text)

        full_text = " ".join(parts).strip()
        elapsed = time.perf_counter() - t0
        duration = float(info.duration)
        rtf = (duration / elapsed) if elapsed > 0 else 0
        log.info(
            "transcribe: audio=%.2fs  cpu=%.2fs  rtf=%.1fx  text_chars=%d",
            duration,
            elapsed,
            rtf,
            len(full_text),
        )
        return TranscriptResult(
            text=full_text,
            language=info.language,
            duration=duration,
            model=self.name,
            segments=segments,
        )
