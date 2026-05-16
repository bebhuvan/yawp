"""Auto-tag extraction.

Two backends:
  · `rule_based()` — frequency-weighted keyword extraction with stopword
    filtering. Pure Python, no deps, ~1 ms per note.
  · `openrouter()` — sends the transcript to OpenRouter's free Nemotron model
    for higher-quality tags. Used automatically when an API key is configured.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from typing import Optional


# A reasonable English stopword set. Trimmed from NLTK's list — kept short to
# stay readable and easy to tweak.
STOPWORDS = frozenset(
    """
a about above after again against all am an and any are as at be because been
before being below between both but by could did do does doing down during each
few for from further had has have having he her here hers herself him himself
his how i if in into is it its itself just like me more most my myself no nor
not now of off on once only or other our ours ourselves out over own same she
should so some such than that the their theirs them themselves then there these
they this those through to too under until up very was we were what when where
which while who whom why with would you your yours yourself yourselves im ive
ill youre theyre well right okay yeah yes thing things really also actually
basically literally got get gets getting going went make made makes
""".split()
)


_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z'-]+")


def rule_based(text: str, k: int = 5) -> list[str]:
    """Return up to *k* tags extracted from *text* via simple frequency."""
    if not text:
        return []
    tokens = [t.lower() for t in _TOKEN_RE.findall(text)]
    filtered = [t for t in tokens if t not in STOPWORDS and len(t) > 2]
    if not filtered:
        return []

    # Score by frequency × length-bonus (longer terms tend to be meatier).
    counts = Counter(filtered)
    scored = [(w, c * (1.0 + min(len(w), 12) / 20)) for w, c in counts.items()]
    scored.sort(key=lambda x: (-x[1], x[0]))
    return [w for w, _ in scored[:k]]


def openrouter(text: str, api_key: str, model: str, k: int = 5) -> list[str]:
    """Ask an OpenRouter model for tags. Returns [] on failure (caller falls
    back to rule_based)."""
    from .openrouter import chat

    prompt = (
        f"Extract {k} short tags (1-2 words each, lowercase) that capture the "
        f"main topics of this dictation. Return ONLY a JSON array of strings, "
        f"no prose, no markdown.\n\nDictation:\n{text.strip()[:4000]}"
    )
    try:
        reply = chat(
            api_key=api_key,
            model=model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=120,
            temperature=0.2,
        )
    except Exception:
        return []

    return _parse_tags(reply, k)


def _parse_tags(reply: str, k: int) -> list[str]:
    """Best-effort parse: try JSON, then fall back to splitting on commas /
    newlines / quotes."""
    reply = (reply or "").strip()
    # 1) Fenced JSON
    m = re.search(r"\[[\s\S]*?\]", reply)
    if m:
        try:
            data = json.loads(m.group(0))
            if isinstance(data, list):
                return _normalise(data, k)
        except json.JSONDecodeError:
            pass
    # 2) Lines/commas
    raw = [s.strip(" \"'`-•*\t") for s in re.split(r"[\n,]", reply) if s.strip()]
    return _normalise(raw, k)


def _normalise(items: list, k: int) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, str):
            continue
        tag = item.strip().lower().strip(".#@").strip()
        # Drop obvious junk
        if not tag or len(tag) > 24 or " " in tag and len(tag.split()) > 3:
            continue
        if tag in seen:
            continue
        seen.add(tag)
        out.append(tag)
        if len(out) >= k:
            break
    return out


def extract(
    text: str,
    openrouter_key: Optional[str] = None,
    openrouter_model: Optional[str] = None,
    k: int = 5,
) -> list[str]:
    """Pick the best available backend."""
    if openrouter_key and openrouter_model:
        tags = openrouter(text, openrouter_key, openrouter_model, k=k)
        if tags:
            return tags
    return rule_based(text, k=k)
