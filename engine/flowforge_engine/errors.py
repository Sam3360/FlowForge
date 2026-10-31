"""Structured error types shared by the engine."""
from __future__ import annotations

import os
from typing import Any

HINTS: dict[str, str] = {
    "PATH_NOT_FOUND": "Check that the folder still exists and is spelled correctly.",
    "PATH_NOT_ALLOWED": "A run can only use the folders listed in the Run dialog. Choose a folder inside one of them.",
    "PATH_NOT_ABSOLUTE": "Use the Browse button to pick a full folder path.",
    "PATH_INVALID": "Use the Browse button to pick a folder.",
    "PATH_ACCESS_DENIED": "Check the folder's permissions, or choose a folder you are allowed to read.",
    "PATH_ERROR": "Check that the folder is available (not disconnected or in use).",
    "NOT_A_DIRECTORY": "Choose a folder, not a file.",
    "TOO_MANY_FILES": "Add include/exclude patterns to narrow the listing, or raise Max files.",
    "NAME_COLLISION": "Set 'If a file already exists' to skip or rename, or move the existing files out of the way.",
    "MOVE_PARTIAL_FAILURE": "Open this node's Execution tab to see which files failed. Files already moved were not undone.",
    "CONFIRMATION_REQUIRED": "Run a preview first, then confirm applying changes in the Run dialog.",
    "CONFIG_REQUIRED": "Fill in the required setting in the Inspector.",
    "CONFIG_INVALID": "Correct the highlighted setting in the Inspector.",
    "CONFIG_UNKNOWN_FIELD": "Remove the unknown setting; the workflow file may come from a newer version.",
    "NODE_TYPE_UNKNOWN": "This node type is not supported by this version of FlowForge.",
    "START_MISSING": "Drag a Start node from the library onto the canvas.",
    "START_MULTIPLE": "Delete the extra Start node; a workflow has exactly one.",
    "INPUT_NOT_CONNECTED": "Drag from the previous node's output port to this node's input port.",
    "INPUT_MULTIPLE_EDGES": "Remove one of the connections; an input accepts a single connection.",
    "PORT_TYPE_MISMATCH": "Connect ports of the same colour/type (e.g. Files to Files).",
    "PORT_UNKNOWN": "Delete this connection and reconnect it to a valid port.",
    "EDGE_DANGLING": "Delete this connection; it points to a node that no longer exists.",
    "GRAPH_CYCLE": "Remove a connection so the workflow flows one way; loops are not supported yet.",
    "ROOT_INVALID": "Choose existing folders (not a whole drive) for the run.",
    "UNSUPPORTED_SCHEMA_VERSION": "Open the file with a FlowForge version that supports it.",
    "WORKFLOW_INVALID": "The file may be damaged. Try reopening it or restoring a backup.",
    "NODE_INTERNAL_ERROR": "This looks like a bug in FlowForge. Please report it.",
    "NODE_DEAD_END": "Connect this node's output (for example to a Finish node), or ignore this if it is intentional.",
    "FINISH_MISSING": "Add a Finish node at the end of a branch to get a completion summary.",
    "NODE_UNREACHABLE": "Connect this node to the flow starting at Start, or delete it.",
}


def hint_for(code: str) -> str | None:
    return HINTS.get(code)


def short_path(path: object) -> str:
    """Last two path components only, so messages do not expose full absolute paths."""
    parts = [p for p in os.path.normpath(str(path)).replace("\\", "/").split("/") if p]
    return ".../" + "/".join(parts[-2:]) if len(parts) > 2 else str(path)


class EngineError(Exception):
    """An error with a stable machine-readable code and optional details."""

    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}

    def to_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "details": self.details, "hint": hint_for(self.code)}


class CancelledError(Exception):
    """Raised inside a node when the run was cancelled. May carry partial results."""

    def __init__(self, message: str = "Run cancelled", partial: dict[str, Any] | None = None):
        super().__init__(message)
        self.partial = partial or {}
