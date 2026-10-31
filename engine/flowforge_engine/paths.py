"""Path validation: the engine's (small) permission model.

Allowed roots are supplied by the *host* with each run request, never read
from the workflow file, so an imported workflow cannot grant itself access.
"""
from __future__ import annotations

import os

from .errors import EngineError, short_path


def _norm(p: str) -> str:
    return os.path.normcase(os.path.realpath(p))


class PathPolicy:
    def __init__(self, roots: list[str]):
        self.roots = [_norm(r) for r in roots]

    def contains(self, real: str) -> bool:
        n = os.path.normcase(real)
        for root in self.roots:
            try:
                if os.path.commonpath([root, n]) == root:
                    return True
            except ValueError:  # different drives
                continue
        return False

    def resolve(self, path: str) -> str:
        """Return the real (symlink-resolved) path if inside an allowed root."""
        if not isinstance(path, str) or not path or "\x00" in path:
            raise EngineError("PATH_INVALID", "Path is empty or contains invalid characters")
        if not os.path.isabs(path):
            raise EngineError("PATH_NOT_ABSOLUTE", f"Path must be absolute: {short_path(path)}")
        real = os.path.realpath(path)
        if not self.contains(real):
            raise EngineError(
                "PATH_NOT_ALLOWED",
                f"Path is outside the folders you approved for this run: {short_path(path)}",
                {"path": short_path(path)},
            )
        return real


def validate_roots(roots: list[str]) -> list[str]:
    """Return human-readable problems with the approved roots."""
    problems = []
    for r in roots:
        if not isinstance(r, str) or not os.path.isabs(r):
            problems.append("Approved folder must be an absolute path")
        elif os.path.dirname(os.path.normpath(r)) == os.path.normpath(r):
            problems.append("Approving a whole drive or filesystem root is not allowed")
        elif not os.path.isdir(r):
            # A folder that will be created by the run (e.g. a new destination) may be approved,
            # but only if its parent exists, so at most one new folder can appear.
            if os.path.exists(r) or not os.path.isdir(os.path.dirname(os.path.normpath(r))):
                problems.append(f"Approved folder does not exist: {short_path(r)}")
    return problems
