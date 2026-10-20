from __future__ import annotations

from ..context import NodeContext, NodeOutput
from ..registry import NodeDefinition, PortDef


def execute(ctx: NodeContext, config: dict, inputs: dict) -> NodeOutput:
    data = inputs.get("in")
    summary: dict = {"message": "Branch finished successfully"}
    if isinstance(data, list):
        summary["receivedItems"] = len(data)
    elif isinstance(data, dict) and "counts" in data:
        summary["receivedCounts"] = data["counts"]
        summary["dryRun"] = data.get("dryRun")
    ctx.log("info", summary["message"])
    return NodeOutput({}, summary)


DEFINITION = NodeDefinition(
    type="finish", name="Finish", category="Flow",
    description="Ends a workflow branch successfully and reports a summary of what it received.",
    inputs=(PortDef("in", "any", "Input"),), outputs=(),
    config_fields=(), execute=execute,
)
