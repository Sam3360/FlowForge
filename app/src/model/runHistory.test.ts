import { describe, expect, it } from "vitest";
import { addRecord, MAX_RUNS, recordFromRun } from "./runHistory";
import { initialRun, runReducer, type EngineEvent, type RunState } from "./runState";

const ev = (event: string, seq: number, extra: Record<string, unknown> = {}): EngineEvent => ({ type: "event", event, runId: "r1", seq, ...extra });
const feed = (s: RunState, ...events: EngineEvent[]) => events.reduce((a, e) => runReducer(a, { type: "event", event: e }), s);
const begin = () => feed(runReducer(initialRun(), { type: "begin", mode: "preview" }), ev("run_started", 1, { order: ["a", "b", "c"], ts: "2026-01-01T10:00:00.000Z" }));
const info = { a: { name: "Start", type: "start" }, b: { name: "List Files", type: "list_files" }, c: { name: "Finish", type: "finish" } };

describe("run history records", () => {
  it("is not recorded until the engine reports a final state", () => {
    expect(recordFromRun(begin(), info, "W", 1)).toBeNull();
    expect(recordFromRun(runReducer(initialRun(), { type: "begin", mode: "apply" }), info, "W", 1)).toBeNull();
  });
  it("records a completed run with timing and start time", () => {
    const s = feed(begin(), ev("node_completed", 2, { nodeId: "a", durationMs: 1 }), ev("run_completed", 3, { status: "success", durationMs: 42 }));
    const r = recordFromRun(s, info, "W", 1)!;
    expect(r).toMatchObject({ status: "success", durationMs: 42, startedAt: "2026-01-01T10:00:00.000Z", failedNodeId: null, error: null, number: 1, id: "r1" });
  });
  it("records which node failed, its readable error and hint", () => {
    const err = { code: "PATH_NOT_FOUND", message: "Directory does not exist: .../a/b", details: {}, hint: "Check the folder." };
    const s = feed(begin(), ev("node_started", 2, { nodeId: "b" }), ev("node_failed", 3, { nodeId: "b", durationMs: 3, error: err }),
      ev("node_skipped", 4, { nodeId: "c", reason: "run aborted" }), ev("run_completed", 5, { status: "failed", failedNode: "b", durationMs: 9 }));
    const r = recordFromRun(s, info, "W", 2)!;
    expect(r).toMatchObject({ status: "failed", failedNodeId: "b", failedNodeName: "List Files", error: { code: "PATH_NOT_FOUND", hint: "Check the folder." } });
    expect(r.run.nodes["c"]!.status).toBe("skipped");
  });
  it("records cancellation with the interrupted node, not as a failure", () => {
    const s = feed(begin(), ev("node_started", 2, { nodeId: "b" }), ev("node_cancelled", 3, { nodeId: "b", message: "x", durationMs: 2 }),
      ev("run_cancelled", 4, { status: "cancelled", durationMs: 5 }));
    const r = recordFromRun(s, info, "W", 3)!;
    expect(r).toMatchObject({ status: "cancelled", failedNodeId: null, interruptedNodeId: "b", error: null });
  });
  it("records an engine crash mid-run as failed with a restart hint", () => {
    const s = runReducer(feed(begin(), ev("node_started", 2, { nodeId: "b" })), { type: "engine_error", message: "engine stopped" });
    const r = recordFromRun(s, info, "W", 4)!;
    expect(r.status).toBe("failed");
    expect(r.failedNodeId).toBe("b");
    expect(r.error!.message).toMatch(/engine stopped/);
  });
  it("a snapshot is not corrupted by a later run", () => {
    const first = recordFromRun(feed(begin(), ev("run_completed", 2, { status: "success", durationMs: 1 })), info, "W", 1)!;
    const next = runReducer(runReducer(initialRun(), { type: "begin", mode: "apply" }), { type: "event", event: ev("run_started", 1, { order: ["z"] }) });
    expect(first.run.order).toEqual(["a", "b", "c"]);
    expect(next.order).toEqual(["z"]);
  });
  it("keeps newest first, de-duplicates by id, and is bounded", () => {
    const mk = (id: string, n: number) => ({ ...recordFromRun(feed(begin(), ev("run_completed", 2, { status: "success", durationMs: 1 })), info, "W", n)!, id });
    let list = addRecord([], mk("a", 1));
    list = addRecord(list, mk("b", 2));
    expect(list.map((r) => r.id)).toEqual(["b", "a"]);
    list = addRecord(list, mk("a", 3));
    expect(list.map((r) => r.id)).toEqual(["a", "b"]);
    for (let i = 0; i < MAX_RUNS + 10; i++) list = addRecord(list, mk(`x${i}`, i));
    expect(list).toHaveLength(MAX_RUNS);
  });
});
