"""Voice command post-processor.

When `voice_commands_enabled` is on in settings, certain spoken phrases are
interpreted as control rather than typed literally. This is conservative: only
phrases unlikely to appear in normal speech.

Two kinds of commands:

* **Substitution commands** (e.g. "period" → ".", "new paragraph" → "\\n\\n")
  are simple regex replacements applied across the whole text.
* **Editing commands** (e.g. "scratch that" → delete previous sentence)
  require stateful left-to-right processing. We tokenise once, then walk the
  tokens and mutate an output buffer.

Order: substitution → editing → final whitespace cleanup. Substitutions first
turn "new paragraph" / "period" into actual punctuation so the editing pass
sees them as boundaries.
"""

from __future__ import annotations

import re


# --- Substitutions (phrase, replacement, eat-preceding-space, trailing-space)


_SUBSTITUTIONS: list[tuple[str, str, bool, bool]] = [
    ("new paragraph", "\n\n", True, False),
    ("new line", "\n", True, False),
    ("next line", "\n", True, False),
    ("question mark", "?", True, True),
    ("exclamation point", "!", True, True),
    ("exclamation mark", "!", True, True),
    ("full stop", ".", True, True),
    ("period", ".", True, True),
    ("comma", ",", True, True),
    ("colon", ":", True, True),
    ("semicolon", ";", True, True),
    ("open quote", '"', False, False),
    ("close quote", '"', True, True),
    ("open parenthesis", "(", False, False),
    ("close parenthesis", ")", True, True),
    ("open paren", "(", False, False),
    ("close paren", ")", True, True),
]


# --- Editing commands (regex match, applied in order)
# Each is a function that takes the current output buffer (string) and
# returns the modified buffer. Stateful "capitalize next word" / "all caps
# next word" are handled by leaving a sentinel that the next-word emitter
# checks for. To keep this simple we use marker characters.
#
# Markers:
#   \x01  → uppercase the very next inserted alphabetic word
#   \x02  → ALL-CAPS the very next inserted alphabetic word
#   \x03  → don't insert a space before the next token

CAP_MARK = "\x01"
UPPER_MARK = "\x02"
NOSPACE_MARK = "\x03"


_EDIT_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # "scratch that" — drop the immediately preceding sentence
    (re.compile(r"\s*\bscratch\s+that\b\.?", re.IGNORECASE), "<SCRATCH_SENTENCE>"),
    (re.compile(r"\s*\bdelete\s+that\b\.?", re.IGNORECASE), "<SCRATCH_SENTENCE>"),
    # "delete word" / "scratch word" — drop the immediately preceding word
    (re.compile(r"\s*\b(?:delete|scratch)\s+word\b\.?", re.IGNORECASE), "<SCRATCH_WORD>"),
    # "capitalize next" / "cap" — uppercase next word
    (re.compile(r"\s*\b(?:capitalize\s+next|cap)\b\.?", re.IGNORECASE), CAP_MARK),
    # "all caps" — ALL-CAPS next word
    (re.compile(r"\s*\ball\s+caps\b\.?", re.IGNORECASE), UPPER_MARK),
    # "no space" — strip space before next token
    (re.compile(r"\s*\bno\s+space\b\.?", re.IGNORECASE), NOSPACE_MARK),
]


_SENTENCE_END = re.compile(r"([.!?]\s+|\n+)")
_WORD_END = re.compile(r"\S+\s*$")


def apply(text: str) -> str:
    if not text:
        return text

    # Pass 1: substitutions (punctuation, line breaks)
    out = text
    for phrase, replacement, eat_prev_space, trailing in _SUBSTITUTIONS:
        pattern = (
            (r"\s?" if eat_prev_space else "")
            + r"\b"
            + re.escape(phrase)
            + r"\b"
        )
        suffix = " " if trailing else ""
        out = re.sub(pattern, replacement + suffix, out, flags=re.IGNORECASE)

    # Pass 2: inject edit markers
    for pat, marker in _EDIT_PATTERNS:
        out = pat.sub(marker, out)

    # Pass 3: walk left-to-right and apply markers
    out = _apply_edits(out)

    # Pass 4: tidy whitespace + spacing around punctuation
    out = re.sub(r" {2,}", " ", out)
    out = re.sub(r"([,.;:?!])(\S)", r"\1 \2", out)
    # Strip space immediately after an opening quote or paren so
    # `"open quote hello"` → `"hello"`, not `" hello"`.
    out = re.sub(r'([("])\s+', r"\1", out)
    # Strip only horizontal whitespace before a newline. Using `\s+\n` here
    # would also eat one of the two newlines in `\n\n` and collapse the
    # paragraph break.
    out = re.sub(r"[ \t]+\n", "\n", out)
    return out.strip()


def _apply_edits(text: str) -> str:
    """Walk the text and process <SCRATCH_*> tokens + capitalisation marks."""
    # Split into tokens that include the markers. Markers are single-char
    # sentinels so they're safe to scan for.
    result: list[str] = []
    i = 0
    pending_cap = False
    pending_upper = False
    pending_nospace = False

    # First reduce <SCRATCH_*> markers by walking left-to-right.
    # We'll build `result` as a list of characters, then post-process.
    buf: list[str] = []
    pos = 0
    while pos < len(text):
        # Match SCRATCH_SENTENCE
        if text.startswith("<SCRATCH_SENTENCE>", pos):
            _drop_last_sentence(buf)
            pos += len("<SCRATCH_SENTENCE>")
            continue
        if text.startswith("<SCRATCH_WORD>", pos):
            _drop_last_word(buf)
            pos += len("<SCRATCH_WORD>")
            continue
        buf.append(text[pos])
        pos += 1
    text = "".join(buf)

    # Now walk text and process per-character markers (CAP / UPPER / NOSPACE).
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == CAP_MARK:
            pending_cap = True
            i += 1
            continue
        if ch == UPPER_MARK:
            pending_upper = True
            i += 1
            continue
        if ch == NOSPACE_MARK:
            pending_nospace = True
            i += 1
            continue
        if pending_nospace and result and result[-1] == " ":
            result.pop()
            pending_nospace = False
        if (pending_cap or pending_upper) and ch.isalpha():
            # Emit the next word with the requested casing.
            # Find the word boundary.
            j = i
            while j < len(text) and text[j].isalpha():
                j += 1
            word = text[i:j]
            if pending_upper:
                word = word.upper()
            elif pending_cap:
                word = word[0].upper() + word[1:].lower()
            result.append(word)
            pending_cap = False
            pending_upper = False
            i = j
            continue
        # Reset pending flags if we hit a non-alpha non-marker before a word
        if (pending_cap or pending_upper) and not ch.isspace():
            pending_cap = False
            pending_upper = False
        result.append(ch)
        i += 1

    return "".join(result)


def _drop_last_sentence(buf: list[str]) -> None:
    """Remove the last sentence in `buf` in place."""
    s = "".join(buf).rstrip()
    # Find the last sentence terminator. Look backward.
    last_end = -1
    for m in _SENTENCE_END.finditer(s):
        last_end = m.end()
    if last_end == -1:
        # No prior sentence boundary — drop everything
        buf.clear()
        return
    # Keep up to the last terminator (which includes its trailing whitespace).
    trimmed = s[:last_end]
    buf.clear()
    buf.extend(trimmed)


def _drop_last_word(buf: list[str]) -> None:
    """Remove the last word in `buf` in place."""
    s = "".join(buf).rstrip()
    m = _WORD_END.search(s)
    if not m:
        buf.clear()
        return
    trimmed = s[: m.start()].rstrip()
    if trimmed and trimmed[-1] not in ".,;:!?":
        trimmed = trimmed + " "
    buf.clear()
    buf.extend(trimmed)
