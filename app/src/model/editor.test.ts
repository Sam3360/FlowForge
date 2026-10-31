import { describe, expect, it } from "vitest";
import { addNode, connect, connectionProblem, deleteNodes, duplicateNodes, emptyDoc, getType, localIssues, parseWorkflowText, serialize, updateConfig, type Doc } from "./editor";
import { historyReducer, initHistory } from "./history";

const pos = { x: 0, y: 0 };
function build(): Doc {
  let d = emptyDoc("T");
  for (const t of ["start", "list_files", "filter", "move_file", "finish"]) d = addNode(d, t, pos);
  return d;
}
const idOf = (d: Doc, type: string) => d.nodes.find((n) => getType(n) === type)!.id;

describe("node creation and deletion", () => {
  it("adds nodes with default config and allows only one Start", () => {
    const d = addNode(build(), "start", pos);
    expect(d.nodes.filter((n) => getType(n) === "start")).toHaveLength(1);
    const list = d.nodes.find((n) => getType(n) === "list_files")!;
    expect(list.data.config).toMatchObject({ recursive: false, include: [], maxFiles: 10000 });
  });
  it("deleting a node removes its connections", () => {
    let d = build();
    d = connect(d, { source: idOf(d, "start"), sourceHandle: "out", target: idOf(d, "list_files"), targetHandle: "in" });
    expect(d.edges).toHaveLength(1);
    d = deleteNodes(d, [idOf(d, "list_files")]);
    expect(d.edges).toHaveLength(0);
    expect(d.nodes).toHaveLength(4);
  });
  it("duplicate copies config independently and never duplicates Start", () => {
    let d = build();
    d = updateConfig(d, idOf(d, "filter"), "extensions", [".pdf"]);
    d = duplicateNodes(d, [idOf(d, "filter"), idOf(d, "start")]);
    const filters = d.nodes.filter((n) => getType(n) === "filter");
    expect(filters).toHaveLength(2);
    d = updateConfig(d, filters[1]!.id, "extensions", [".png"]);
    expect(d.nodes.find((n) => n.id === filters[0]!.id)!.data.config["extensions"]).toEqual([".pdf"]);
    expect(d.nodes.filter((n) => getType(n) === "start")).toHaveLength(1);
  });
});

describe("connection validation", () => {
  it("rejects incompatible port types with a clear reason", () => {
    const d = build();
    expect(connectionProblem(d, { source: idOf(d, "start"), sourceHandle: "out", target: idOf(d, "filter"), targetHandle: "files" })).toMatch(/context to files/);
  });
  it("rejects second connection to the same input, self loops and cycles", () => {
    let d = build();
    d = addNode(d, "filter", pos);
    const [f1, f2] = d.nodes.filter((n) => getType(n) === "filter");
    expect(connectionProblem(d, { source: f1!.id, sourceHandle: "matched", target: f1!.id, targetHandle: "files" })).toMatch(/itself/);
    d = connect(d, { source: f1!.id, sourceHandle: "matched", target: f2!.id, targetHandle: "files" });
    expect(connectionProblem(d, { source: f2!.id, sourceHandle: "matched", target: f1!.id, targetHandle: "files" })).toMatch(/cycle/);
    d = connect(d, { source: idOf(d, "list_files"), sourceHandle: "files", target: f1!.id, targetHandle: "files" });
    expect(connectionProblem(d, { source: idOf(d, "list_files"), sourceHandle: "files", target: f1!.id, targetHandle: "files" })).toMatch(/already/);
  });
  it("an invalid connect() is a no-op", () => {
    const d = build();
    expect(connect(d, { source: idOf(d, "start"), sourceHandle: "out", target: idOf(d, "filter"), targetHandle: "files" }).edges).toHaveLength(0);
  });
});

describe("validation errors", () => {
  it("reports missing Start, required fields and unconnected inputs", () => {
    const d = addNode(addNode(emptyDoc(), "list_files", pos), "finish", pos);
    const codes = localIssues(d).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["START_MISSING", "CONFIG_REQUIRED", "INPUT_NOT_CONNECTED"]));
    expect(localIssues(d).find((i) => i.code === "CONFIG_REQUIRED")).toMatchObject({ field: "directory" });
  });
});

describe("save and reopen", () => {
  it("round-trips nodes, edges, config and positions", () => {
    let d = build();
    d = connect(d, { source: idOf(d, "start"), sourceHandle: "out", target: idOf(d, "list_files"), targetHandle: "in" });
    d = updateConfig(d, idOf(d, "list_files"), "directory", "C:\\Users\\Zoë\\Downloads");
    const text = serialize(d, { x: 1, y: 2, zoom: 0.5 });
    const r = parseWorkflowText(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(serialize(r.doc, r.viewport)).toBe(text);
      expect(r.viewport).toEqual({ x: 1, y: 2, zoom: 0.5 });
    }
  });
  it("saved file contains no runtime state", () => {
    const text = serialize(build());
    expect(text).not.toMatch(/status|duration|selected/);
  });
  it.each([
    ["{nope", /not valid JSON/], ["[]", /does not look like a workflow/],
    [JSON.stringify({ schemaVersion: 7, nodes: [], edges: [] }), /Unsupported workflow version 7/],
    [JSON.stringify({ schemaVersion: 1, nodes: [{ id: "a", type: "teleport" }], edges: [] }), /teleport/],
    [JSON.stringify({ schemaVersion: 1, nodes: [{ id: "a", type: "start" }, { id: "a", type: "start" }], edges: [] }), /duplicate/],
  ])("friendly error for bad file %#", (text, re) => {
    const r = parseWorkflowText(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(re);
  });
});

describe("undo / redo and unsaved changes", () => {
  it("checkpoint + set is undoable and redoable; transient set is not an undo step", () => {
    let h = initHistory(emptyDoc());
    h = historyReducer(h, { type: "checkpoint" });
    h = historyReducer(h, { type: "set", doc: addNode(h.present, "start", pos) });
    h = historyReducer(h, { type: "set", doc: { ...h.present, nodes: h.present.nodes.map((n) => ({ ...n, selected: true })) } });
    expect(h.past).toHaveLength(1);
    h = historyReducer(h, { type: "undo" });
    expect(h.present.nodes).toHaveLength(0);
    h = historyReducer(h, { type: "redo" });
    expect(h.present.nodes).toHaveLength(1);
  });
  it("a new edit after undo clears redo", () => {
    let h = initHistory(emptyDoc());
    h = historyReducer(h, { type: "checkpoint" }); h = historyReducer(h, { type: "set", doc: addNode(h.present, "start", pos) });
    h = historyReducer(h, { type: "undo" });
    h = historyReducer(h, { type: "checkpoint" });
    expect(h.future).toHaveLength(0);
  });
  it("selection and runtime-irrelevant changes do not alter the serialized (dirty) form", () => {
    const d = build();
    const selected = { ...d, nodes: d.nodes.map((n) => ({ ...n, selected: true })) };
    expect(serialize(selected)).toBe(serialize(d));
    expect(serialize(updateConfig(d, idOf(d, "filter"), "nameContains", "x"))).not.toBe(serialize(d));
  });
});

describe("duplicate with connections", () => {
  const wire = (d: Doc, s: string, sp: string, t: string, tp: string) => connect(d, { source: idOf(d, s), sourceHandle: sp, target: idOf(d, t), targetHandle: tp });
  it("copies connections between duplicated nodes but never to nodes outside the selection", async () => {
    const { duplicateNodesWithIds } = await import("./editor");
    let d = build();
    d = wire(d, "start", "out", "list_files", "in"); d = wire(d, "list_files", "files", "filter", "files"); d = wire(d, "filter", "matched", "move_file", "files");
    const r = duplicateNodesWithIds(d, [idOf(d, "list_files"), idOf(d, "filter")]);
    expect(r.newIds).toHaveLength(2);
    expect(r.doc.edges).toHaveLength(3 + 1);                                  // + the list_files -> filter copy
    const copyEdge = r.doc.edges.at(-1)!;
    expect(r.newIds).toContain(copyEdge.source); expect(r.newIds).toContain(copyEdge.target);
    expect(r.doc.edges.filter((e) => e.target === idOf(d, "move_file"))).toHaveLength(1);   // original input untouched
    expect(r.doc.edges.filter((e) => r.newIds.includes(e.source) && !r.newIds.includes(e.target))).toHaveLength(0);
    expect(new Set(r.doc.edges.map((e) => e.id)).size).toBe(r.doc.edges.length);
  });
  it("selects the copies, deselects the originals, and preserves configuration", async () => {
    const { duplicateNodesWithIds } = await import("./editor");
    let d = build();
    d = updateConfig(d, idOf(d, "move_file"), "collision", "rename");
    d = { ...d, nodes: d.nodes.map((n) => ({ ...n, selected: getType(n) === "move_file" })) };
    const r = duplicateNodesWithIds(d, [idOf(d, "move_file")]);
    const copy = r.doc.nodes.find((n) => n.id === r.newIds[0])!;
    expect(copy.data.config["collision"]).toBe("rename");
    expect(copy.selected).toBe(true);
    expect(r.doc.nodes.find((n) => n.id === idOf(d, "move_file"))!.selected).toBe(false);
  });
  it("duplicating only Start does nothing", async () => {
    const { duplicateNodesWithIds } = await import("./editor");
    const d = build();
    const r = duplicateNodesWithIds(d, [idOf(d, "start")]);
    expect(r.newIds).toEqual([]); expect(r.doc).toBe(d);
  });
});

describe("untrusted workflow files", () => {
  const file = (nodes: unknown[], edges: unknown[] = []) => JSON.stringify({ schemaVersion: 1, name: "x", nodes, edges });
  it("resets wrongly-typed settings to defaults and reports it instead of crashing later", () => {
    const r = parseWorkflowText(file([{ id: "l", type: "list_files", config: { directory: 5, include: "*.pdf", recursive: "yes", maxFiles: -3, bogus: 1 }, position: { x: 1, y: 2 } }]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.nodes[0]!.data.config).toMatchObject({ directory: null, include: [], recursive: false, maxFiles: -3 });   // right type, out of range: kept, and the engine reports it
    expect(Array.isArray(r.doc.nodes[0]!.data.config["include"])).toBe(true);
    expect(r.doc.nodes[0]!.data.config["bogus"]).toBeUndefined();
    expect(r.warnings.join("\n")).toMatch(/Directory.*reset/);
    expect(r.warnings.join("\n")).toMatch(/unknown setting "bogus"/);
  });
  it("drops connections to missing nodes, unknown ports, and duplicate ids, and says so", () => {
    const r = parseWorkflowText(file([{ id: "s", type: "start" }, { id: "l", type: "list_files" }], [
      { id: "e1", source: "s", sourcePort: "out", target: "l", targetPort: "in" },
      { id: "e1", source: "s", sourcePort: "out", target: "l", targetPort: "in" },
      { id: "e2", source: "s", sourcePort: "nope", target: "l", targetPort: "in" },
      { id: "e3", source: "s", sourcePort: "out", target: "ghost", targetPort: "in" }]));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.doc.edges).toHaveLength(1); expect(r.warnings.join()).toMatch(/3 invalid or duplicate connection/); }
  });
  it("tolerates junk entries and non-object configs without throwing", () => {
    for (const nodes of [[null], [{}], [{ id: 5, type: "start" }], [{ id: "a", type: "start", config: [1, 2] }], [{ id: "a", type: "start", position: "x" }]]) {
      expect(() => parseWorkflowText(file(nodes as unknown[]))).not.toThrow();
    }
  });
  it("clean files produce no warnings", () => {
    let d = build();
    d = connect(d, { source: idOf(d, "start"), sourceHandle: "out", target: idOf(d, "list_files"), targetHandle: "in" });
    const r = parseWorkflowText(serialize(d));
    expect(r.ok && r.warnings).toEqual([]);
  });
});
