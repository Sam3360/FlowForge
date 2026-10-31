/** App-level smoke test in jsdom with the REAL engine (child process) and an in-memory FileService. */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { EngineClient } from "./engine/client";
import type { FileService } from "./services/files";
import { NodeProcessTransport } from "./test/nodeTransport";

beforeAll(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
  class DM { m22 = 1; constructor(_?: string) {} }
  (globalThis as unknown as { DOMMatrixReadOnly: unknown }).DOMMatrixReadOnly = DM;
});

function memFiles(dir: string, pickDir: () => string) {
  const store = new Map<string, string>();
  let recovery: string | null = null;
  const f: FileService = {
    pickOpenPath: async () => null,
    pickSavePath: async (n) => path.join(dir, `${n}.flowforge.json`),
    pickDirectory: async () => pickDir(),
    readText: async (p) => store.get(p) ?? fs.readFileSync(p, "utf8"),
    writeTextAtomic: async (p, t) => { store.set(p, t); },
    writeRecovery: async (t) => { recovery = t; }, readRecovery: async () => recovery, clearRecovery: async () => { recovery = null; },
    onCloseRequested: async () => () => undefined,
  };
  return { f, store };
}

describe("App", () => {
  it("loads the example, validates, previews, applies with confirmation, saves", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ff app ünï-"));
    const src = path.join(tmp, "in"), dest = path.join(tmp, "out");
    fs.mkdirSync(src);
    for (const n of ["x.pdf", "y.pdf", "z.txt"]) fs.writeFileSync(path.join(src, n), n);
    const picks = [src, dest];
    const { f, store } = memFiles(tmp, () => picks.shift() ?? tmp);
    const client = new EngineClient(new NodeProcessTransport());
    const u = userEvent.setup();
    render(<App services={{ engine: client, files: f }} />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Run/ })).toBeEnabled(), { timeout: 8000 });
    await u.click(screen.getByRole("button", { name: "Settings" }));
    await u.click(screen.getByText(/Open “Organize Downloads”/));
    await waitFor(() => expect(screen.getByTestId(/^node-list/)).toBeInTheDocument());

    // running before choosing folders is blocked with visible problems
    await u.click(screen.getByRole("button", { name: /Run/ }));
    expect(screen.queryByRole("dialog", { name: "Run workflow" })).not.toBeInTheDocument();
    expect(await screen.findByRole("list", { name: "Validation problems" })).toHaveTextContent(/Directory is required/);

    // choose folders through the inspector
    fireEvent.click(screen.getByTestId(/^node-list/));
    await u.click(await screen.findByRole("button", { name: /Browse for Directory/ }));
    fireEvent.click(screen.getByTestId(/^node-move/));
    await u.click(await screen.findByRole("button", { name: /Browse for Destination/ }));
    await waitFor(() => expect(screen.getByTestId("dirty-indicator")).toHaveTextContent("Unsaved"));

    await u.click(screen.getByRole("button", { name: /Validate/ }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Workflow is valid"));

    // preview run
    await u.click(screen.getByRole("button", { name: /Run/ }));
    const dlg = await screen.findByRole("dialog", { name: "Run workflow" });
    await u.click(within(dlg).getByRole("button", { name: /^Run$/ }));
    await waitFor(() => expect(screen.getByTestId("run-status")).toHaveTextContent("success"), { timeout: 8000 });
    expect(fs.readdirSync(src)).toHaveLength(3);

    // apply: turn off preview in the Move node, run with confirmation
    fireEvent.click(screen.getByTestId(/^node-move/));
    await u.click(await screen.findByLabelText("Preview only (dry run)"));
    await u.click(screen.getByRole("button", { name: /Run/ }));
    const dlg2 = await screen.findByRole("dialog", { name: "Run workflow" });
    const apply = within(dlg2).getByRole("button", { name: /apply changes/ });
    expect(apply).toBeDisabled();
    await u.click(within(dlg2).getByRole("checkbox")); await u.click(apply);
    await waitFor(() => expect(screen.getByTestId("run-status")).toHaveTextContent("success"), { timeout: 8000 });
    expect(fs.readdirSync(dest).sort()).toEqual(["x.pdf", "y.pdf"]);
    expect(fs.readdirSync(src)).toEqual(["z.txt"]);

    // save clears the dirty flag and writes a workflow without run state
    await u.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(screen.getByTestId("dirty-indicator")).not.toHaveClass("is-dirty"));
    const saved = [...store.values()][0]!;
    expect(JSON.parse(saved).schemaVersion).toBe(1);
    expect(saved).not.toMatch(/durationMs|"status"/);
    await act(async () => { await client.shutdown(); });
  }, 60000);

  it("problems navigate to nodes; duplicate/delete are undoable; history keeps completed, failed runs and keeps past runs separate", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ff hist ünï-"));
    const src = path.join(tmp, "in"), dest = path.join(tmp, "out");
    fs.mkdirSync(src);
    for (const n of ["x.pdf", "y.pdf"]) fs.writeFileSync(path.join(src, n), n);
    const picks = [src, dest];
    const { f } = memFiles(tmp, () => picks.shift() ?? tmp);
    const client = new EngineClient(new NodeProcessTransport());
    const u = userEvent.setup();
    render(<App services={{ engine: client, files: f }} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Run/ })).toBeEnabled(), { timeout: 8000 });

    // first-run guidance, then the example
    expect(screen.getByTestId("empty-canvas")).toHaveTextContent(/Build your first workflow/);
    await u.click(screen.getByRole("button", { name: "Open the example workflow" }));
    await waitFor(() => expect(screen.getByTestId(/^node-list/)).toBeInTheDocument());
    expect(screen.queryByTestId("empty-canvas")).not.toBeInTheDocument();

    // validation: blocking errors listed in Problems; clicking one selects the affected node
    await u.click(screen.getByRole("button", { name: /Validate/ }));
    const list = await screen.findByRole("list", { name: "Validation problems" });
    expect(within(list).getAllByRole("button")).toHaveLength(2);
    await u.click(within(list).getByRole("button", { name: /List Files.*Directory is required/s }));
    expect(await screen.findByRole("complementary", { name: "Inspector" })).toHaveTextContent("List Files");

    // duplicate (config preserved) then delete with Undo
    const nodesBefore = screen.getAllByTestId(/^node-/).length;
    await u.click(screen.getByRole("button", { name: "Duplicate node" }));
    await waitFor(() => expect(screen.getAllByTestId(/^node-/)).toHaveLength(nodesBefore + 1));
    await u.click(screen.getByRole("button", { name: "Delete node" }));
    await waitFor(() => expect(screen.getAllByTestId(/^node-/)).toHaveLength(nodesBefore));
    await u.click(within(screen.getByRole("status")).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getAllByTestId(/^node-/)).toHaveLength(nodesBefore + 1));
    await u.click(screen.getByRole("button", { name: "Delete node" }));       // remove the copy again
    await waitFor(() => expect(screen.getAllByTestId(/^node-/)).toHaveLength(nodesBefore));

    // choose folders
    fireEvent.click(screen.getByTestId(/^node-list/));
    await u.click(await screen.findByRole("button", { name: /Browse for Directory/ }));
    fireEvent.click(screen.getByTestId(/^node-move/));
    await u.click(await screen.findByRole("button", { name: /Browse for Destination/ }));

    const run = async (apply: boolean) => {
      await u.click(screen.getByRole("button", { name: /Run/ }));
      const dlg = await screen.findByRole("dialog", { name: "Run workflow" });
      if (apply) { await u.click(within(dlg).getByRole("checkbox")); await u.click(within(dlg).getByRole("button", { name: /apply changes/ })); }
      else await u.click(within(dlg).getByRole("button", { name: /^Run( preview.*)?$/ }));
    };
    const idle = () => waitFor(() => expect(["success", "failed", "cancelled"].some((s) => screen.getByTestId("run-status").textContent === s)).toBe(true), { timeout: 8000 });

    await run(false); await idle();                                              // run #1: preview, completed
    expect(fs.readdirSync(src)).toHaveLength(2);
    fireEvent.click(screen.getByTestId(/^node-move/));
    await u.click(await screen.findByLabelText("Preview only (dry run)"));
    await u.selectOptions(screen.getByLabelText("If a file already exists"), "fail");
    await run(true); await idle();                                               // run #2: applied, completed
    expect(fs.readdirSync(dest).sort()).toEqual(["x.pdf", "y.pdf"]);
    fs.writeFileSync(path.join(src, "x.pdf"), "NEW");
    await run(true);                                                             // run #3: collision -> fails at Move File
    await waitFor(() => expect(screen.getByTestId("run-status")).toHaveTextContent("failed"), { timeout: 8000 });
    expect(screen.getByTestId("failure-summary")).toHaveTextContent(/Failed at “Move File”.*already exist.*What to check.*skip or rename/s);
    expect(fs.readFileSync(path.join(dest, "x.pdf"), "utf8")).toBe("x.pdf");    // not overwritten
    expect(fs.readFileSync(path.join(src, "x.pdf"), "utf8")).toBe("NEW");

    // history: newest first, accurate statuses, past runs can be inspected without touching the live state
    await u.click(screen.getByRole("tab", { name: /History \(3\)/ }));
    const rows = within(screen.getByRole("table", { name: "Run history" })).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringMatching(/^3failed.*Move File/), expect.stringMatching(/^2completed/), expect.stringMatching(/^1completed/)]);
    await u.click(screen.getByTestId("history-1"));
    expect(screen.getByTestId("viewing-chip")).toHaveTextContent("Viewing run #1");
    expect(screen.getByTestId("run-status")).toHaveTextContent("failed");        // live status unchanged
    expect(screen.getByTestId(/^node-move/)).toHaveAttribute("data-status", "completed");
    await u.click(within(screen.getByTestId("viewing-chip")).getByRole("button", { name: /Back to live/ }));
    expect(screen.getByTestId(/^node-move/)).toHaveAttribute("data-status", "failed");
    expect(screen.queryByTestId("viewing-chip")).not.toBeInTheDocument();
    await act(async () => { await client.shutdown(); });
  }, 90000);

  it("shows a clear banner and disables Run when the engine is unavailable", async () => {
    const { f } = memFiles(os.tmpdir(), () => os.tmpdir());
    const client = new EngineClient(new NodeProcessTransport("/nonexistent/python"));
    render(<App services={{ engine: client, files: f }} />);
    expect(await screen.findByText(/execution engine is not available/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run/ })).toBeDisabled();
    expect(vi.isMockFunction(f.readText)).toBe(false);
  });
});
