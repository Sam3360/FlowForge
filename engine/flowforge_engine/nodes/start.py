from __future__ import annotations

from datetime import datetime, timezone

from ..context import NodeContext, NodeOutput
from ..registry import NodeDefinition, PortDef


def execute(ctx: NodeContext, config: dict, inputs: dict) -> NodeOutput:
    context = {
        "runId": ctx.run_id,
        "startedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        "dryRun": ctx.options.dry_run,
    }
    return NodeOutput({"out": context}, {"message": "Run started"})


DEFINITION = NodeDefinition(
    type="start", name="Start", category="Flow",
    description="Entry point. Every workflow has exactly one Start node.",
    inputs=(), outputs=(PortDef("out", "context", "Context"),),
    config_fields=(), execute=execute,
)
