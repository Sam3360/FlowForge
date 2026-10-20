"""Node definitions and the node registry (single source of truth for nodes)."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Callable

if TYPE_CHECKING:
    from .context import NodeContext, NodeOutput

PORT_TYPES = ("context", "files", "moves", "any")
FIELD_TYPES = ("string", "path", "boolean", "number", "integer", "enum", "stringList")


@dataclass(frozen=True)
class PortDef:
    name: str
    type: str
    label: str = ""
    required: bool = True  # only meaningful for inputs

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "type": self.type, "label": self.label or self.name, "required": self.required}


@dataclass(frozen=True)
class ConfigField:
    name: str
    label: str
    type: str
    default: Any = None
    required: bool = False
    description: str = ""
    options: tuple[str, ...] = ()
    minimum: float | None = None
    maximum: float | None = None
    placeholder: str = ""
    path_kind: str | None = None  # "directory" | "file" for type == "path"

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name, "label": self.label, "type": self.type, "default": self.default,
            "required": self.required, "description": self.description, "options": list(self.options),
            "minimum": self.minimum, "maximum": self.maximum, "placeholder": self.placeholder,
            "pathKind": self.path_kind,
        }


ExecuteFn = Callable[["NodeContext", dict[str, Any], dict[str, Any]], "NodeOutput"]
ExtraValidator = Callable[[dict[str, Any]], list[tuple[str, str]]]


@dataclass(frozen=True)
class NodeDefinition:
    type: str
    name: str
    description: str
    category: str
    inputs: tuple[PortDef, ...]
    outputs: tuple[PortDef, ...]
    config_fields: tuple[ConfigField, ...]
    execute: ExecuteFn
    side_effects: bool = False
    requires_confirmation: bool = False
    extra_validation: ExtraValidator | None = None

    def input(self, name: str) -> PortDef | None:
        return next((p for p in self.inputs if p.name == name), None)

    def output(self, name: str) -> PortDef | None:
        return next((p for p in self.outputs if p.name == name), None)

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type, "name": self.name, "description": self.description, "category": self.category,
            "inputs": [p.to_dict() for p in self.inputs], "outputs": [p.to_dict() for p in self.outputs],
            "config": [f.to_dict() for f in self.config_fields],
            "sideEffects": self.side_effects, "requiresConfirmation": self.requires_confirmation,
        }


class Registry:
    def __init__(self) -> None:
        self._nodes: dict[str, NodeDefinition] = {}

    def register(self, definition: NodeDefinition) -> None:
        if definition.type in self._nodes:
            raise ValueError(f"Duplicate node type: {definition.type}")
        for f in definition.config_fields:
            if f.type not in FIELD_TYPES:
                raise ValueError(f"{definition.type}.{f.name}: unknown field type {f.type}")
        for p in (*definition.inputs, *definition.outputs):
            if p.type not in PORT_TYPES:
                raise ValueError(f"{definition.type}.{p.name}: unknown port type {p.type}")
        self._nodes[definition.type] = definition

    def get(self, node_type: str) -> NodeDefinition | None:
        return self._nodes.get(node_type)

    def all(self) -> list[NodeDefinition]:
        return list(self._nodes.values())

    def describe(self) -> list[dict[str, Any]]:
        return [d.to_dict() for d in self._nodes.values()]


def types_compatible(source: str, target: str) -> bool:
    return source == target or "any" in (source, target)


def resolve_config(defn: NodeDefinition, raw: Any) -> tuple[dict[str, Any], list[tuple[str, str, str]]]:
    """Apply defaults and type-check. Returns (config, [(code, field, message)])."""
    problems: list[tuple[str, str, str]] = []
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        return {}, [("CONFIG_INVALID", "", "config must be an object")]
    known = {f.name for f in defn.config_fields}
    for key in raw:
        if key not in known:
            problems.append(("CONFIG_UNKNOWN_FIELD", key, f"Unknown config field '{key}'"))
    config: dict[str, Any] = {}
    for f in defn.config_fields:
        value = raw[f.name] if f.name in raw else (list(f.default) if isinstance(f.default, list) else f.default)
        config[f.name] = value
        label = f.label
        if value is None or (f.type in ("string", "path") and value == ""):
            if f.required:
                problems.append(("CONFIG_REQUIRED", f.name, f"{label} is required"))
            continue
        msg = _check_value(f, value)
        if msg:
            problems.append(("CONFIG_INVALID", f.name, f"{label}: {msg}"))
    if not problems and defn.extra_validation:
        for fname, msg in defn.extra_validation(config):
            problems.append(("CONFIG_INVALID", fname, msg))
    return config, problems


def _check_value(f: ConfigField, v: Any) -> str | None:
    t = f.type
    if t in ("string", "path"):
        if not isinstance(v, str):
            return "must be a string"
        if "\x00" in v:
            return "must not contain NUL characters"
        if len(v) > 4096:
            return "is too long"
    elif t == "boolean":
        if not isinstance(v, bool):
            return "must be true or false"
    elif t in ("number", "integer"):
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            return "must be a number"
        if t == "integer" and int(v) != v:
            return "must be a whole number"
        if f.minimum is not None and v < f.minimum:
            return f"must be at least {f.minimum:g}"
        if f.maximum is not None and v > f.maximum:
            return f"must be at most {f.maximum:g}"
    elif t == "enum":
        if v not in f.options:
            return f"must be one of: {', '.join(f.options)}"
    elif t == "stringList":
        if not isinstance(v, list) or not all(isinstance(i, str) for i in v):
            return "must be a list of strings"
        if len(v) > 100 or any(len(i) > 256 or "\x00" in i for i in v):
            return "has too many or too long entries"
    return None
