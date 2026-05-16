"""Tiny OpenRouter chat client.

Free Nemotron model: `nvidia/nemotron-nano-9b-v2:free`. Users provide their own
key via Settings. No streaming for now — keeps the sidecar simple.
"""

from __future__ import annotations

from typing import Any

import requests


OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "nvidia/nemotron-nano-9b-v2:free"

# Honest referer headers so OpenRouter analytics show the app properly.
_HEADERS_EXTRA = {
    "HTTP-Referer": "http://localhost/yawp",
    "X-Title": "Yawp (local dictation)",
}


class OpenRouterError(RuntimeError):
    pass


def chat(
    *,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    max_tokens: int = 800,
    temperature: float = 0.3,
    timeout: float = 60,
) -> str:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        **_HEADERS_EXTRA,
    }
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    try:
        r = requests.post(OPENROUTER_URL, headers=headers, json=payload, timeout=timeout)
    except requests.RequestException as e:
        raise OpenRouterError(f"network: {e}") from e

    if r.status_code == 401:
        raise OpenRouterError("invalid API key")
    if r.status_code == 429:
        raise OpenRouterError("rate limited — try again shortly")
    if not r.ok:
        raise OpenRouterError(f"{r.status_code}: {r.text[:200]}")

    data = r.json()
    try:
        msg = data["choices"][0]["message"]
    except (KeyError, IndexError, TypeError):
        raise OpenRouterError(f"unexpected response shape: {str(data)[:200]}")
    content = msg.get("content")
    # Some models return reasoning tokens with `content=None`. Fall back to the
    # reasoning field if present, otherwise surface a clear error.
    if not content or not isinstance(content, str):
        content = msg.get("reasoning") or msg.get("text")
    if not content or not isinstance(content, str):
        raise OpenRouterError(
            f"model {model!r} returned no text content. "
            f"It may be deprecated — pick a different model in Settings."
        )
    return content


# --- High-level helpers ----------------------------------------------------


def polish_text(api_key: str, model: str, text: str) -> str:
    """Copy-edit dictation lightly without adding or reimagining content."""
    system = (
        "You are a conservative copy editor for dictated notes. Your job is "
        "to polish only: fix punctuation, capitalization, spacing, obvious "
        "speech disfluencies, and minor grammar. Preserve the user's words, "
        "order, meaning, tone, names, and details. Do not expand ideas. Do not "
        "summarize. Do not turn fragments into new prose. Do not add examples, "
        "facts, headings, bullets, conclusions, or transitions. If the text is "
        "already clear, return it nearly unchanged. Return only the edited text."
    )
    result = chat(
        api_key=api_key,
        model=model,
        messages=[
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": (
                    "Copy-edit this dictation conservatively. Do not add new "
                    f"content:\n\n{text.strip()}"
                ),
            },
        ],
        max_tokens=min(2000, max(200, len(text) // 2)),
        temperature=0.0,
    )
    return _clean_polish_response(result)


def _clean_polish_response(text: str) -> str:
    text = text.strip()
    prefixes = (
        "Here is the polished text:",
        "Here is the edited text:",
        "Polished text:",
        "Edited text:",
    )
    for prefix in prefixes:
        if text.lower().startswith(prefix.lower()):
            text = text[len(prefix):].strip()
            break
    if text.startswith("```") and text.endswith("```"):
        lines = text.splitlines()
        if len(lines) >= 3:
            text = "\n".join(lines[1:-1]).strip()
    return text
