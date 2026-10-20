"""Writes shared/node-definitions.json (consumed by the frontend)."""
import json
import sys

from .nodes import build_registry

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else None
    text = json.dumps({"nodes": build_registry().describe()}, indent=2, ensure_ascii=False) + "\n"
    if out:
        with open(out, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
    else:
        sys.stdout.write(text)
