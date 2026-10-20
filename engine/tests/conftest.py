from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
from pathlib import Path

import pytest

from flowforge_engine.context import RunOptions
from flowforge_engine.executor import Run, check_workflow, preflight
from flowforge_engine.nodes import build_registry
from flowforge_engine.workflow import has_errors

REG = build_registry()


def wf(nodes, edges, **extra):
    return {"schemaVersion": 1, "name": "t", "nodes": nodes, "edges": edges, **extra}


def node(id, type, **config):
    return {"id": id, "type": type, "config": config, "position": {"x": 0, "y": 0}}


def edge(src, sp, dst, dp, id=None):
    return {"id": id or f"{src}-{sp}-{dst}-{dp}", "source": src, "sourcePort": sp, "target": dst, "targetPort": dp}


def organize(src, dest, ext=".txt", dry=True, collision="fail", create=False):
    return wf(
        [node("s", "start"), node("l", "list_files", directory=str(src)),
         node("f", "filter", extensions=[ext]),
         node("m", "move_file", destination=str(dest), dryRun=dry, collision=collision, createDestination=create),
         node("e", "finish")],
        [edge("s", "out", "l", "in"), edge("l", "files", "f", "files"),
         edge("f", "matched", "m", "files"), edge("m", "moved", "e", "in")])


def run_workflow(raw, roots, dry_run=False, approved=(), cancel=None, on_event=None):
    events: list[dict] = []

    def emit(e):
        events.append(e)
        if on_event:
            on_event(e)

    parsed, issues, configs = check_workflow(raw, REG)
    if parsed is not None and not has_errors(issues):
        issues += preflight(parsed, configs, REG, RunOptions(dry_run, [str(r) for r in roots], set(approved)))
    assert not has_errors(issues), [i.to_dict() for i in issues]
    run = Run(parsed, configs, REG, RunOptions(dry_run, [str(r) for r in roots], set(approved)), emit, cancel or threading.Event())
    summary = run.execute()
    return summary, events


def by_event(events, name):
    return [e for e in events if e["event"] == name]


@pytest.fixture
def tree(tmp_path: Path):
    """A temp source dir with a few files and an empty destination dir."""
    src, dest = tmp_path / "Quelle ünï", tmp_path / "dest dir"
    src.mkdir(); dest.mkdir()
    (src / "a.txt").write_text("a")
    (src / "b.TXT").write_text("bb")
    (src / "c.pdf").write_text("c")
    (src / ".hidden.txt").write_text("h")
    sub = src / "sub"; sub.mkdir()
    (sub / "d.txt").write_text("d")
    return tmp_path, src, dest


class EngineProc:
    """Real subprocess speaking the NDJSON protocol."""

    def __init__(self):
        self.p = subprocess.Popen([sys.executable, "-m", "flowforge_engine"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, cwd=str(Path(__file__).resolve().parents[1]))

    def send_raw(self, data: bytes):
        self.p.stdin.write(data); self.p.stdin.flush()

    def send(self, obj):
        self.send_raw(json.dumps(obj).encode() + b"\n")

    def read(self):
        line = self.p.stdout.readline()
        assert line, "engine closed stdout"
        return json.loads(line)

    def read_until(self, pred):
        out = []
        while True:
            m = self.read(); out.append(m)
            if pred(m):
                return out

    def close(self):
        try:
            self.p.stdin.close()
        except Exception:
            pass
        self.p.wait(timeout=10)
        self.p.stdout.close(); self.p.stderr.close()


@pytest.fixture
def engine():
    e = EngineProc()
    yield e
    e.close()
