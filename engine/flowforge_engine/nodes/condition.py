from __future__ import annotations

import operator

from ..context import NodeContext, NodeOutput
from ..registry import ConfigField, NodeDefinition, PortDef

OPS = {"eq": operator.eq, "ne": operator.ne, "gt": operator.gt, "gte": operator.ge,
       "lt": operator.lt, "lte": operator.le}


def execute(ctx: NodeContext, config: dict, inputs: dict) -> NodeOutput:
    files = inputs["files"]
    actual = len(files) if config["subject"] == "count" else sum(f["size"] for f in files)
    result = OPS[config["operator"]](actual, config["value"])
    branch = "true" if result else "false"
    ctx.log("info", f"{config['subject']} {config['operator']} {config['value']:g}: actual {actual} -> {branch}")
    return NodeOutput({branch: files}, {"branch": branch, "subject": config["subject"], "operator": config["operator"],
                                        "expected": config["value"], "actual": actual})


DEFINITION = NodeDefinition(
    type="condition", name="Condition", category="Flow",
    description="Routes a file list down the true or false branch. Compares the file count or total size; no expressions.",
    inputs=(PortDef("files", "files", "Files"),),
    outputs=(PortDef("true", "files", "True"), PortDef("false", "files", "False")),
    config_fields=(
        ConfigField("subject", "Compare", "enum", default="count", options=("count", "totalSize")),
        ConfigField("operator", "Operator", "enum", default="gt", options=tuple(OPS)),
        ConfigField("value", "Value", "number", default=0, required=True),
    ),
    execute=execute,
)
