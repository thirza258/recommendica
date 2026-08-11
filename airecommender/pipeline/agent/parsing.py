"""
Forgiving JSON extraction for LLM responses.

Models wrap JSON in prose, fence it in ```json blocks, or emit a bare array
where an object was asked for.  The agent's decisions depend on reading those
responses, so parsing is deliberately permissive — and when it still fails, the
caller is told, rather than the failure being smoothed over into a plausible
looking empty result.

Pure functions: no network, no settings.
"""

from __future__ import annotations

import json
from typing import Any, Optional


def strip_fences(text: str) -> str:
    """Remove markdown code fences and surrounding whitespace."""
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        # Drop the opening fence (with optional language tag) and closing fence.
        newline = cleaned.find("\n")
        if newline != -1:
            cleaned = cleaned[newline + 1 :]
        if cleaned.rstrip().endswith("```"):
            cleaned = cleaned.rstrip()[:-3]
    return cleaned.replace("```json", "").replace("```", "").strip()


def _balanced_slice(text: str, opener: str, closer: str) -> Optional[str]:
    """Return the first balanced ``opener…closer`` span in *text*."""
    start = text.find(opener)
    if start == -1:
        return None

    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == opener:
            depth += 1
        elif char == closer:
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return None


def extract_json(text: str) -> Optional[Any]:
    """
    Parse the first JSON value embedded in *text*, or return ``None``.

    Tries the whole (de-fenced) string first, then the first balanced array or
    object found inside it, so a response like
    ``Sure! [{"i": 0, ...}] hope that helps`` still parses.
    """
    cleaned = strip_fences(text)
    if not cleaned:
        return None

    try:
        return json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        pass

    for opener, closer in (("[", "]"), ("{", "}")):
        candidate = _balanced_slice(cleaned, opener, closer)
        if candidate:
            try:
                return json.loads(candidate)
            except (json.JSONDecodeError, ValueError):
                continue
    return None


def as_list(payload: Any, *keys: str) -> Optional[list]:
    """
    Coerce *payload* into a list.

    Accepts a bare list, or an object wrapping one under any of *keys*
    (``{"grades": [...]}``, ``{"results": [...]}``, …).
    """
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in keys:
            value = payload.get(key)
            if isinstance(value, list):
                return value
        # Single-key object holding the list, whatever it is called.
        if len(payload) == 1:
            (value,) = payload.values()
            if isinstance(value, list):
                return value
    return None


def clamp_score(value: Any, default: float = 0.0) -> float:
    """Coerce *value* to a float in [0, 1]."""
    try:
        score = float(value)
    except (TypeError, ValueError):
        return default
    if score != score:  # NaN
        return default
    # Some models answer 0-100 instead of 0-1.
    if score > 1.0:
        score = score / 100.0 if score <= 100.0 else 1.0
    return max(0.0, min(1.0, score))
