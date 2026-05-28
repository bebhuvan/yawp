from __future__ import annotations

import io
import threading
from dataclasses import dataclass, field

import numpy as np
import sounddevice as sd
import soundfile as sf

from . import settings


SAMPLE_RATE = 16_000
CHANNELS = 1


@dataclass
class CaptureState:
    stream: sd.InputStream | None = None
    frames: list[np.ndarray] = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock)


_state = CaptureState()


class CaptureError(RuntimeError):
    pass


def is_recording() -> bool:
    with _state.lock:
        return _state.stream is not None


def start() -> None:
    with _state.lock:
        if _state.stream is not None:
            raise CaptureError("already recording")
        _state.frames = []
        s = settings.get()
        stream = sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            dtype="float32",
            device=s.input_device,
            callback=_audio_callback,
            blocksize=0,
        )
        stream.start()
        _state.stream = stream


def stop_wav() -> tuple[bytes, float]:
    with _state.lock:
        stream = _state.stream
        frames = _state.frames
        _state.stream = None
        _state.frames = []

    if stream is None:
        raise CaptureError("not recording")

    try:
        stream.stop()
        stream.close()
    finally:
        pass

    if not frames:
        return b"", 0.0

    audio = np.concatenate(frames).flatten().astype(np.float32)
    duration = len(audio) / SAMPLE_RATE if len(audio) else 0.0
    buf = io.BytesIO()
    sf.write(buf, audio, SAMPLE_RATE, format="WAV", subtype="PCM_16")
    return buf.getvalue(), duration


def cancel() -> None:
    with _state.lock:
        stream = _state.stream
        _state.stream = None
        _state.frames = []

    if stream is not None:
        stream.stop()
        stream.close()


def _audio_callback(indata, frames, time_info, status):  # noqa: ARG001
    if status:
        # sounddevice status objects are useful only in server logs.
        print(f"[native capture status] {status}", flush=True)
    with _state.lock:
        if _state.stream is None:
            return
        _state.frames.append(indata.copy())
