from __future__ import annotations

from ..context import NodeContext, NodeOutput
from ..registry import ConfigField, NodeDefinition, PortDef


def _norm_ext(e: str) -> str:
    e = e.strip().casefold()
    return e if e.startswith(".") or e == "" else "." + e


def execute(ctx: NodeContext, config: dict, inputs: dict) -> NodeOutput:
    files = inputs["files"]
    exts = {_norm_ext(e) for e in config["extensions"] if e.strip()}
    needle = (config["nameContains"] or "").casefold()
    lo, hi = config["minSize"], config["maxSize"]
    matched, rejected = [], []
    for f in files:
        ok = (not exts or f["extension"] in exts)
        ok = ok and (not needle or needle in f["name"].casefold())
        ok = ok and (lo is None or f["size"] >= lo) and (hi is None or f["size"] <= hi)
        (matched if ok else rejected).append(f)
    ctx.log("info", f"{len(matched)} matched, {len(rejected)} rejected")
    return NodeOutput({"matched": matched, "rejected": rejected},
                      {"matched": len(matched), "rejected": len(rejected), "input": len(files)})


def _extra(config: dict) -> list[tuple[str, str]]:
    lo, hi = config["minSize"], config["maxSize"]
    if lo is not None and hi is not None and lo > hi:
        return [("maxSize", "Max size must be greater than or equal to Min size")]
    return []


DEFINITION = NodeDefinition(
    type="filter", name="Filter", category="Files",
    description="Splits a file list by extension, name and size. An empty result is not an error.",
    inputs=(PortDef("files", "files", "Files"),),
    outputs=(PortDef("matched", "files", "Matched"), PortDef("rejected", "files", "Rejected")),
    config_fields=(
        ConfigField("extensions", "Extensions", "stringList", default=[], placeholder=".pdf",
                    description="Case-insensitive; the leading dot is optional. Empty means any."),
        ConfigField("nameContains", "Name contains", "string", default=""),
        ConfigField("minSize", "Min size (bytes)", "number", default=None, minimum=0),
        ConfigField("maxSize", "Max size (bytes)", "number", default=None, minimum=0),
    ),
    execute=execute, extra_validation=_extra,
)
