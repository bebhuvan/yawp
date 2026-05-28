from __future__ import annotations

import asyncio
import logging
import threading
from concurrent.futures import ThreadPoolExecutor

from . import asr, grammar, settings
from .backends.parakeet import ParakeetOnnxBackend, MODEL_ID as PARAKEET_MODEL_ID
from .backends.whisper import FasterWhisperBackend


log = logging.getLogger("voice.sidecar")

def _make_backend(model_name: str):
    if model_name in {PARAKEET_MODEL_ID, f"parakeet:{PARAKEET_MODEL_ID}"}:
        return ParakeetOnnxBackend()
    return FasterWhisperBackend(model_name=model_name)


default_backend = _make_backend(settings.get().asr_model)
asr.register(default_backend)

grammar_checker = grammar.Grammar()

_asr_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="yawp-asr")
_preload_started = False
_preload_lock = threading.Lock()


def run_in_asr(fn, *args, **kwargs):
    loop = asyncio.get_running_loop()
    return loop.run_in_executor(_asr_executor, lambda: fn(*args, **kwargs))


def preload_model_once() -> None:
    global _preload_started
    with _preload_lock:
        if _preload_started:
            return
        _preload_started = True
    threading.Thread(target=_preload_in_bg, daemon=True).start()


def _preload_in_bg() -> None:
    try:
        log.info("Preloading model %s in the background...", default_backend.model_name)
        default_backend.preload()
        log.info("Model ready.")
    except Exception:
        log.exception("Model preload failed; will retry on first /transcribe.")
