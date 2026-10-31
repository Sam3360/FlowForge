/** In-memory history of finished runs for the current session. Never persisted; never contains file contents. */
import { failedNodeId, isTerminal, type RunState } from "./runState";

export interface RunNodeInfo { name: string; type: string }
export type RunOutcome = "success" | "failed" | "cancelled";
export interface RunRecord {
  id: string; number: number; workflowName: string; mode: "preview" | "apply" | null; status: RunOutcome;
  startedAt: string; durationMs: number | null;
  failedNodeId: string | null; failedNodeName: string | null;
  interruptedNodeId: string | null;
  error: { code: string; message: string; hint?: string | null } | null;
  /** The finished run exactly as the engine reported it (immutable snapshot). */
  run: RunState;
  nodeInfo: Record<string, RunNodeInfo>;
}

export const MAX_RUNS = 50;
const MAX_RECORD_LOGS = 500;

/** Returns null while the run has not reached a final state, so a half-finished run is never recorded. */
export function recordFromRun(run: RunState, nodeInfo: Record<string, RunNodeInfo>, workflowName: string, number: number): RunRecord | null {
  if (!isTerminal(run.status)) return null;
  const failedId = failedNodeId(run);
  const interrupted = run.order.find((id) => run.nodes[id]?.status === "cancelled") ?? null;
  const failedErr = failedId ? run.nodes[failedId]?.error : undefined;
  const error = failedErr ? { code: failedErr.code, message: failedErr.message, hint: failedErr.hint }
    : run.engineError ? { code: "ENGINE_EXITED", message: run.engineError, hint: "Press Retry in the banner to restart the engine, then run again." } : null;
  const dur = run.summary?.["durationMs"];
  return {
    id: run.runId ?? `local-${number}`, number, workflowName, mode: run.mode,
    status: run.status as RunOutcome, startedAt: run.startedAt ?? new Date().toISOString(),
    durationMs: typeof dur === "number" ? dur : null,
    failedNodeId: failedId, failedNodeName: failedId ? (nodeInfo[failedId]?.name ?? failedId) : null, interruptedNodeId: interrupted,
    error, nodeInfo: { ...nodeInfo }, run: { ...run, logs: run.logs.slice(-MAX_RECORD_LOGS) },
  };
}

/** Newest first, de-duplicated by id, bounded. */
export function addRecord(list: RunRecord[], rec: RunRecord): RunRecord[] {
  return [rec, ...list.filter((r) => r.id !== rec.id)].slice(0, MAX_RUNS);
}
