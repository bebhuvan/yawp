"""Tier 1 text cleanup — regex-only, no models.

Strips obvious disfluencies (uh/um/er/hmm), collapses stutter repeats,
normalises whitespace, restores capitalization. Conservative: only strips
unambiguous filler words. Words with ambiguous use (like, so, basically) are
left alone — false-positives would mangle real content.
"""

from __future__ import annotations

import re


# Only the most unambiguous fillers. "Like" and "so" are intentionally absent.
_FILLER_PATTERN = re.compile(
    r"\b(?:uh+|um+|er+|hmm+|y'?know|i\s+mean|you\s+know)\b\s*,?\s*",
    re.IGNORECASE,
)

# Stutter dedup: "I I I think" → "I think", "the the" → "the"
_STUTTER_PATTERN = re.compile(r"\b(\w+)(\s+\1\b)+", re.IGNORECASE)

# Multiple spaces / lonely punctuation cleanup
_MULTI_SPACE = re.compile(r"\s+")
_SPACE_BEFORE_PUNCT = re.compile(r"\s+([.,;:!?])")
_DOUBLE_PUNCT = re.compile(r"([.,;:!?])\1+")

# Sentence start: ^ or after .!? + space → uppercase next letter
_SENTENCE_START = re.compile(r"(^|[.!?]\s+)([a-z])")

# Standalone "i" → "I" (plus i'm, i've, i'll, i'd)
_LOWER_I = re.compile(r"\bi\b")
_LOWER_I_CONTRACTION = re.compile(r"\bi('(?:m|ve|ll|d|re|s))\b", re.IGNORECASE)


def clean(text: str) -> str:
    """Return the cleaned transcript. Idempotent."""
    if not text:
        return text
    t = text.strip()

    # 1) Strip standalone filler words
    t = _FILLER_PATTERN.sub("", t)

    # 2) Collapse stutter repetitions ("I I" → "I"). Case-insensitive but
    #    preserve the case of the first occurrence.
    t = _STUTTER_PATTERN.sub(r"\1", t)

    # 3) Whitespace + punctuation normalisation
    t = _SPACE_BEFORE_PUNCT.sub(r"\1", t)
    t = _DOUBLE_PUNCT.sub(r"\1", t)
    t = _MULTI_SPACE.sub(" ", t).strip()

    # 4) Capitalise sentence starts
    t = _SENTENCE_START.sub(lambda m: m.group(1) + m.group(2).upper(), t)

    # 5) Capitalise "I" and "I'm/I've/I'll…"
    t = _LOWER_I.sub("I", t)
    t = _LOWER_I_CONTRACTION.sub(lambda m: "I" + m.group(1), t)

    # 6) Ensure terminal punctuation on a non-empty result
    if t and t[-1] not in ".!?":
        t += "."

    return t


# The Whisper bias prompt — fed to the model as `initial_prompt` so its output
# already trends toward polished prose. Mild but effective.
WHISPER_INITIAL_PROMPT = (
    "The following is a well-punctuated, polished transcript with correct "
    "capitalization."
)
