from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, Optional


@dataclass
class Segment:
    start: float
    end: float
    text: str


@dataclass
class TranscriptResult:
    text: str
    language: str
    duration: float
    model: str
    segments: list[Segment] = field(default_factory=list)


class ASRBackend(Protocol):
    name: str

    def transcribe(
        self,
        audio_path: str,
        language: Optional[str] = None,
    ) -> TranscriptResult: ...


_registry: dict[str, ASRBackend] = {}


def register(backend: ASRBackend) -> None:
    _registry[backend.name] = backend


def get(name: str) -> ASRBackend:
    if name not in _registry:
        raise KeyError(f"Backend not registered: {name}")
    return _registry[name]


def available() -> list[str]:
    return list(_registry.keys())
