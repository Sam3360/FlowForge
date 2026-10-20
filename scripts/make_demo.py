"""Create a throw-away demo folder and a ready-to-run copy of the Organize Downloads example.

    python scripts/make_demo.py [target_dir]

Never touches your real Downloads folder: it only creates files under target_dir
(default: a new temp directory).
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def make_demo(target: Path) -> Path:
    inbox, out = target / "demo downloads", target / "demo sorted pdfs"
    inbox.mkdir(parents=True, exist_ok=True)
    for name in ("invoice-march.pdf", "résumé.pdf", "notes.txt", "photo.jpg", "report final.pdf"):
        (inbox / name).write_text(f"demo content of {name}\n", encoding="utf-8")
    wf = json.loads((ROOT / "examples" / "organize-downloads.flowforge.json").read_text("utf-8"))
    for n in wf["nodes"]:
        if n["id"] == "list":
            n["config"]["directory"] = str(inbox)
        if n["id"] == "move":
            n["config"]["destination"] = str(out)
    path = target / "organize-demo.flowforge.json"
    path.write_text(json.dumps(wf, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix="flowforge-demo-"))
    print(make_demo(target))
