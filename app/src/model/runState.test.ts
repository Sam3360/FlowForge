import { describe, expect, it } from "vitest";
import { initialRun, MAX_LOGS, runReducer, type EngineEvent, type RunState } from "./runState";

const ev = (event: string, extra: Record<string, unknown> = {}): EngineEvent => ({ type: "event", event, runId: "r1", ...extra });
const apply = (s: RunState, ...events: EngineEvent[]) => events.reduce((acc, e) => runReducer(acc, { type: "event", event: e }), s);
const start = () => apply(runReducer(initialRun(), { type: "begin", mode: "preview" }), ev("run_started", { order: ["a", "b", "c"] }));

describe("execution event rendering state", () => {
  it("tracks pending/running/completed with durations and branches", () => {
    let s = start();
    expect(s.nodes["a"]!.status).toBe("pending");
    s = apply(s, ev("node_started", { nodeId: "a", inputs: {} }));
    expect(s.nodes["a"]!.status).toBe("running");
    s = apply(s, ev("node_completed", { nodeId: "a", durationMs: 12.5, activePorts: ["true"], summary: { branch: "true" }, outputs: {} }),
      ev("node_skipped", { nodeId: "b", reason: "branch not taken" }), ev("run_completed", { status: "success", durationMs: 20 }));
    expect(s.nodes["a"]).toMatchObject({ status: "completed", durationMs: 12.5, activePorts: ["true"] });
    expect(s.nodes["b"]).toMatchObject({ status: "skipped", reason: "branch not taken" });
    expect(s.status).toBe("success");
  });
  it("failure keeps error details and marks the run failed", () => {
    const s = apply(start(), ev("node_started", { nodeId: "a" }), ev("node_failed", { nodeId: "a", durationMs: 3, error: { code: "PATH_NOT_FOUND", message: "nope", details: {} } }),
      ev("node_skipped", { nodeId: "b", reason: "run aborted" }), ev("run_completed", { status: "failed", failedNode: "a" }));
    expect(s.status).toBe("failed");
    expect(s.nodes["a"]!.error).toMatchObject({ code: "PATH_NOT_FOUND" });
  });
  it("cancellation records partial results and final cancelled state", () => {
    const s = apply(start(), ev("node_started", { nodeId: "a" }), ev("node_cancelled", { nodeId: "a", message: "stopped", partial: { counts: { moved: 3 } } }),
      ev("run_cancelled", { status: "cancelled" }));
    expect(s.status).toBe("cancelled");
    expect(s.nodes["a"]).toMatchObject({ status: "cancelled", partial: { counts: { moved: 3 } } });
  });
  it("logs are bounded", () => {
    let s = start();
    for (let i = 0; i < MAX_LOGS + 50; i++) s = apply(s, ev("log", { seq: i, level: "info", message: `m${i}`, nodeId: "a" }));
    expect(s.logs).toHaveLength(MAX_LOGS);
    expect(s.logs.at(-1)!.message).toBe(`m${MAX_LOGS + 49}`);
  });
  it("ignores events from a stale run", () => {
    const s = apply(start(), { type: "event", event: "node_completed", runId: "OLD", nodeId: "a" });
    expect(s.nodes["a"]!.status).toBe("pending");
  });
  it("engine exit mid-run fails the running node and the run", () => {
    let s = apply(start(), ev("node_started", { nodeId: "a" }));
    s = runReducer(s, { type: "engine_error", message: "engine died" });
    expect(s.status).toBe("failed");
    expect(s.nodes["a"]!.error!.code).toBe("ENGINE_EXITED");
  });
});
