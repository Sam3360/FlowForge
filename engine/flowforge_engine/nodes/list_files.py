from __future__ import annotations

import fnmatch
import os
import stat
from datetime import datetime, timezone

from ..context import NodeContext, NodeOutput
from ..errors import EngineError, short_path
from ..registry import ConfigField, NodeDefinition, PortDef

HIDDEN_ATTR = 0x2      # FILE_ATTRIBUTE_HIDDEN on Windows
REPARSE_ATTR = 0x400   # FILE_ATTRIBUTE_REPARSE_POINT: symlinks *and junctions* on Windows


def _is_link_like(entry: "os.DirEntry[str]", st: os.stat_result) -> bool:
    """True for symlinks and, on Windows, directory junctions / other reparse points."""
    if stat.S_ISLNK(st.st_mode):
        return True
    if getattr(entry, "is_junction", lambda: False)():
        return True
    return bool(getattr(st, "st_file_attributes", 0) & REPARSE_ATTR)


def _matches(name: str, patterns: list[str]) -> bool:
    n = name.casefold()
    return any(fnmatch.fnmatchcase(n, p.casefold()) for p in patterns)


def _is_hidden(name: str, st: os.stat_result) -> bool:
    return name.startswith(".") or bool(getattr(st, "st_file_attributes", 0) & HIDDEN_ATTR)


def execute(ctx: NodeContext, config: dict, inputs: dict) -> NodeOutput:
    root = ctx.policy.resolve(config["directory"])
    if not os.path.exists(root):
        raise EngineError("PATH_NOT_FOUND", f"Directory does not exist: {short_path(config['directory'])}")
    if not os.path.isdir(root):
        raise EngineError("NOT_A_DIRECTORY", f"Not a directory: {short_path(config['directory'])}")

    include, exclude = config["include"], config["exclude"]
    limit = int(config["maxFiles"])
    files: list[dict] = []
    skipped_links = skipped_dirs = 0
    stack = [root]
    while stack:
        current = stack.pop()
        try:
            with os.scandir(current) as it:
                entries = sorted(it, key=lambda e: e.name)
        except PermissionError:
            if current == root:
                raise EngineError("PATH_ACCESS_DENIED", f"Cannot read directory: {short_path(config['directory'])}")
            skipped_dirs += 1
            ctx.log("warning", f"Skipped unreadable directory: {short_path(current)}")
            continue
        except OSError as e:
            raise EngineError("PATH_ERROR", f"Cannot read {short_path(current)}: {e.strerror or 'I/O error'}")
        subdirs = []
        for entry in entries:
            ctx.check_cancelled()
            try:
                st = entry.stat(follow_symlinks=False)
            except OSError:
                continue
            is_link = _is_link_like(entry, st)
            if is_link and (entry.is_dir() or stat.S_ISDIR(st.st_mode)):  # never follow directory links/junctions
                skipped_links += 1
                ctx.log("info", f"Not following directory link: {short_path(entry.path)}")
                continue
            if stat.S_ISDIR(st.st_mode):
                if config["recursive"] and (config["includeHidden"] or not _is_hidden(entry.name, st)):
                    subdirs.append(entry.path)
                continue
            if not (stat.S_ISREG(st.st_mode) or is_link):
                continue
            if not config["includeHidden"] and _is_hidden(entry.name, st):
                continue
            if include and not _matches(entry.name, include):
                continue
            if exclude and _matches(entry.name, exclude):
                continue
            if len(files) >= limit:
                raise EngineError("TOO_MANY_FILES", f"More than {limit} files matched; narrow the filters or raise Max files",
                                  {"limit": limit})
            files.append({
                "path": entry.path,
                "name": entry.name,
                "relativePath": os.path.relpath(entry.path, root),
                "extension": os.path.splitext(entry.name)[1].lower(),
                "size": st.st_size,
                "modified": datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat(timespec="seconds"),
                "isSymlink": is_link,
            })
        stack.extend(reversed(subdirs))
    files.sort(key=lambda f: f["path"])
    summary = {"count": len(files), "directory": root, "recursive": config["recursive"],
               "skippedDirectorySymlinks": skipped_links, "skippedUnreadableDirectories": skipped_dirs}
    ctx.log("info", f"Found {len(files)} file(s) in {short_path(root)}")
    return NodeOutput({"files": files}, summary)


DEFINITION = NodeDefinition(
    type="list_files", name="List Files", category="Files",
    description="Lists files in a folder. Directory symlinks are never followed.",
    inputs=(PortDef("in", "context", "Trigger"),), outputs=(PortDef("files", "files", "Files"),),
    config_fields=(
        ConfigField("directory", "Directory", "path", required=True, path_kind="directory", must_exist=True),
        ConfigField("recursive", "Include subfolders", "boolean", default=False),
        ConfigField("include", "Include patterns", "stringList", default=[], placeholder="*.pdf",
                    description="Glob patterns on the file name. Empty means all files."),
        ConfigField("exclude", "Exclude patterns", "stringList", default=[], placeholder="*.tmp"),
        ConfigField("includeHidden", "Include hidden files", "boolean", default=False),
        ConfigField("maxFiles", "Max files", "integer", default=10000, minimum=1, maximum=1000000,
                    description="The node fails rather than silently truncating."),
    ),
    execute=execute,
)
