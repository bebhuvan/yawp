from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path
from typing import Optional

import soundfile as sf

from ..asr import Segment, TranscriptResult


log = logging.getLogger("voice.asr")

MODEL_ID = "parakeet-tdt-0.6b-v3-int8"


def _default_model_dirs() -> list[Path]:
    home = Path.home()
    candidates = [
        os.environ.get("VOICE_PARAKEET_MODEL_DIR"),
        str(home / ".local/share/com.pais.handy/models/parakeet-tdt-0.6b-v3-int8"),
        str(home / ".cache/openwhispr/parakeet-models/parakeet-tdt-0.6b-v3"),
    ]
    return [Path(p).expanduser() for p in candidates if p]


def _onnx_asr_compatible(path: Path) -> bool:
    return (
        (path / "encoder-model.int8.onnx").exists()
        and (path / "decoder_joint-model.int8.onnx").exists()
        and (path / "vocab.txt").exists()
    )


class ParakeetOnnxBackend:
    """NVIDIA Parakeet TDT v3 via local ONNX Runtime/onnx-asr files."""

    def __init__(self, model_dir: Optional[str] = None) -> None:
        self.model_name = MODEL_ID
        self.model_dir = Path(model_dir).expanduser() if model_dir else None
        self._model = None
        self._lock = threading.Lock()

    @property
    def name(self) -> str:
        return f"parakeet-onnx:{self.model_name}"

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def preload(self) -> None:
        self._ensure_loaded()

    def _resolve_model_dir(self) -> Path:
        candidates = [self.model_dir] if self.model_dir else _default_model_dirs()
        for path in candidates:
            if path and _onnx_asr_compatible(path):
                return path
        checked = ", ".join(str(p) for p in candidates if p)
        raise FileNotFoundError(
            "Parakeet ONNX model not found. Expected encoder-model.int8.onnx, "
            f"decoder_joint-model.int8.onnx, and vocab.txt in one of: {checked}"
        )

    def _ensure_loaded(self):
        if self._model is None:
            with self._lock:
                if self._model is None:
                    try:
                        import onnx_asr
                    except ImportError as e:
                        raise RuntimeError(
                            "Parakeet support requires onnx-asr. Run install.sh "
                            "or install sidecar requirements."
                        ) from e
                    model_dir = self._resolve_model_dir()
                    log.info("loading Parakeet ONNX model from %s", model_dir)
                    self._model = onnx_asr.load_model(
                        "nemo-conformer-tdt",
                        model_dir,
                        quantization="int8",
                    )
        return self._model

    def transcribe(
        self,
        audio_path: str,
        language: Optional[str] = None,
        initial_prompt: Optional[str] = None,
    ) -> TranscriptResult:
        del initial_prompt
        model = self._ensure_loaded()
        t0 = time.perf_counter()
        text = model.recognize(audio_path, language=language).strip()
        elapsed = time.perf_counter() - t0
        duration = _audio_duration(audio_path)
        rtf = (duration / elapsed) if elapsed > 0 else 0
        log.info(
            "transcribe(parakeet): audio=%.2fs  cpu=%.2fs  rtf=%.1fx  text_chars=%d",
            duration,
            elapsed,
            rtf,
            len(text),
        )
        return TranscriptResult(
            text=text,
            language=language or "auto",
            duration=duration,
            model=self.name,
            segments=[Segment(start=0.0, end=duration, text=text)] if text else [],
        )


def _audio_duration(audio_path: str) -> float:
    try:
        info = sf.info(audio_path)
        if info.samplerate:
            return float(info.frames) / float(info.samplerate)
    except Exception:
        log.debug("could not read audio duration for %s", audio_path, exc_info=True)
    return 0.0
