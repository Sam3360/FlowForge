"""Runtime context handed to node implementations."""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Any, Callable

from .errors import CancelledError
from .paths import PathPolicy


@dataclass
class RunOptions:
    dry_run: bool = False                      # force every side-effecting node into preview mode
    allowed_roots: list[str] = field(default_factory=list)
    approved_nodes: set[str] = field(default_factory=set)


@dataclass
class NodeOutput:
    outputs: dict[str, Any] = field(default_factory=dict)   # only ports that are *active*
    summary: dict[str, Any] = field(default_factory=dict)


class NodeContext:
    def __init__(self, run_id: str, node_id: str, options: RunOptions, policy: PathPolicy,
                 cancel: threading.Event, log: Callable[[str, str, str], None]):
        self.run_id = run_id
        self.node_id = node_id
        self.options = options
        self.policy = policy
        self._cancel = cancel
        self._log = log

    def log(self, level: str, message: str) -> None:
        self._log(self.node_id, level, message)

    def check_cancelled(self, partial: dict[str, Any] | None = None) -> None:
        if self._cancel.is_set():
            raise CancelledError(partial=partial)

    def effective_dry_run(self, node_dry_run: bool) -> bool:
        return True if self.options.dry_run else node_dry_run
