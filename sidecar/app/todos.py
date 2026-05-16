"""Action-item extraction from a transcript.

Requires an OpenRouter key. Returns [] if none configured — the UI shows the
"action items" section only when there are items.
"""

from __future__ import annotations

import json
import re
import uuid

from . import openrouter


_PROMPT = (
    "Extract concrete action items from this dictation. Each action item is a "
    "task someone needs to do — a verb-led sentence, not a topic. Examples: "
    '"send the figma file to maya", "buy groceries", "call dr smith".\n\n'
    "Return ONLY a JSON array of objects, each {\"text\": \"…\"}. Return [] "
    "if there are no action items. No prose. No markdown fences.\n\n"
    "Dictation:\n"
)


def extract(text: str, api_key: str, model: str) -> list[dict]:
    """Return a list of {id, text, done} dicts. Empty on any failure."""
    if not text or not text.strip() or not api_key:
        return []
    prompt = _PROMPT + text.strip()[:6000]
    try:
        reply = openrouter.chat(
            api_key=api_key,
            model=model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=400,
            temperature=0.1,
        )
    except openrouter.OpenRouterError:
        return []

    items = _parse(reply)
    return [
        {"id": uuid.uuid4().hex[:10], "text": t, "done": False}
        for t in items
    ]


def _parse(reply: str) -> list[str]:
    if not reply:
        return []
    reply = reply.strip()
    # Try to find a JSON array even if the model wrapped it in chatter.
    m = re.search(r"\[[\s\S]*\]", reply)
    if not m:
        return []
    try:
        data = json.loads(m.group(0))
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    out: list[str] = []
    for item in data:
        if isinstance(item, str):
            t = item.strip()
        elif isinstance(item, dict):
            t = str(item.get("text") or item.get("task") or "").strip()
        else:
            continue
        if not t or len(t) > 240:
            continue
        out.append(t)
    return out[:10]
