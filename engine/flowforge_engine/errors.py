"""Structured error types shared by the engine."""
from __future__ import annotations

from typing import Any


class EngineError(Exception):
    """An error with a stable machine-readable code and optional details."""

    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}

    def to_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "details": self.details}


class CancelledError(Exception):
    """Raised inside a node when the run was cancelled. May carry partial results."""

    def __init__(self, message: str = "Run cancelled", partial: dict[str, Any] | None = None):
        super().__init__(message)
        self.partial = partial or {}
