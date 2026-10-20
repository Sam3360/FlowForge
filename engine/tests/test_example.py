import importlib.util
import json
from pathlib import Path

from conftest import by_event, run_workflow

ROOT = Path(__file__).resolve().parents[2]


def load_demo_module():
    spec = importlib.util.spec_from_file_location("make_demo", ROOT / "scripts" / "make_demo.py")
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m


def test_example_without_paths_fails_validation_with_clear_messages():
    from conftest import REG
    from flowforge_engine.executor import check_workflow
    raw = json.loads((ROOT / "examples" / "organize-downloads.flowforge.json").read_text("utf-8"))
    _, issues, _ = check_workflow(raw, REG)
    assert {(i.node_id, i.field) for i in issues if i.severity == "error"} == {("list", "directory"), ("move", "destination")}


def test_organize_downloads_preview_then_apply(tmp_path):
    wf_path = load_demo_module().make_demo(tmp_path / "ünï demo")
    raw = json.loads(wf_path.read_text("utf-8"))
    root = wf_path.parent
    _, ev = run_workflow(raw, [root])                      # preview: example ships with dryRun on
    moved = next(e for e in by_event(ev, "node_completed") if e["nodeId"] == "move")
    assert moved["summary"]["planned"] == 3 and moved["summary"]["dryRun"] is True
    assert len(list((root / "demo downloads").iterdir())) == 5

    next(n for n in raw["nodes"] if n["id"] == "move")["config"]["dryRun"] = False
    summary, ev = run_workflow(raw, [root], approved=["move"])
    assert summary["status"] == "success"
    assert sorted(p.name for p in (root / "demo sorted pdfs").iterdir()) == ["invoice-march.pdf", "report final.pdf", "résumé.pdf"]
    assert sorted(p.name for p in (root / "demo downloads").iterdir()) == ["notes.txt", "photo.jpg"]
    fin = next(e for e in by_event(ev, "node_completed") if e["nodeId"] == "finish")
    assert fin["summary"]["receivedCounts"]["moved"] == 3
