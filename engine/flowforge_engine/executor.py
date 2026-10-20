"""Graph scheduler: preflight checks and execution."""
from __future__ import annotations

import os
import threading
import time
import traceback
import sys
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

from .context import NodeContext, NodeOutput, RunOptions
from .errors import CancelledError, EngineError
from .paths import PathPolicy, validate_roots
from .preview import preview, preview_map
from .registry import Registry
from .workflow import (Issue, Workflow, has_errors, parse_workflow, reachable_from,
                       topological_order, validate_workflow)

Emit = Callable[[dict[str, Any]], None]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def check_workflow(raw: Any, reg: Registry) -> tuple[Workflow | None, list[Issue], dict[str, dict[str, Any]]]:
    wf, issues = parse_workflow(raw)
    if wf is None or has_errors(issues):
        return wf, issues, {}
    more, configs = validate_workflow(wf, reg)
    return wf, issues + more, configs


def preflight(wf: Workflow, configs: dict[str, dict[str, Any]], reg: Registry, options: RunOptions) -> list[Issue]:
    """Run-time checks that depend on host-supplied permissions and approvals."""
    issues: list[Issue] = []
    for p in validate_roots(options.allowed_roots):
        issues.append(Issue("error", "ROOT_INVALID", p))
    if any(i.severity == "error" for i in issues):
        return issues
    policy = PathPolicy(options.allowed_roots)
    for n in wf.nodes.values():
        d = reg.get(n.type)
        if d is None or n.id not in configs:
            continue
        for f in d.config_fields:
            val = configs[n.id].get(f.name)
            if f.type == "path" and isinstance(val, str) and val:
                try:
                    policy.resolve(val)
                except EngineError as e:
                    issues.append(Issue("error", e.code, e.message, node_id=n.id, field=f.name))
        if d.side_effects and d.requires_confirmation and not options.dry_run:
            cfg = configs[n.id]
            if cfg.get("dryRun") is False and n.id not in options.approved_nodes:
                issues.append(Issue("error", "CONFIRMATION_REQUIRED",
                                    f"'{d.name}' would change files but was not confirmed for this run", node_id=n.id))
    return issues


class Run:
    def __init__(self, wf: Workflow, configs: dict[str, dict[str, Any]], reg: Registry,
                 options: RunOptions, emit: Emit, cancel: threading.Event, run_id: str | None = None):
        self.wf, self.configs, self.reg, self.options = wf, configs, reg, options
        self._emit, self.cancel = emit, cancel
        self.run_id = run_id or uuid.uuid4().hex[:12]
        self._seq = 0
        self.policy = PathPolicy(options.allowed_roots)

    def emit(self, event: str, **payload: Any) -> None:
        self._seq += 1
        self._emit({"type": "event", "event": event, "runId": self.run_id, "seq": self._seq, "ts": now_iso(), **payload})

    def _log(self, node_id: str, level: str, message: str) -> None:
        self.emit("log", nodeId=node_id, level=level, message=message[:2000])

    def execute(self) -> dict[str, Any]:
        wf, reg = self.wf, self.reg
        order, _ = topological_order(wf)
        starts = [n.id for n in wf.nodes.values() if n.type == "start"]
        reach = reachable_from(wf, starts[:1])
        incoming: dict[str, list] = {}
        for e in wf.edges:
            incoming.setdefault(e.target, []).append(e)
        t_run = time.perf_counter()
        self.emit("run_started", workflowName=wf.name, order=order, dryRun=self.options.dry_run)

        values: dict[tuple[str, str], Any] = {}   # active output ports only
        status: dict[str, str] = {}
        durations: dict[str, float] = {}
        run_status = "success"
        aborted_by: str | None = None

        for idx, nid in enumerate(order):
            node = wf.nodes[nid]
            defn = reg.get(node.type)
            assert defn is not None  # guaranteed by validation
            skip_reason = None
            if self.cancel.is_set():
                run_status = "cancelled"
                skip_reason = "run cancelled"
            elif aborted_by:
                skip_reason = f"run aborted after '{aborted_by}' failed"
            elif nid not in reach:
                skip_reason = "not reachable from Start"
            else:
                for e in incoming.get(nid, []):
                    if (e.source, e.source_port) not in values:
                        src_status = status.get(e.source)
                        skip_reason = (f"branch not taken ('{e.source_port}' of '{e.source}' was not active)"
                                       if src_status == "completed" else f"upstream node '{e.source}' did not run")
                        break
            if skip_reason:
                status[nid] = "skipped"
                self.emit("node_skipped", nodeId=nid, reason=skip_reason)
                continue

            inputs = {e.target_port: values[(e.source, e.source_port)] for e in incoming.get(nid, [])}
            ctx = NodeContext(self.run_id, nid, self.options, self.policy, self.cancel, self._log)
            self.emit("node_started", nodeId=nid, nodeType=node.type, inputs=preview_map(inputs))
            t0 = time.perf_counter()
            try:
                res: NodeOutput = defn.execute(ctx, self.configs[nid], inputs)
                ms = round((time.perf_counter() - t0) * 1000, 2)
                durations[nid] = ms
                status[nid] = "completed"
                for port, val in res.outputs.items():
                    values[(nid, port)] = val
                self.emit("node_completed", nodeId=nid, durationMs=ms, activePorts=list(res.outputs),
                          outputs=preview_map(res.outputs), summary=preview(res.summary)["preview"])
            except CancelledError as c:
                ms = round((time.perf_counter() - t0) * 1000, 2)
                durations[nid] = ms
                status[nid] = "cancelled"
                run_status = "cancelled"
                self.emit("node_cancelled", nodeId=nid, durationMs=ms, message=str(c), partial=preview(c.partial)["preview"])
            except EngineError as e:
                ms = round((time.perf_counter() - t0) * 1000, 2)
                durations[nid] = ms
                status[nid] = "failed"
                aborted_by, run_status = nid, "failed"
                self.emit("node_failed", nodeId=nid, durationMs=ms,
                          error={"code": e.code, "message": e.message, "details": preview(e.details)["preview"]})
            except Exception as e:  # noqa: BLE001 - node bugs must not kill the engine
                ms = round((time.perf_counter() - t0) * 1000, 2)
                durations[nid] = ms
                status[nid] = "failed"
                aborted_by, run_status = nid, "failed"
                traceback.print_exc(file=sys.stderr)
                self.emit("node_failed", nodeId=nid, durationMs=ms,
                          error={"code": "NODE_INTERNAL_ERROR", "message": f"{type(e).__name__}: {str(e)[:500]}", "details": {}})

        counts: dict[str, int] = {}
        for s in status.values():
            counts[s] = counts.get(s, 0) + 1
        total_ms = round((time.perf_counter() - t_run) * 1000, 2)
        summary = {"status": run_status, "durationMs": total_ms, "counts": counts, "failedNode": aborted_by,
                   "note": ("Cancellation stops further work but cannot undo operations that already completed."
                            if run_status == "cancelled" else None)}
        self.emit("run_cancelled" if run_status == "cancelled" else "run_completed", **summary)
        return summary
