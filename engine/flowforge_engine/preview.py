"""Bounded, JSON-safe previews of runtime values for events."""
from __future__ import annotations

from typing import Any

MAX_ITEMS = 50
MAX_STR = 300
MAX_DEPTH = 6


def _shrink(v: Any, depth: int) -> tuple[Any, bool]:
    if isinstance(v, str):
        return (v[:MAX_STR] + "…", True) if len(v) > MAX_STR else (v, False)
    if v is None or isinstance(v, (bool, int, float)):
        return v, False
    if depth >= MAX_DEPTH:
        return "…", True
    trunc = False
    if isinstance(v, (list, tuple)):
        out = []
        for item in v[:MAX_ITEMS]:
            s, t = _shrink(item, depth + 1)
            out.append(s)
            trunc = trunc or t
        return out, trunc or len(v) > MAX_ITEMS
    if isinstance(v, dict):
        out_d = {}
        for i, (k, item) in enumerate(v.items()):
            if i >= MAX_ITEMS:
                trunc = True
                break
            s, t = _shrink(item, depth + 1)
            out_d[str(k)] = s
            trunc = trunc or t
        return out_d, trunc
    return str(v)[:MAX_STR], True


def preview(value: Any) -> dict[str, Any]:
    shrunk, truncated = _shrink(value, 0)
    total = len(value) if isinstance(value, (list, tuple)) else None
    return {"preview": shrunk, "truncated": truncated, "totalItems": total}


def preview_map(values: dict[str, Any]) -> dict[str, Any]:
    return {k: preview(v) for k, v in values.items()}
