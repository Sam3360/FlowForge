import shared from "../../../shared/node-definitions.json";
import type { NodeDef } from "./types";

/** Node definitions generated from the Python registry (`python -m flowforge_engine.export_definitions`). */
export const NODE_DEFS: NodeDef[] = (shared as { nodes: unknown }).nodes as NodeDef[];
const byType = new Map(NODE_DEFS.map((d) => [d.type, d]));

export const getDef = (type: string): NodeDef | undefined => byType.get(type);

export const CATEGORY_COLORS: Record<string, string> = { Flow: "var(--cat-flow)", Files: "var(--cat-files)" };
export const categoryColor = (c: string): string => CATEGORY_COLORS[c] ?? "var(--cat-other)";

export function defaultConfig(def: NodeDef): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of def.config) out[f.name] = Array.isArray(f.default) ? [...f.default] : f.default;
  return out;
}

export function typesCompatible(source: string, target: string): boolean {
  return source === target || source === "any" || target === "any";
}
