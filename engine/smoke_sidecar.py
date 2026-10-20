"""Smoke-test a built sidecar: handshake, describe, a real preview run in a temp dir with non-ASCII/space paths, shutdown."""
import json, subprocess, sys, tempfile
from pathlib import Path

exe = sys.argv[1]
tmp = Path(tempfile.mkdtemp(prefix="ff smoke ünï "))
(tmp / "in").mkdir(); (tmp / "in" / "a.txt").write_text("a", encoding="utf-8")
p = subprocess.Popen([exe], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def call(obj):
    p.stdin.write(json.dumps(obj).encode() + b"\n"); p.stdin.flush()


def read():
    return json.loads(p.stdout.readline().decode("utf-8"))


call({"id": 1, "type": "hello", "protocolVersion": 1}); assert read()["ok"]
call({"id": 2, "type": "describe"}); assert len(read()["result"]["nodes"]) == 6
wf = {"schemaVersion": 1, "name": "s", "nodes": [{"id": "s", "type": "start"}, {"id": "l", "type": "list_files", "config": {"directory": str(tmp / "in")}},
      {"id": "e", "type": "finish"}], "edges": [{"id": "1", "source": "s", "sourcePort": "out", "target": "l", "targetPort": "in"},
      {"id": "2", "source": "l", "sourcePort": "files", "target": "e", "targetPort": "in"}]}
call({"id": 3, "type": "run", "workflow": wf, "options": {"allowedRoots": [str(tmp)]}})
while True:
    m = read()
    if m.get("event") == "run_completed":
        assert m["status"] == "success", m; break
call({"id": 4, "type": "shutdown"}); assert read()["ok"]
assert p.wait(timeout=15) == 0
print("sidecar smoke test OK")
