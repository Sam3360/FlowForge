# Nodes

| type | purpose | key config |
|---|---|---|
| `start` | entry point, outputs run context | - |
| `list_files` | list files in a folder; directory symlinks/junctions never followed | `directory`, `recursive`(false), `include`/`exclude` globs, `includeHidden`, `maxFiles`(10000; fails rather than truncating) |
| `filter` | split files into `matched` / `rejected` | `extensions`, `nameContains`, `minSize`, `maxSize` (AND). Empty result is fine |
| `condition` | route to `true` / `false` | `subject` (`count`\|`totalSize`), `operator` (`eq ne gt gte lt lte`), `value`. No expressions |
| `move_file` | move files into a folder | `destination`, `collision` (`fail`\|`skip`\|`rename`), `createDestination`, `dryRun`(true) |
| `finish` | end of a branch, reports summary | - |

Move File: collisions are detected against existing files **and** other planned moves; `fail` moves nothing; `rename` yields `name (1).ext`; the move primitive uses hard-link/`open("xb")` so it cannot overwrite even under a race. Symlink sources are skipped. Partial failure raises `MOVE_PARTIAL_FAILURE` with per-file results; moves already done are never rolled back (and are reported as such).

## Adding a node

1. Create `engine/flowforge_engine/nodes/my_node.py`:
```python
from ..context import NodeContext, NodeOutput
from ..registry import ConfigField, NodeDefinition, PortDef

def execute(ctx: NodeContext, config: dict, inputs: dict) -> NodeOutput:
    ctx.check_cancelled()                       # call in loops
    ctx.log("info", "doing work")
    path = ctx.policy.resolve(config["folder"]) # ALWAYS resolve paths through the policy
    return NodeOutput({"out": inputs["files"]}, {"count": len(inputs["files"])})  # only active ports

DEFINITION = NodeDefinition(
    type="my_node", name="My Node", category="Files", description="...",
    inputs=(PortDef("files", "files", "Files"),), outputs=(PortDef("out", "files", "Out"),),
    config_fields=(ConfigField("folder", "Folder", "path", required=True, path_kind="directory"),),
    execute=execute, side_effects=False)
```
2. Add the module to `BUILTIN_MODULES` in `nodes/__init__.py`.
3. `python -m flowforge_engine.export_definitions ../shared/node-definitions.json` (the library, ports and inspector form appear automatically; add an icon in `app/src/components/icons.ts` if desired).
4. Write tests in `engine/tests/` using temp dirs. Raise `EngineError(code, message, details)` for expected failures.
Side-effecting nodes must default to preview, set `side_effects=True, requires_confirmation=True`, and honour `ctx.effective_dry_run(...)`. Path-typed config fields are automatically checked against the approved folders in preflight.
