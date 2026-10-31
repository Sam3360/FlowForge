"""Workflow parsing and validation (schema version 1)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from . import SUPPORTED_SCHEMA_VERSIONS
from .errors import hint_for
from .registry import Registry, resolve_config, types_compatible

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_NODES, MAX_EDGES = 1000, 5000


@dataclass(frozen=True)
class Issue:
    severity: str  # "error" | "warning"
    code: str
    message: str
    node_id: str | None = None
    edge_id: str | None = None
    field: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {"severity": self.severity, "code": self.code, "message": self.message,
                "nodeId": self.node_id, "edgeId": self.edge_id, "field": self.field, "hint": hint_for(self.code)}


@dataclass
class Node:
    id: str
    type: str
    config: dict[str, Any]


@dataclass
class Edge:
    id: str
    source: str
    source_port: str
    target: str
    target_port: str


@dataclass
class Workflow:
    name: str
    nodes: dict[str, Node] = field(default_factory=dict)
    edges: list[Edge] = field(default_factory=list)


def has_errors(issues: list[Issue]) -> bool:
    return any(i.severity == "error" for i in issues)


def parse_workflow(raw: Any) -> tuple[Workflow | None, list[Issue]]:
    """Structural parse only. Editor metadata (positions etc.) is ignored."""
    err = lambda code, msg, **kw: Issue("error", code, msg, **kw)  # noqa: E731
    if not isinstance(raw, dict):
        return None, [err("WORKFLOW_INVALID", "Workflow must be a JSON object")]
    version = raw.get("schemaVersion")
    if version not in SUPPORTED_SCHEMA_VERSIONS or isinstance(version, bool):
        return None, [err("UNSUPPORTED_SCHEMA_VERSION",
                          f"Unsupported workflow schemaVersion {version!r}; this engine supports {list(SUPPORTED_SCHEMA_VERSIONS)}")]
    issues: list[Issue] = []
    name = raw.get("name", "Untitled")
    wf = Workflow(name=name if isinstance(name, str) else "Untitled")
    nodes, edges = raw.get("nodes"), raw.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return None, [err("WORKFLOW_INVALID", "'nodes' and 'edges' must be arrays")]
    if len(nodes) > MAX_NODES or len(edges) > MAX_EDGES:
        return None, [err("WORKFLOW_TOO_LARGE", f"Workflow exceeds {MAX_NODES} nodes or {MAX_EDGES} edges")]
    for i, n in enumerate(nodes):
        if not isinstance(n, dict) or not isinstance(n.get("id"), str) or not ID_RE.match(n["id"]):
            issues.append(err("NODE_ID_INVALID", f"Node #{i} has a missing or invalid id (letters, digits, '_' '-', max 64)"))
            continue
        if n["id"] in wf.nodes:
            issues.append(err("NODE_ID_DUPLICATE", f"Duplicate node id '{n['id']}'", node_id=n["id"]))
            continue
        if not isinstance(n.get("type"), str):
            issues.append(err("NODE_TYPE_INVALID", "Node type must be a string", node_id=n["id"]))
            continue
        wf.nodes[n["id"]] = Node(n["id"], n["type"], n.get("config", {}))
    seen_edges: set[str] = set()
    for i, e in enumerate(edges):
        keys = ("id", "source", "sourcePort", "target", "targetPort")
        if not isinstance(e, dict) or not all(isinstance(e.get(k), str) for k in keys):
            issues.append(err("EDGE_INVALID", f"Edge #{i} must have string id, source, sourcePort, target, targetPort"))
            continue
        if e["id"] in seen_edges:
            issues.append(err("EDGE_ID_DUPLICATE", f"Duplicate edge id '{e['id']}'", edge_id=e["id"]))
            continue
        seen_edges.add(e["id"])
        wf.edges.append(Edge(e["id"], e["source"], e["sourcePort"], e["target"], e["targetPort"]))
    return wf, issues


def topological_order(wf: Workflow) -> tuple[list[str], bool]:
    """Kahn's algorithm, ties broken by file order. Returns (order, has_cycle)."""
    indeg = {nid: 0 for nid in wf.nodes}
    out: dict[str, list[str]] = {nid: [] for nid in wf.nodes}
    for e in wf.edges:
        if e.source in wf.nodes and e.target in wf.nodes:
            indeg[e.target] += 1
            out[e.source].append(e.target)
    position = {nid: i for i, nid in enumerate(wf.nodes)}
    ready = sorted((n for n, d in indeg.items() if d == 0), key=position.get)  # type: ignore[arg-type]
    order: list[str] = []
    while ready:
        n = ready.pop(0)
        order.append(n)
        for m in out[n]:
            indeg[m] -= 1
            if indeg[m] == 0:
                ready.append(m)
        ready.sort(key=position.get)  # type: ignore[arg-type]
    return order, len(order) != len(wf.nodes)


def reachable_from(wf: Workflow, start_ids: list[str]) -> set[str]:
    adj: dict[str, list[str]] = {}
    for e in wf.edges:
        adj.setdefault(e.source, []).append(e.target)
    seen, stack = set(), list(start_ids)
    while stack:
        n = stack.pop()
        if n in seen:
            continue
        seen.add(n)
        stack.extend(adj.get(n, []))
    return seen


def validate_workflow(wf: Workflow, reg: Registry) -> tuple[list[Issue], dict[str, dict[str, Any]]]:
    """Full semantic validation. Returns (issues, resolved_configs_by_node_id)."""
    issues: list[Issue] = []
    configs: dict[str, dict[str, Any]] = {}
    for n in wf.nodes.values():
        d = reg.get(n.type)
        if d is None:
            issues.append(Issue("error", "NODE_TYPE_UNKNOWN", f"Unknown node type '{n.type}'", node_id=n.id))
            continue
        cfg, problems = resolve_config(d, n.config)
        configs[n.id] = cfg
        for code, fld, msg in problems:
            issues.append(Issue("error", code, msg, node_id=n.id, field=fld or None))

    starts = [n.id for n in wf.nodes.values() if n.type == "start"]
    if not starts:
        issues.append(Issue("error", "START_MISSING", "The workflow needs a Start node"))
    elif len(starts) > 1:
        for s in starts[1:]:
            issues.append(Issue("error", "START_MULTIPLE", "Only one Start node is allowed", node_id=s))

    incoming: dict[tuple[str, str], int] = {}
    for e in wf.edges:
        sn, tn = wf.nodes.get(e.source), wf.nodes.get(e.target)
        if sn is None or tn is None:
            missing = e.source if sn is None else e.target
            issues.append(Issue("error", "EDGE_DANGLING", f"Connection refers to missing node '{missing}'", edge_id=e.id))
            continue
        sd, td = reg.get(sn.type), reg.get(tn.type)
        if sd is None or td is None:
            continue  # already reported as unknown type
        sp, tp = sd.output(e.source_port), td.input(e.target_port)
        if sp is None:
            issues.append(Issue("error", "PORT_UNKNOWN", f"'{sd.name}' has no output port '{e.source_port}'", edge_id=e.id, node_id=sn.id))
            continue
        if tp is None:
            issues.append(Issue("error", "PORT_UNKNOWN", f"'{td.name}' has no input port '{e.target_port}'", edge_id=e.id, node_id=tn.id))
            continue
        if not types_compatible(sp.type, tp.type):
            issues.append(Issue("error", "PORT_TYPE_MISMATCH",
                                f"Cannot connect {sd.name}.{sp.label or sp.name} ({sp.type}) to {td.name}.{tp.label or tp.name} ({tp.type})",
                                edge_id=e.id, node_id=tn.id))
        key = (e.target, e.target_port)
        incoming[key] = incoming.get(key, 0) + 1
        if incoming[key] == 2:
            issues.append(Issue("error", "INPUT_MULTIPLE_EDGES",
                                f"Input '{tp.label or tp.name}' of '{td.name}' has more than one connection", node_id=tn.id, edge_id=e.id))

    for n in wf.nodes.values():
        d = reg.get(n.type)
        if d is None:
            continue
        for p in d.inputs:
            if p.required and (n.id, p.name) not in incoming:
                issues.append(Issue("error", "INPUT_NOT_CONNECTED", f"'{d.name}' input '{p.label or p.name}' is not connected", node_id=n.id))

    _, cyclic = topological_order(wf)
    if cyclic:
        issues.append(Issue("error", "GRAPH_CYCLE", "The workflow contains a cycle; loops are not supported yet"))
    if starts and not cyclic:
        reach = reachable_from(wf, starts[:1])
        has_outgoing = {e.source for e in wf.edges}
        if not any(n.type == "finish" for n in wf.nodes.values()):
            issues.append(Issue("warning", "FINISH_MISSING", "The workflow has no Finish node, so no completion summary is reported"))
        for n in wf.nodes.values():
            d = reg.get(n.type)
            if n.id not in reach and n.type != "start":
                issues.append(Issue("warning", "NODE_UNREACHABLE", "Not reachable from Start; this node will be skipped", node_id=n.id))
            elif d is not None and d.outputs and n.id not in has_outgoing:
                issues.append(Issue("warning", "NODE_DEAD_END", f"'{d.name}' has no outgoing connection; its results go nowhere", node_id=n.id))
    return issues, configs
