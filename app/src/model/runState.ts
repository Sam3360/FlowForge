/** Execution state is derived purely from engine events and is never part of the saved workflow. */
export type NodeStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "cancelled";
export type RunStatus = "idle" | "starting" | "running" | "success" | "failed" | "cancelled";

export interface Preview { preview: unknown; truncated: boolean; totalItems: number | null }
export interface NodeRun {
  status: NodeStatus; durationMs?: number; inputs?: Record<string, Preview>; outputs?: Record<string, Preview>;
  summary?: Record<string, unknown>; error?: { code: string; message: string; details: unknown };
  reason?: string; activePorts?: string[]; partial?: unknown; message?: string;
}
export interface LogLine { seq: number; ts: string; nodeId: string | null; level: string; message: string }
export interface RunState {
  runId: string | null; status: RunStatus; mode: "preview" | "apply" | null; order: string[];
  nodes: Record<string, NodeRun>; logs: LogLine[]; summary: Record<string, unknown> | null; startedAtMs: number | null;
  engineError: string | null;
}

export const MAX_LOGS = 2000;
export const initialRun = (): RunState => ({ runId: null, status: "idle", mode: null, order: [], nodes: {}, logs: [], summary: null, startedAtMs: null, engineError: null });

export interface EngineEvent { type: "event"; event: string; runId?: string; seq?: number; ts?: string; nodeId?: string; [k: string]: unknown }

export type RunAction =
  | { type: "begin"; mode: "preview" | "apply" }
  | { type: "event"; event: EngineEvent }
  | { type: "engine_error"; message: string }
  | { type: "reset" };

export function runReducer(s: RunState, a: RunAction): RunState {
  if (a.type === "reset") return initialRun();
  if (a.type === "begin") return { ...initialRun(), status: "starting", mode: a.mode, startedAtMs: Date.now() };
  if (a.type === "engine_error") {
    const nodes = Object.fromEntries(Object.entries(s.nodes).map(([k, v]) =>
      [k, v.status === "running" ? { ...v, status: "failed" as const, error: { code: "ENGINE_EXITED", message: a.message, details: {} } } : v]));
    const active = s.status === "starting" || s.status === "running";
    return { ...s, nodes, status: active ? "failed" : s.status, engineError: a.message };
  }
  const e = a.event;
  if (s.runId && e.runId && e.runId !== s.runId && e.event !== "run_started") return s; // stale run
  const id = e.nodeId;
  const patch = (p: Partial<NodeRun>): RunState =>
    (id ? { ...s, nodes: { ...s.nodes, [id]: { ...(s.nodes[id] ?? { status: "pending" as const }), ...p } } } : s);
  switch (e.event) {
    case "run_started": {
      const order = (e["order"] as string[]) ?? [];
      return { ...s, runId: e.runId ?? null, status: "running", order, nodes: Object.fromEntries(order.map((n) => [n, { status: "pending" as const }])) };
    }
    case "node_started": return patch({ status: "running", inputs: e["inputs"] as Record<string, Preview> });
    case "node_completed": return patch({ status: "completed", durationMs: e["durationMs"] as number, outputs: e["outputs"] as Record<string, Preview>,
      summary: e["summary"] as Record<string, unknown>, activePorts: e["activePorts"] as string[] });
    case "node_failed": return patch({ status: "failed", durationMs: e["durationMs"] as number, error: e["error"] as NodeRun["error"] });
    case "node_cancelled": return patch({ status: "cancelled", durationMs: e["durationMs"] as number, message: e["message"] as string, partial: e["partial"] });
    case "node_skipped": return patch({ status: "skipped", reason: e["reason"] as string });
    case "log": {
      const line: LogLine = { seq: e.seq ?? 0, ts: e.ts ?? "", nodeId: id ?? null, level: String(e["level"] ?? "info"), message: String(e["message"] ?? "") };
      return { ...s, logs: [...s.logs, line].slice(-MAX_LOGS) };
    }
    case "run_completed":
    case "run_cancelled": {
      const status = (e["status"] as RunStatus) ?? (e.event === "run_cancelled" ? "cancelled" : "success");
      return { ...s, status, summary: e as unknown as Record<string, unknown> };
    }
    default: return s;
  }
}

export const isActive = (s: RunState): boolean => s.status === "starting" || s.status === "running";
