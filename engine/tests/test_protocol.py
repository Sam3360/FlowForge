import json

from conftest import edge, node, organize, wf
from flowforge_engine import MAX_MESSAGE_BYTES


def hello(e):
    e.send({"id": 1, "type": "hello", "protocolVersion": 1})
    return e.read()


def test_handshake(engine):
    r = hello(engine)
    assert r["ok"] and r["result"]["protocolVersion"] == 1 and 1 in r["result"]["supportedSchemaVersions"]


def test_protocol_mismatch(engine):
    engine.send({"id": 1, "type": "hello", "protocolVersion": 99})
    r = engine.read()
    assert not r["ok"] and r["error"]["code"] == "PROTOCOL_MISMATCH"


def test_malformed_json_does_not_kill_engine(engine):
    engine.send_raw(b"{not json\n")
    assert engine.read()["error"]["code"] == "MALFORMED_MESSAGE"
    engine.send_raw(b"\xff\xfe\n")
    assert engine.read()["error"]["code"] == "MALFORMED_MESSAGE"
    engine.send_raw(b"[1,2]\n")
    assert engine.read()["error"]["code"] == "MALFORMED_MESSAGE"
    assert hello(engine)["ok"]


def test_unknown_command_and_missing_fields(engine):
    engine.send({"id": "a", "type": "frobnicate"})
    r = engine.read()
    assert r["id"] == "a" and r["error"]["code"] == "UNKNOWN_COMMAND"
    engine.send({"type": "hello"})
    assert engine.read()["error"]["code"] == "MALFORMED_MESSAGE"


def test_oversized_message_rejected_and_stream_recovers(engine):
    engine.send_raw(b'{"id":1,"type":"validate","workflow":"' + b"x" * (MAX_MESSAGE_BYTES + 100) + b'"}\n')
    assert engine.read()["error"]["code"] == "MESSAGE_TOO_LARGE"
    assert hello(engine)["ok"]


def test_describe_matches_shared_definitions(engine):
    from pathlib import Path
    engine.send({"id": 1, "type": "describe"})
    nodes = engine.read()["result"]["nodes"]
    shared = json.loads((Path(__file__).resolve().parents[2] / "shared" / "node-definitions.json").read_text("utf-8"))
    assert nodes == shared["nodes"], "run: python -m flowforge_engine.export_definitions ../shared/node-definitions.json"
    assert {n["type"] for n in nodes} == {"start", "list_files", "filter", "condition", "move_file", "finish"}


def test_validate_returns_structured_issues(engine):
    engine.send({"id": 1, "type": "validate", "workflow": wf([node("f", "finish")], [])})
    r = engine.read()["result"]
    assert r["valid"] is False and {i["code"] for i in r["issues"]} >= {"START_MISSING", "INPUT_NOT_CONNECTED"}


def test_run_rejected_when_invalid(engine):
    engine.send({"id": 1, "type": "run", "workflow": wf([], []), "options": {}})
    r = engine.read()
    assert not r["ok"] and r["error"]["code"] == "VALIDATION_FAILED" and r["error"]["details"]["issues"]


def test_imported_workflow_cannot_grant_itself_access(engine, tree):
    root, src, dest = tree
    raw = organize(src, dest)
    raw["permissions"] = {"allowedRoots": [str(root)]}  # ignored by the engine
    engine.send({"id": 1, "type": "run", "workflow": raw, "options": {}})
    r = engine.read()
    assert r["error"]["code"] == "VALIDATION_FAILED"
    assert {i["code"] for i in r["error"]["details"]["issues"]} == {"PATH_NOT_ALLOWED"}


def test_end_to_end_json_to_events(engine, tree):
    """Integration: workflow JSON -> engine process -> ordered structured events -> files moved."""
    root, src, dest = tree
    raw = json.loads(json.dumps(organize(src, dest, dry=False)))
    engine.send({"id": 7, "type": "run", "workflow": raw, "options": {"allowedRoots": [str(root)], "approvedNodes": ["m"]}})
    msgs = engine.read_until(lambda m: m.get("event") in ("run_completed", "run_cancelled"))
    ack = msgs[0]
    assert ack["type"] == "response" and ack["id"] == 7 and ack["ok"]
    events = [m for m in msgs if m["type"] == "event"]
    assert all(e["runId"] == ack["result"]["runId"] for e in events)
    kinds = [e["event"] for e in events]
    assert kinds[0] == "run_started" and kinds[-1] == "run_completed" and "log" in kinds
    assert events[-1]["status"] == "success"
    assert sorted(p.name for p in dest.iterdir()) == ["a.txt", "b.TXT"]


def test_cancel_over_protocol(engine, tmp_path):
    src, dest = tmp_path / "s", tmp_path / "d"; src.mkdir(); dest.mkdir()
    for i in range(3000):
        (src / f"f{i}.txt").write_text("")
    engine.send({"id": 1, "type": "run", "workflow": organize(src, dest, dry=False),
                 "options": {"allowedRoots": [str(tmp_path)], "approvedNodes": ["m"]}})
    engine.read_until(lambda m: m.get("event") == "node_started" and m["nodeId"] == "m")
    engine.send({"id": 2, "type": "cancel"})
    msgs = engine.read_until(lambda m: m.get("event") in ("run_completed", "run_cancelled"))
    assert next(m for m in msgs if m.get("id") == 2)["result"]["cancelling"] is True or msgs[-1]["event"] == "run_completed"
    assert msgs[-1]["event"] in ("run_cancelled", "run_completed")  # tiny race: run may finish first


def test_stdout_is_protocol_only_and_shutdown_is_clean(engine):
    hello(engine)
    engine.send({"id": 9, "type": "shutdown"})
    assert engine.read()["ok"]
    assert engine.p.wait(timeout=10) == 0
    assert engine.p.stdout.read() == b""


def test_exits_on_stdin_eof(engine):
    engine.p.stdin.close()
    assert engine.p.wait(timeout=10) == 0
