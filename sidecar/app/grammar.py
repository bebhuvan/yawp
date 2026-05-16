"""LanguageTool-backed grammar/style check (Tier 2).

Lazy-loaded: the first call to `check()` will spin up LanguageTool's Java
server and download the ruleset (~200 MB) into a cache. Subsequent calls are
fast (~100–500 ms per paragraph). Cached at ~/.cache/language_tool_python/.

We only expose check / apply — no auto-correct on transcribe. Grammar
correction is an explicit user action via the 'Check grammar' button.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Optional


@dataclass
class GrammarIssue:
    message: str
    offset: int
    length: int
    context: str
    replacements: list[str]
    rule: str
    category: str

    def to_dict(self) -> dict:
        return {
            "message": self.message,
            "offset": self.offset,
            "length": self.length,
            "context": self.context,
            "replacements": self.replacements,
            "rule": self.rule,
            "category": self.category,
        }


class Grammar:
    def __init__(self, lang: str = "en-US"):
        self.lang = lang
        self._tool = None
        self._lock = threading.Lock()
        self._init_error: Optional[str] = None

    @property
    def ready(self) -> bool:
        return self._tool is not None

    def _ensure_loaded(self):
        if self._tool is not None:
            return self._tool
        with self._lock:
            if self._tool is not None:
                return self._tool
            try:
                # Lazy import — keeps sidecar startup fast for users who never
                # use the grammar feature.
                import language_tool_python  # type: ignore[import-not-found]

                self._tool = language_tool_python.LanguageTool(self.lang)
                self._init_error = None
            except Exception as e:  # JAR download, Java missing, etc.
                self._init_error = str(e)
                raise
        return self._tool

    def check(self, text: str) -> list[GrammarIssue]:
        if not text or not text.strip():
            return []
        tool = self._ensure_loaded()
        matches = tool.check(text)
        return [
            GrammarIssue(
                message=m.message,
                offset=m.offset,
                length=m.errorLength,
                context=m.context,
                replacements=list(m.replacements)[:5],
                rule=m.ruleId,
                category=m.category,
            )
            for m in matches
        ]

    def apply(self, text: str) -> str:
        """Apply LanguageTool's suggested corrections to *text*."""
        if not text:
            return text
        tool = self._ensure_loaded()
        import language_tool_python  # type: ignore[import-not-found]

        return language_tool_python.utils.correct(text, tool.check(text))
