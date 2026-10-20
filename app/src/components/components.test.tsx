import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { addNode, emptyDoc, updateConfig, getType } from "../model/editor";
import { initialRun, runReducer, type NodeRun } from "../model/runState";
import { ExecutionPanel } from "./ExecutionPanel";
import { Inspector } from "./Inspector";
import { NodeLibrary } from "./NodeLibrary";
import { RunDialog } from "./Dialogs";
import { Toolbar } from "./Toolbar";
import { DEFAULT_SETTINGS } from "../services/settings";

function Harness({ type }: { type: string }) {
  const [doc, setDoc] = useState(() => addNode(emptyDoc(), type, { x: 0, y: 0 }));
  const node = doc.nodes[0]!;
  return (
    <>
      <Inspector node={node} issues={[]} run={undefined} onChange={(id, f, v) => setDoc((d) => updateConfig(d, id, f, v))} onBeginEdit={() => undefined}
        onBrowse={async () => "C:\\picked"} onDuplicate={() => undefined} onDelete={() => undefined} />
      <output data-testid="cfg">{JSON.stringify(doc.nodes[0]!.data.config)}</output>
      <output data-testid="type">{getType(node)}</output>
    </>
  );
}

describe("configuration editing", () => {
  it("edits fields by type: toggle, list, number, enum, and folder browse", async () => {
    const u = userEvent.setup();
    const { unmount } = render(<Harness type="list_files" />);
    await u.click(screen.getByLabelText("Include subfolders"));
    await u.type(screen.getByLabelText("Include patterns"), "*.pdf");
    await u.click(screen.getByRole("button", { name: /Browse for Directory/ }));
    const cfg = JSON.parse(screen.getByTestId("cfg").textContent!);
    expect(cfg).toMatchObject({ recursive: true, include: ["*.pdf"], directory: "C:\\picked" });
    unmount();
    render(<Harness type="condition" />);
    await u.selectOptions(screen.getByLabelText("Operator"), "lte");
    await u.clear(screen.getByLabelText(/Value/)); await u.type(screen.getByLabelText(/Value/), "7");
    expect(JSON.parse(screen.getByTestId("cfg").textContent!)).toMatchObject({ operator: "lte", value: 7 });
  });
  it("shows field-level validation errors", () => {
    const doc = addNode(emptyDoc(), "list_files", { x: 0, y: 0 });
    render(<Inspector node={doc.nodes[0]!} run={undefined} onChange={() => undefined} onBeginEdit={() => undefined} onBrowse={async () => null}
      onDuplicate={() => undefined} onDelete={() => undefined}
      issues={[{ severity: "error", code: "CONFIG_REQUIRED", message: "Directory is required", nodeId: doc.nodes[0]!.id, edgeId: null, field: "directory" }]} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Directory is required");
  });
});

describe("execution inspector", () => {
  const failed: NodeRun = { status: "failed", durationMs: 4, error: { code: "NAME_COLLISION", message: "2 file(s) already exist", details: { counts: { collision: 2 } } } };
  it("renders failure, branch and skip information in the execution tab", async () => {
    const u = userEvent.setup();
    const doc = addNode(emptyDoc(), "move_file", { x: 0, y: 0 });
    const { rerender } = render(<Inspector node={doc.nodes[0]!} issues={[]} run={failed} onChange={() => undefined} onBeginEdit={() => undefined} onBrowse={async () => null} onDuplicate={() => undefined} onDelete={() => undefined} />);
    await u.click(screen.getByRole("tab", { name: /Execution/ }));
    expect(within(screen.getByTestId("exec-view")).getByRole("alert")).toHaveTextContent("NAME_COLLISION");
    rerender(<Inspector node={doc.nodes[0]!} issues={[]} run={{ status: "completed", summary: { branch: "true" }, outputs: { true: { preview: [{ name: "a.txt" }], truncated: true, totalItems: 900 } } }}
      onChange={() => undefined} onBeginEdit={() => undefined} onBrowse={async () => null} onDuplicate={() => undefined} onDelete={() => undefined} />);
    expect(screen.getByText("Branch taken").nextSibling).toHaveTextContent("true");
    expect(screen.getByText(/900 item\(s\) · truncated for display/)).toBeInTheDocument();
  });
  it("execution panel lists nodes, selects on click, and surfaces cancellation honestly", async () => {
    const u = userEvent.setup(); const onSelect = vi.fn();
    let run = runReducer(initialRun(), { type: "begin", mode: "apply" });
    for (const e of [{ event: "run_started", order: ["a", "b"] }, { event: "node_completed", nodeId: "a", durationMs: 5 }, { event: "node_cancelled", nodeId: "b", message: "x" }, { event: "run_cancelled", status: "cancelled" }])
      run = runReducer(run, { type: "event", event: { type: "event", runId: "r", ...e } });
    render(<ExecutionPanel run={run} names={{ a: "start", b: "move_file" }} selectedId={null} collapsed={false} height={240} onToggle={() => undefined} onSelect={onSelect} onResize={() => undefined} />);
    expect(screen.getByTestId("run-status")).toHaveTextContent("cancelled");
    expect(screen.getByText(/not undone/)).toBeInTheDocument();
    await u.click(screen.getByText("Move File"));
    expect(onSelect).toHaveBeenCalledWith("b");
  });
});

describe("toolbar and dialogs", () => {
  const base = { name: "W", filePath: null, canUndo: false, canRedo: false, running: false, engineReady: true, settings: DEFAULT_SETTINGS, engineInfo: "x",
    onName: () => undefined, onNew: () => undefined, onOpen: () => undefined, onSave: () => undefined, onSaveAs: () => undefined, onUndo: () => undefined,
    onRedo: () => undefined, onValidate: () => undefined, onRun: () => undefined, onStop: () => undefined, onSettings: () => undefined, onExample: () => undefined };
  it("shows the unsaved-changes indicator", () => {
    const { rerender } = render(<Toolbar {...base} dirty={false} />);
    expect(screen.getByTestId("dirty-indicator")).not.toHaveClass("is-dirty");
    rerender(<Toolbar {...base} dirty />);
    expect(screen.getByTestId("dirty-indicator")).toHaveTextContent("Unsaved changes");
  });
  it("Run is disabled without an engine; Stop replaces Run while running", () => {
    const { rerender } = render(<Toolbar {...base} dirty={false} engineReady={false} />);
    expect(screen.getByRole("button", { name: /Run/ })).toBeDisabled();
    rerender(<Toolbar {...base} dirty={false} running />);
    expect(screen.getByRole("button", { name: /Stop/ })).toBeEnabled();
  });
  it("applying changes requires an explicit acknowledgement", async () => {
    const u = userEvent.setup(); const onRun = vi.fn();
    render(<RunDialog plan={{ folders: ["/a"], applyNodeIds: ["m"] }} onRun={onRun} onClose={() => undefined} />);
    const apply = screen.getByRole("button", { name: /apply changes/ });
    expect(apply).toBeDisabled();
    await u.click(screen.getByRole("checkbox")); await u.click(apply);
    expect(onRun).toHaveBeenCalledWith("apply");
  });
  it("library filters nodes and shows an empty state", async () => {
    const u = userEvent.setup();
    render(<NodeLibrary onAdd={() => undefined} />);
    expect(screen.getAllByRole("button").length).toBe(6);
    await u.type(screen.getByLabelText("Search nodes"), "zzz");
    expect(screen.getByText(/No nodes match/)).toBeInTheDocument();
  });
});
