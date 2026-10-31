from __future__ import annotations

import os
import shutil

from ..context import NodeContext, NodeOutput
from ..errors import CancelledError, EngineError, short_path
from ..registry import ConfigField, NodeDefinition, PortDef


def move_no_overwrite(src: str, dst: str) -> None:
    """Move src to dst, raising FileExistsError instead of ever replacing dst."""
    try:
        os.link(src, dst)           # atomic and fails if dst exists
    except FileExistsError:
        raise
    except OSError:                 # cross-device, FS without hard links, ...
        try:
            with open(src, "rb") as s, open(dst, "xb") as d:   # "x" refuses to overwrite
                shutil.copyfileobj(s, d)
            shutil.copystat(src, dst)
        except FileExistsError:
            raise
        except BaseException:
            try:
                os.unlink(dst)      # remove the partial copy we created
            except OSError:
                pass
            raise
    os.unlink(src)


def _unique(dest_dir: str, name: str, taken: set[str]) -> str:
    stem, ext = os.path.splitext(name)
    n = 1
    while True:
        cand = f"{stem} ({n}){ext}"
        key = cand.casefold()
        if key not in taken and not os.path.lexists(os.path.join(dest_dir, cand)):
            return cand
        n += 1


def build_plan(ctx: NodeContext, files: list[dict], dest: str, collision: str) -> list[dict]:
    plan: list[dict] = []
    taken: set[str] = set()
    norm = os.path.normcase
    for f in files:
        src = f["path"]
        entry = {"source": src, "destination": None, "status": "planned", "reason": ""}
        plan.append(entry)
        try:
            if os.path.islink(src):
                entry.update(status="skipped", reason="source is a symlink; symlinks are never moved")
                continue
            real_src = ctx.policy.resolve(src)
            if not os.path.isfile(real_src):
                entry.update(status="failed", reason="source file no longer exists")
                continue
        except EngineError as e:
            entry.update(status="failed", reason=e.message)
            continue
        name = os.path.basename(real_src)
        if norm(os.path.dirname(real_src)) == norm(dest):
            entry.update(status="skipped", reason="already in the destination folder", destination=real_src)
            continue
        target_name = name
        if target_name.casefold() in taken or os.path.lexists(os.path.join(dest, target_name)):
            if collision == "skip":
                entry.update(status="skipped", reason="a file with this name already exists at the destination",
                             destination=os.path.join(dest, name))
                continue
            if collision == "fail":
                entry.update(status="collision", reason="a file with this name already exists at the destination",
                             destination=os.path.join(dest, name))
                continue
            target_name = _unique(dest, name, taken)
            entry["reason"] = f"renamed to avoid collision: {target_name}"
        taken.add(target_name.casefold())
        entry["source"] = real_src
        entry["destination"] = os.path.join(dest, target_name)
    return plan


def _counts(plan: list[dict]) -> dict[str, int]:
    c = {"total": len(plan), "planned": 0, "moved": 0, "skipped": 0, "collision": 0, "failed": 0}
    for p in plan:
        c[p["status"]] += 1
    return c


def execute(ctx: NodeContext, config: dict, inputs: dict) -> NodeOutput:
    files = inputs["files"]
    dest = ctx.policy.resolve(config["destination"])
    dry = ctx.effective_dry_run(config["dryRun"])
    if os.path.exists(dest) and not os.path.isdir(dest):
        raise EngineError("NOT_A_DIRECTORY", f"Destination is not a folder: {short_path(config['destination'])}")
    will_create = not os.path.exists(dest)
    if will_create and not config["createDestination"]:
        raise EngineError("PATH_NOT_FOUND", f"Destination folder does not exist: {short_path(config['destination'])} "
                          "(enable 'Create destination' to create it)")

    plan = build_plan(ctx, files, dest, config["collision"])
    counts = _counts(plan)
    result = {"dryRun": dry, "destination": dest, "willCreateDestination": will_create, "results": plan, "counts": counts}

    if dry:
        ctx.log("info", f"Preview only: {counts['planned']} move(s) planned, {counts['skipped']} skipped, "
                        f"{counts['collision']} collision(s). Nothing was changed.")
        return NodeOutput({"moved": result}, {"dryRun": True, **counts})

    if counts["collision"]:
        raise EngineError("NAME_COLLISION", f"{counts['collision']} file(s) already exist at the destination "
                          "and the collision policy is 'fail'. Nothing was moved.", result)
    if will_create:
        os.makedirs(dest, exist_ok=True)
    for entry in plan:
        if entry["status"] != "planned":
            continue
        try:
            ctx.check_cancelled()
        except CancelledError:
            result["counts"] = _counts(plan)
            raise CancelledError("Cancelled; moves already completed are NOT reversed", partial=result)
        try:
            move_no_overwrite(entry["source"], entry["destination"])
            entry["status"] = "moved"
        except FileExistsError:
            entry.update(status="failed", reason="destination appeared while moving; not overwritten")
        except OSError as e:
            entry.update(status="failed", reason=e.strerror or str(e))
    counts = result["counts"] = _counts(plan)
    ctx.log("info", f"Moved {counts['moved']} file(s); {counts['failed']} failed; {counts['skipped']} skipped")
    if counts["failed"]:
        raise EngineError("MOVE_PARTIAL_FAILURE", f"{counts['failed']} of {counts['total']} move(s) failed; "
                          f"{counts['moved']} succeeded and were not reversed.", result)
    return NodeOutput({"moved": result}, {"dryRun": False, **counts})




DEFINITION = NodeDefinition(
    type="move_file", name="Move File", category="Files",
    description="Moves files into a destination folder. Previews by default and never overwrites existing files.",
    inputs=(PortDef("files", "files", "Files"),), outputs=(PortDef("moved", "moves", "Results"),),
    config_fields=(
        ConfigField("destination", "Destination folder", "path", required=True, path_kind="directory"),
        ConfigField("collision", "If a file already exists", "enum", default="fail", options=("fail", "skip", "rename"),
                    description="fail: stop before moving anything; skip: leave it; rename: add ' (1)'."),
        ConfigField("createDestination", "Create destination if missing", "boolean", default=False),
        ConfigField("dryRun", "Preview only (dry run)", "boolean", default=True,
                    description="When off, a run needs your explicit confirmation before files are moved."),
    ),
    execute=execute, side_effects=True, requires_confirmation=True,
)
