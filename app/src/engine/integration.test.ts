/** Integration: TypeScript client <-> real Python engine over NDJSON. Skipped if Python is unavailable. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NodeProcessTransport } from "../test/nodeTransport";
import { EngineClient, EngineRequestError } from "./client";
import { initialRun, runReducer, type EngineEvent, type RunState } from "../model/runState";
import { addNode, connect, emptyDoc, toWorkflowFile, updateConfig, getType, type Doc } from "../model/editor";

const python = process.env["FLOWFORGE_PYTHON"] ?? "python3";
let hasPython = true;
try { execFileSync(python, ["--version"]); } catch { hasPython = false; }
const d = hasPython ? describe : describe.skip;

function organize(src: string, dest: string, dryRun: boolean): Doc {
  let doc = emptyDoc("it");
  for (const t of ["start", "list_files", "filter", "move_file", "finish"]) doc = addNode(doc, t, { x: 0, y: 0 });
  const id = (t: string) => doc.nodes.find((n) => getType(n) === t)!.id;
  doc = updateConfig(doc, id("list_files"), "directory", src);
  doc = updateConfig(doc, id("filter"), "extensions", [".txt"]);
  doc = updateConfig(doc, id("move_file"), "destination", dest);
  doc = updateConfig(doc, id("move_file"), "dryRun", dryRun);
  const link = (s: string, sp: string, t: string, tp: string) => { doc = connect(doc, { source: id(s), sourceHandle: sp, target: id(t), targetHandle: tp }); };
  link("start", "out", "list_files", "in"); link("list_files", "files", "filter", "files");
  link("filter", "matched", "move_file", "files"); link("move_file", "moved", "finish", "in");
  return doc;
}

async function runAndWait(client: EngineClient, params: Record<string, unknown>): Promise<RunState> {
  let state = runReducer(initialRun(), { type: "begin", mode: "preview" });
  const done = new Promise<void>((res) => client.onEvent((e: EngineEvent) => { state = runReducer(state, { type: "event", event: e }); if (e.event === "run_completed" || e.event === "run_cancelled") res(); }));
  await client.request("run", params);
  await done;
  return state;
}

d("TS client against the real engine", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ff ünï-"));
  const src = path.join(tmp, "src dir"), dest = path.join(tmp, "dest");
  fs.mkdirSync(src); fs.mkdirSync(dest);
  for (const n of ["a.txt", "b.txt", "c.png"]) fs.writeFileSync(path.join(src, n), n);

  it("handshake, validate, preview run, then confirmed apply", async () => {
    const client = new EngineClient(new NodeProcessTransport());
    const hello = await client.start();
    expect(hello.protocolVersion).toBe(1);

    const doc = organize(src, dest, true);
    const v = await client.request("validate", { workflow: toWorkflowFile(doc), options: { allowedRoots: [tmp] } });
    expect(v["valid"]).toBe(true);

    const preview = await runAndWait(client, { workflow: toWorkflowFile(doc), options: { allowedRoots: [tmp] } });
    expect(preview.status).toBe("success");
    expect(Object.values(preview.nodes).every((n) => n.status === "completed")).toBe(true);
    expect(fs.readdirSync(src)).toHaveLength(3);

    const applyDoc = organize(src, dest, false);
    const moveId = applyDoc.nodes.find((n) => getType(n) === "move_file")!.id;
    await expect(client.request("run", { workflow: toWorkflowFile(applyDoc), options: { allowedRoots: [tmp] } })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const applied = await runAndWait(client, { workflow: toWorkflowFile(applyDoc), options: { allowedRoots: [tmp], approvedNodes: [moveId] } });
    expect(applied.status).toBe("success");
    expect(fs.readdirSync(dest).sort()).toEqual(["a.txt", "b.txt"]);
    await client.shutdown();
  });

  it("surfaces a failing node as structured state", async () => {
    const client = new EngineClient(new NodeProcessTransport());
    await client.start();
    const doc = organize(path.join(tmp, "does-not-exist"), dest, true);
    const s = await runAndWait(client, { workflow: toWorkflowFile(doc), options: { allowedRoots: [tmp] } });
    expect(s.status).toBe("failed");
    const failed = Object.values(s.nodes).find((n) => n.status === "failed")!;
    expect(failed.error!.code).toBe("PATH_NOT_FOUND");
    expect(Object.values(s.nodes).filter((n) => n.status === "skipped")).toHaveLength(3);
    await client.shutdown();
  });

  it("rejects requests with EngineRequestError when the engine process dies", async () => {
    const t = new NodeProcessTransport();
    const client = new EngineClient(t);
    await client.start();
    let exitMsg = "";
    client.onExit((m) => { exitMsg = m; });
    t.kill();
    await new Promise((r) => setTimeout(r, 300));
    expect(exitMsg).toMatch(/stopped unexpectedly/);
    await expect(client.request("describe")).rejects.toBeInstanceOf(EngineRequestError);
  });

  it("start() fails cleanly when the engine cannot be launched", async () => {
    const client = new EngineClient(new NodeProcessTransport("/nonexistent/python"));
    await expect(client.start()).rejects.toBeTruthy();
  });
});
