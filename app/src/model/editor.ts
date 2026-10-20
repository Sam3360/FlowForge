/** Pure editing operations on the editor document. No React, no DOM. */
import type { Edge, Node } from "@xyflow/react";
import { defaultConfig, getDef, typesCompatible } from "./definitions";
import type { Config, Issue, Position, WorkflowFile } from "./types";

export type ForgeNodeData = { config: Config; nodeType: string; [key: string]: unknown };
export type ForgeNode = Node<ForgeNodeData, "forge">;
export type ForgeEdge = Edge;
export type Viewport = { x: number; y: number; zoom: number };

export interface Doc {
  name: string;
  nodes: ForgeNode[];
  edges: ForgeEdge[];
}

let counter = 0;
export function newId(prefix: string, taken: Set<string>): string {
  for (;;) {
    counter += 1;
    const id = `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
    if (!taken.has(id)) return id;
  }
}

export const emptyDoc = (name = "Untitled workflow"): Doc => ({ name, nodes: [], edges: [] });
export const getType = (n: ForgeNode): string => n.data.nodeType;

export function addNode(doc: Doc, type: string, position: Position): Doc {
  const def = getDef(type);
  if (!def) throw new Error(`Unknown node type ${type}`);
  if (type === "start" && doc.nodes.some((n) => getType(n) === "start")) return doc; // exactly one Start
  const id = newId(type, new Set(doc.nodes.map((n) => n.id)));
  const node: ForgeNode = { id, type: "forge", position, data: { config: defaultConfig(def), nodeType: type } };
  return { ...doc, nodes: [...doc.nodes, node] };
}

export function deleteNodes(doc: Doc, ids: string[]): Doc {
  const gone = new Set(ids);
  return { ...doc, nodes: doc.nodes.filter((n) => !gone.has(n.id)), edges: doc.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)) };
}

export function deleteEdges(doc: Doc, ids: string[]): Doc {
  const gone = new Set(ids);
  return { ...doc, edges: doc.edges.filter((e) => !gone.has(e.id)) };
}

export function duplicateNodes(doc: Doc, ids: string[]): Doc {
  const taken = new Set(doc.nodes.map((n) => n.id));
  const copies: ForgeNode[] = [];
  for (const n of doc.nodes.filter((n) => ids.includes(n.id) && getType(n) !== "start")) {
    const id = newId(getType(n), taken);
    taken.add(id);
    copies.push({ ...n, id, selected: false, position: { x: n.position.x + 40, y: n.position.y + 40 },
      data: { ...n.data, config: structuredClone(n.data.config) } });
  }
  return { ...doc, nodes: [...doc.nodes, ...copies] };
}

export function updateConfig(doc: Doc, id: string, field: string, value: unknown): Doc {
  return { ...doc, nodes: doc.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, config: { ...n.data.config, [field]: value } } } : n)) };
}

export interface ConnectionInput { source: string; sourceHandle: string; target: string; targetHandle: string }

/** Returns null if the connection is valid, otherwise a human-readable reason. */
export function connectionProblem(doc: Doc, c: ConnectionInput): string | null {
  const s = doc.nodes.find((n) => n.id === c.source), t = doc.nodes.find((n) => n.id === c.target);
  if (!s || !t) return "Both nodes must exist";
  if (s.id === t.id) return "A node cannot connect to itself";
  const sp = getDef(getType(s))?.outputs.find((p) => p.name === c.sourceHandle);
  const tp = getDef(getType(t))?.inputs.find((p) => p.name === c.targetHandle);
  if (!sp || !tp) return "Unknown port";
  if (!typesCompatible(sp.type, tp.type)) return `Cannot connect ${sp.type} to ${tp.type}`;
  if (doc.edges.some((e) => e.target === c.target && e.targetHandle === c.targetHandle)) return "That input already has a connection";
  if (reaches(doc, c.target, c.source)) return "This connection would create a cycle";
  return null;
}

function reaches(doc: Doc, from: string, to: string): boolean {
  const seen = new Set<string>(), stack = [from];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === to) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const e of doc.edges) if (e.source === n) stack.push(e.target);
  }
  return false;
}

export function connect(doc: Doc, c: ConnectionInput): Doc {
  if (connectionProblem(doc, c)) return doc;
  const id = newId("edge", new Set(doc.edges.map((e) => e.id)));
  return { ...doc, edges: [...doc.edges, { id, source: c.source, sourceHandle: c.sourceHandle, target: c.target, targetHandle: c.targetHandle }] };
}

/** Fast local validation for immediate feedback. The Python engine remains the authority. */
export function localIssues(doc: Doc): Issue[] {
  const out: Issue[] = [];
  const mk = (code: string, message: string, nodeId: string | null = null, field: string | null = null): Issue =>
    ({ severity: "error", code, message, nodeId, edgeId: null, field });
  if (!doc.nodes.some((n) => getType(n) === "start")) out.push(mk("START_MISSING", "The workflow needs a Start node"));
  for (const n of doc.nodes) {
    const def = getDef(getType(n));
    if (!def) { out.push(mk("NODE_TYPE_UNKNOWN", `Unknown node type '${getType(n)}'`, n.id)); continue; }
    for (const f of def.config) {
      const v = n.data.config[f.name];
      if (f.required && (v === null || v === undefined || v === "")) out.push(mk("CONFIG_REQUIRED", `${f.label} is required`, n.id, f.name));
    }
    for (const p of def.inputs) {
      if (p.required && !doc.edges.some((e) => e.target === n.id && e.targetHandle === p.name))
        out.push(mk("INPUT_NOT_CONNECTED", `'${def.name}' input '${p.label}' is not connected`, n.id));
    }
  }
  return out;
}

export function toWorkflowFile(doc: Doc, viewport?: Viewport): WorkflowFile {
  return {
    schemaVersion: 1,
    name: doc.name,
    nodes: doc.nodes.map((n) => ({ id: n.id, type: getType(n), config: n.data.config, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) } })),
    edges: doc.edges.map((e) => ({ id: e.id, source: e.source, sourcePort: e.sourceHandle ?? "", target: e.target, targetPort: e.targetHandle ?? "" })),
    ...(viewport ? { editor: { viewport } } : {}),
  };
}

export function serialize(doc: Doc, viewport?: Viewport): string {
  return JSON.stringify(toWorkflowFile(doc, viewport), null, 2) + "\n";
}

export type ParseResult = { ok: true; doc: Doc; viewport?: Viewport } | { ok: false; message: string };

export function parseWorkflowText(text: string): ParseResult {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, message: "This file is not valid JSON, so it cannot be a workflow." }; }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, message: "This file does not look like a workflow." };
  const w = raw as Partial<WorkflowFile>;
  if (w.schemaVersion !== 1) return { ok: false, message: `Unsupported workflow version ${JSON.stringify(w.schemaVersion) ?? "(none)"}. This app opens version 1 files.` };
  if (!Array.isArray(w.nodes) || !Array.isArray(w.edges)) return { ok: false, message: "The workflow is missing its nodes or edges." };
  const unknown = [...new Set(w.nodes.filter((n) => !getDef(String(n?.type))).map((n) => String(n?.type)))];
  if (unknown.length) return { ok: false, message: `This workflow uses node types this app does not know: ${unknown.join(", ")}.` };
  const ids = new Set<string>();
  const nodes: ForgeNode[] = [];
  for (const n of w.nodes) {
    if (typeof n?.id !== "string" || ids.has(n.id)) return { ok: false, message: "The workflow has a missing or duplicate node id." };
    ids.add(n.id);
    const def = getDef(n.type)!;
    nodes.push({ id: n.id, type: "forge", position: { x: Number(n.position?.x) || 0, y: Number(n.position?.y) || 0 },
      data: { nodeType: n.type, config: { ...defaultConfig(def), ...(typeof n.config === "object" && n.config ? n.config : {}) } } });
  }
  const edges: ForgeEdge[] = w.edges.filter((e) => ids.has(e?.source) && ids.has(e?.target))
    .map((e) => ({ id: String(e.id), source: e.source, sourceHandle: e.sourcePort, target: e.target, targetHandle: e.targetPort }));
  const result: ParseResult = { ok: true, doc: { name: typeof w.name === "string" ? w.name : "Untitled workflow", nodes, edges } };
  if (w.editor?.viewport) result.viewport = w.editor.viewport;
  return result;
}
