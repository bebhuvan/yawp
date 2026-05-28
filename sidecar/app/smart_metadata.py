from __future__ import annotations

import json
import re
from typing import Any

from . import tagging


NOTE_TYPES = {
    "note",
    "idea",
    "meeting",
    "todo",
    "journal",
    "research",
    "draft",
    "code",
}


def extract(
    *,
    title: str,
    transcript: str,
    tags: list[str],
    todos: list[dict],
    api_key: str = "",
    model: str = "",
    guidance: str = "",
) -> dict[str, Any]:
    text = (transcript or "").strip()
    if not text:
        return empty(source="local")
    if api_key and model:
        remote = _openrouter(
            title=title,
            transcript=text,
            tags=tags,
            todos=todos,
            api_key=api_key,
            model=model,
            guidance=guidance,
        )
        if remote:
            return remote
    return _local(title=title, transcript=text, tags=tags, todos=todos)


def empty(source: str = "local") -> dict[str, Any]:
    return {
        "summary": "",
        "kind": "note",
        "collection": "",
        "people": [],
        "projects": [],
        "keywords": [],
        "confidence": 0.0,
        "source": source,
    }


def normalize(data: Any, *, source: str = "openrouter") -> dict[str, Any]:
    if not isinstance(data, dict):
        return empty(source="local")
    kind = str(data.get("kind") or "note").strip().lower()
    if kind not in NOTE_TYPES:
        kind = "note"
    out = empty(source=source)
    out["summary"] = _clean_text(data.get("summary"), max_len=240)
    out["kind"] = kind
    out["collection"] = _clean_text(data.get("collection"), max_len=48)
    out["people"] = _clean_list(data.get("people"), max_items=8, max_len=48)
    out["projects"] = _clean_list(data.get("projects"), max_items=8, max_len=56)
    out["keywords"] = _clean_list(data.get("keywords"), max_items=12, max_len=32)
    try:
        confidence = float(data.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0
    out["confidence"] = max(0.0, min(1.0, confidence))
    out["source"] = source
    return out


def tags_from_metadata(metadata: dict[str, Any], existing: list[str], limit: int) -> list[str]:
    candidates = list(existing)
    candidates.append(str(metadata.get("kind") or ""))
    candidates.extend(metadata.get("keywords") or [])
    candidates.extend(metadata.get("projects") or [])
    collection = str(metadata.get("collection") or "")
    if collection:
        candidates.append(collection)
    return _dedupe_tags(candidates, limit=limit)


def _openrouter(
    *,
    title: str,
    transcript: str,
    tags: list[str],
    todos: list[dict],
    api_key: str,
    model: str,
    guidance: str = "",
) -> dict[str, Any] | None:
    from .openrouter import OpenRouterError, chat

    guidance_block = ""
    clean_guidance = (guidance or "").strip()
    if clean_guidance:
        guidance_block = (
            "Follow these user instructions when choosing the collection "
            f"(folder) and categorizing: {clean_guidance[:1500]}\n\n"
        )

    prompt = (
        "Organize this dictation note. Return ONLY compact JSON with keys: "
        "summary, kind, collection, people, projects, keywords, confidence. "
        f"kind must be one of: {', '.join(sorted(NOTE_TYPES))}. "
        "summary is one sentence. collection is a short folder-like label. "
        "people/projects/keywords are arrays of strings. confidence is 0..1. "
        "No markdown, no prose.\n\n"
        f"{guidance_block}"
        f"Title: {title.strip()[:200]}\n"
        f"Existing tags: {json.dumps(tags[:12])}\n"
        f"Todos: {json.dumps([t.get('text', '') for t in todos[:10]])}\n\n"
        f"Transcript:\n{transcript[:7000]}"
    )
    try:
        reply = chat(
            api_key=api_key,
            model=model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=500,
            temperature=0.1,
        )
    except OpenRouterError:
        return None
    parsed = _parse_json_object(reply)
    if not parsed:
        return None
    return normalize(parsed, source="openrouter")


def _local(
    *,
    title: str,
    transcript: str,
    tags: list[str],
    todos: list[dict],
) -> dict[str, Any]:
    keywords = tagging.rule_based(transcript, k=8)
    lower = transcript.lower()
    kind = "note"
    if todos or any(w in lower for w in ("todo", "remind me", "need to", "follow up")):
        kind = "todo"
    elif any(w in lower for w in ("meeting", "call with", "discussed", "agenda")):
        kind = "meeting"
    elif any(w in lower for w in ("idea", "maybe", "what if", "could build")):
        kind = "idea"
    elif any(w in lower for w in ("bug", "code", "api", "database", "frontend", "backend")):
        kind = "code"
    collection = _collection_from(kind, tags, keywords)
    return normalize(
        {
            "summary": _first_sentence(transcript),
            "kind": kind,
            "collection": collection,
            "people": _people(transcript),
            "projects": _projects(title, transcript, tags),
            "keywords": keywords,
            "confidence": 0.45,
        },
        source="local",
    )


def _parse_json_object(reply: str) -> dict[str, Any] | None:
    if not reply:
        return None
    match = re.search(r"\{[\s\S]*\}", reply.strip())
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _clean_text(value: Any, *, max_len: int) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\s+", " ", text)
    return text[:max_len].strip()


def _clean_list(value: Any, *, max_items: int, max_len: int) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in value:
        text = _clean_text(item, max_len=max_len)
        key = text.lower()
        if not text or key in seen:
            continue
        seen.add(key)
        out.append(text)
        if len(out) >= max_items:
            break
    return out


def _dedupe_tags(values: list[str], *, limit: int) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        tag = str(value or "").strip().lower().strip("#.")
        tag = re.sub(r"\s+", " ", tag)
        if not tag or len(tag) > 32 or tag in seen:
            continue
        seen.add(tag)
        out.append(tag)
        if len(out) >= limit:
            break
    return out


def _first_sentence(text: str) -> str:
    compact = re.sub(r"\s+", " ", text).strip()
    if not compact:
        return ""
    sentence = re.split(r"(?<=[.!?])\s+", compact, maxsplit=1)[0]
    return sentence[:220].strip()


def _collection_from(kind: str, tags: list[str], keywords: list[str]) -> str:
    if tags:
        return tags[0].title()
    if keywords:
        return keywords[0].title()
    return kind.title()


def _people(text: str) -> list[str]:
    matches = re.findall(r"\b(?:with|to|from|for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)", text)
    return _clean_list(matches, max_items=6, max_len=48)


def _projects(title: str, text: str, tags: list[str]) -> list[str]:
    candidates = [t for t in tags if len(t) > 2]
    candidates.extend(re.findall(r"\b(?:project|app|repo|feature)\s+([A-Z]?[A-Za-z0-9][A-Za-z0-9 -]{2,40})", text))
    if title and title.lower() not in {"untitled", "note"}:
        candidates.append(title)
    return _clean_list(candidates, max_items=6, max_len=56)
