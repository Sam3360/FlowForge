import type { Issue } from "./types";

/** Fallback hints for issues produced in the browser. Engine-produced issues carry their own `hint`. */
const LOCAL_HINTS: Record<string, string> = {
  START_MISSING: "Drag a Start node from the library onto the canvas.",
  CONFIG_REQUIRED: "Fill in the required setting in the Inspector.",
  INPUT_NOT_CONNECTED: "Drag from the previous node's output port to this node's input port.",
  NODE_TYPE_UNKNOWN: "This node type is not supported by this version of FlowForge.",
};
export const hintFor = (i: Pick<Issue, "code" | "hint">): string | null => i.hint ?? LOCAL_HINTS[i.code] ?? null;
