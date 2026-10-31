"""NDJSON protocol server. stdout carries protocol messages only; diagnostics go to stderr."""
from __future__ import annotations

import json
import sys
import threading
import uuid
from typing import Any, BinaryIO

from . import ENGINE_VERSION, MAX_MESSAGE_BYTES, PROTOCOL_VERSION, SUPPORTED_SCHEMA_VERSIONS
from .context import RunOptions
from .errors import EngineError, hint_for
from .executor import Run, check_workflow, preflight
from .nodes import build_registry
from .workflow import has_errors


class Server:
    def __init__(self, stdin: BinaryIO, stdout: BinaryIO):
        self.stdin, self.stdout = stdin, stdout
        self.registry = build_registry()
        self._write_lock = threading.Lock()
        self._run_thread: threading.Thread | None = None
        self._cancel = threading.Event()
        self._current_run_id: str | None = None
        self._stop = False

    # ---- output -----------------------------------------------------------
    def send(self, msg: dict[str, Any]) -> None:
        data = json.dumps(msg, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")
        if len(data) > MAX_MESSAGE_BYTES:  # never emit a line the client must reject
            msg = {"type": "event", "event": "log", "runId": msg.get("runId"), "level": "error",
                   "message": "An event was dropped because it exceeded the maximum message size"}
            data = json.dumps(msg).encode("utf-8")
        try:
            with self._write_lock:
                self.stdout.write(data + b"\n")
                self.stdout.flush()
        except (BrokenPipeError, OSError):  # the host went away: stop work instead of crashing noisily
            self._cancel.set()
            self._stop = True

    def ok(self, req_id: Any, result: dict[str, Any]) -> None:
        self.send({"type": "response", "id": req_id, "ok": True, "result": result})

    def fail(self, req_id: Any, code: str, message: str, details: dict[str, Any] | None = None) -> None:
        self.send({"type": "response", "id": req_id, "ok": False, "error": {"code": code, "message": message, "details": details or {}, "hint": hint_for(code)}})

    # ---- input ------------------------------------------------------------
    def _read_line(self) -> tuple[bytes | None, bool]:
        """Returns (line, too_large). line None means EOF."""
        line = self.stdin.readline(MAX_MESSAGE_BYTES + 1)
        if not line:
            return None, False
        if len(line) > MAX_MESSAGE_BYTES and not line.endswith(b"\n"):
            while True:  # drain the rest of the oversize line without buffering it
                rest = self.stdin.readline(65536)
                if not rest or rest.endswith(b"\n"):
                    break
            return b"", True
        return line, False

    def serve(self) -> int:
        while not self._stop:
            line, too_large = self._read_line()
            if line is None:
                break
            if too_large:
                self.fail(None, "MESSAGE_TOO_LARGE", f"Message exceeds {MAX_MESSAGE_BYTES} bytes and was discarded")
                continue
            if not line.strip():
                continue
            self.handle_line(line)
        self._cancel.set()
        if self._run_thread:
            self._run_thread.join(timeout=5)
        return 0

    def handle_line(self, line: bytes) -> None:
        try:
            msg = json.loads(line.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            self.fail(None, "MALFORMED_MESSAGE", f"Message is not valid UTF-8 JSON: {e}")
            return
        if not isinstance(msg, dict) or "id" not in msg or not isinstance(msg.get("type"), str):
            self.fail(msg.get("id") if isinstance(msg, dict) else None, "MALFORMED_MESSAGE",
                      "Message must be an object with 'id' and a string 'type'")
            return
        req_id = msg["id"]
        handler = getattr(self, f"cmd_{msg['type']}", None)
        if handler is None:
            self.fail(req_id, "UNKNOWN_COMMAND", f"Unknown command '{msg['type']}'")
            return
        try:
            handler(req_id, msg)
        except EngineError as e:
            self.fail(req_id, e.code, e.message, e.details)
        except Exception as e:  # noqa: BLE001
            import traceback
            traceback.print_exc(file=sys.stderr)
            self.fail(req_id, "INTERNAL_ERROR", f"{type(e).__name__}: {e}")

    # ---- commands ---------------------------------------------------------
    def cmd_hello(self, req_id: Any, msg: dict) -> None:
        if msg.get("protocolVersion") != PROTOCOL_VERSION:
            raise EngineError("PROTOCOL_MISMATCH", f"Engine speaks protocol {PROTOCOL_VERSION}, client sent {msg.get('protocolVersion')!r}",
                              {"engineProtocolVersion": PROTOCOL_VERSION})
        self.ok(req_id, {"protocolVersion": PROTOCOL_VERSION, "engineVersion": ENGINE_VERSION,
                         "supportedSchemaVersions": list(SUPPORTED_SCHEMA_VERSIONS), "maxMessageBytes": MAX_MESSAGE_BYTES})

    def cmd_describe(self, req_id: Any, msg: dict) -> None:
        self.ok(req_id, {"nodes": self.registry.describe()})

    def _options(self, msg: dict) -> RunOptions:
        raw = msg.get("options") or {}
        if not isinstance(raw, dict):
            raise EngineError("OPTIONS_INVALID", "'options' must be an object")
        roots, approved = raw.get("allowedRoots", []), raw.get("approvedNodes", [])
        if not isinstance(roots, list) or not all(isinstance(r, str) for r in roots):
            raise EngineError("OPTIONS_INVALID", "options.allowedRoots must be a list of strings")
        if not isinstance(approved, list) or not all(isinstance(r, str) for r in approved):
            raise EngineError("OPTIONS_INVALID", "options.approvedNodes must be a list of strings")
        return RunOptions(dry_run=raw.get("dryRun") is True, allowed_roots=roots, approved_nodes=set(approved))

    def cmd_validate(self, req_id: Any, msg: dict) -> None:
        wf, issues, configs = check_workflow(msg.get("workflow"), self.registry)
        if wf is not None and not has_errors(issues) and msg.get("options") is not None:
            issues += preflight(wf, configs, self.registry, self._options(msg))
        self.ok(req_id, {"valid": not has_errors(issues), "issues": [i.to_dict() for i in issues]})

    def cmd_run(self, req_id: Any, msg: dict) -> None:
        if self._run_thread and self._run_thread.is_alive():
            raise EngineError("RUN_IN_PROGRESS", "A run is already in progress")
        options = self._options(msg)
        wf, issues, configs = check_workflow(msg.get("workflow"), self.registry)
        if wf is not None and not has_errors(issues):
            issues += preflight(wf, configs, self.registry, options)
        if wf is None or has_errors(issues):
            raise EngineError("VALIDATION_FAILED", "Workflow failed validation; nothing was executed",
                              {"issues": [i.to_dict() for i in issues]})
        run_id = uuid.uuid4().hex[:12]
        self._cancel = threading.Event()
        run = Run(wf, configs, self.registry, options, self.send, self._cancel, run_id)
        self._current_run_id = run_id
        self.ok(req_id, {"runId": run_id, "warnings": [i.to_dict() for i in issues]})

        def target() -> None:
            try:
                run.execute()
            except Exception as e:  # noqa: BLE001 - scheduler bug; report, don't die silently
                import traceback
                traceback.print_exc(file=sys.stderr)
                self.send({"type": "event", "event": "run_completed", "runId": run_id, "status": "failed",
                           "error": {"code": "ENGINE_BUG", "message": f"{type(e).__name__}: {e}"}})
        self._run_thread = threading.Thread(target=target, name=f"run-{run_id}", daemon=True)
        self._run_thread.start()

    def cmd_cancel(self, req_id: Any, msg: dict) -> None:
        active = bool(self._run_thread and self._run_thread.is_alive())
        if active:
            self._cancel.set()
        self.ok(req_id, {"cancelling": active, "runId": self._current_run_id if active else None})

    def cmd_shutdown(self, req_id: Any, msg: dict) -> None:
        self._cancel.set()
        self.ok(req_id, {})
        self._stop = True


def main() -> int:
    stdin, stdout = sys.stdin.buffer, sys.stdout.buffer
    sys.stdout = sys.stderr  # stray print() calls can never corrupt the protocol stream
    return Server(stdin, stdout).serve()
