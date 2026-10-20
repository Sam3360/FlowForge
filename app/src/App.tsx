import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Canvas, type CanvasHandle } from "./components/Canvas";
import { ConfirmDialog, RunDialog, type ConfirmSpec, type RunPlan } from "./components/Dialogs";
import { ExecutionPanel } from "./components/ExecutionPanel";
import { Inspector } from "./components/Inspector";
import { NodeLibrary } from "./components/NodeLibrary";
import { OverlayContext } from "./components/RunContext";
import { Toolbar } from "./components/Toolbar";
import { PRODUCT_NAME } from "./config/product";
import { EngineClient, EngineRequestError } from "./engine/client";
import { getDef } from "./model/definitions";
import { addNode, deleteNodes, duplicateNodes, emptyDoc, getType, localIssues, parseWorkflowText, serialize, toWorkflowFile, updateConfig, type Doc, type Viewport } from "./model/editor";
import { historyReducer, initHistory } from "./model/history";
import { initialRun, isActive, runReducer } from "./model/runState";
import type { Issue } from "./model/types";
import type { FileService } from "./services/files";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./services/settings";
import exampleText from "../../examples/organize-downloads.flowforge.json?raw";

export interface Services { engine: EngineClient | null; files: FileService }

type EngineStatus = { state: "starting" } | { state: "ready"; version: string } | { state: "unavailable"; message: string };

export function App({ services }: { services: Services }) {
  const { engine, files } = services;
  const [hist, dispatchHist] = useReducer(historyReducer, undefined, () => initHistory(emptyDoc()));
  const doc = hist.present;
  const [filePath, setFilePath] = useState<string | null>(null);
  const [savedText, setSavedText] = useState<string>(() => serialize(emptyDoc()));
  const [viewport0, setViewport0] = useState<Viewport | undefined>();
  const [canvasKey, setCanvasKey] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [run, dispatchRun] = useReducer(runReducer, undefined, initialRun);
  const [engineStatus, setEngineStatus] = useState<EngineStatus>({ state: "starting" });
  const [settings, setSettings] = useState(() => (typeof localStorage === "undefined" ? DEFAULT_SETTINGS : loadSettings()));
  const [toast, setToast] = useState<string | null>(null);
  const [panel, setPanel] = useState({ collapsed: false, height: 240 });
  const [confirm, setConfirm] = useState<{ spec: ConfirmSpec; resolve: (c: "confirm" | "discard" | "cancel") => void } | null>(null);
  const [runPlan, setRunPlan] = useState<RunPlan | null>(null);
  const canvas = useRef<CanvasHandle>(null);
  const editKey = useRef<string>("");

  const dirty = useMemo(() => serialize(doc) !== savedText, [doc, savedText]);
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const selectedId = selected.length === 1 ? (selected[0] ?? null) : null;
  const selectedNode = doc.nodes.find((n) => n.id === selectedId) ?? null;
  const nodeTypes = useMemo(() => Object.fromEntries(doc.nodes.map((n) => [n.id, getType(n)])), [doc.nodes]);
  const say = useCallback((m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? null : t)), 5000); }, []);

  // ---- engine lifecycle ----
  const startEngine = useCallback(async () => {
    if (!engine) { setEngineStatus({ state: "unavailable", message: "No engine is configured (running outside the desktop shell)." }); return; }
    setEngineStatus({ state: "starting" });
    try { const h = await engine.start(); setEngineStatus({ state: "ready", version: h.engineVersion }); }
    catch (e) { setEngineStatus({ state: "unavailable", message: e instanceof Error ? e.message : String(e) }); }
  }, [engine]);
  useEffect(() => {
    if (!engine) { setEngineStatus({ state: "unavailable", message: "No engine is configured (running outside the desktop shell)." }); return; }
    const offE = engine.onEvent((e) => dispatchRun({ type: "event", event: e }));
    const offX = engine.onExit((m) => { dispatchRun({ type: "engine_error", message: m }); setEngineStatus({ state: "unavailable", message: m }); });
    void startEngine();
    return () => { offE(); offX(); void engine.shutdown(); };
  }, [engine, startEngine]);

  // ---- confirm helper ----
  const ask = useCallback((spec: ConfirmSpec) => new Promise<"confirm" | "discard" | "cancel">((resolve) => setConfirm({ spec, resolve })), []);
  const guardUnsaved = useCallback(async (): Promise<boolean> => {
    if (!dirtyRef.current) return true;
    const c = await ask({ title: "Unsaved changes", message: "This workflow has changes that have not been saved.", confirmLabel: "Save", discardLabel: "Discard changes" });
    if (c === "cancel") return false;
    if (c === "discard") return true;
    return saveRef.current(false);
  }, [ask]);

  // ---- persistence ----
  const currentText = useCallback(() => serialize(doc, canvas.current?.getViewport()), [doc]);
  const saveRef = useRef<(as: boolean) => Promise<boolean>>(async () => false);
  const save = useCallback(async (as: boolean): Promise<boolean> => {
    try {
      let path = filePath;
      if (as || !path) { path = await files.pickSavePath(doc.name); if (!path) return false; }
      await files.writeTextAtomic(path, currentText());
      setFilePath(path); setSavedText(serialize(doc)); await files.clearRecovery().catch(() => undefined);
      say(`Saved ${path}`);
      return true;
    } catch (e) { say(`Could not save: ${e instanceof Error ? e.message : String(e)}`); return false; }
  }, [doc, files, filePath, currentText, say]);
  saveRef.current = save;

  const loadText = useCallback((text: string, path: string | null): boolean => {
    const r = parseWorkflowText(text);
    if (!r.ok) { say(r.message); return false; }
    dispatchHist({ type: "load", doc: r.doc }); setViewport0(r.viewport); setCanvasKey((k) => k + 1);
    setFilePath(path); setSavedText(serialize(r.doc)); setSelected([]); setIssues([]); dispatchRun({ type: "reset" });
    return true;
  }, [say]);

  const onNew = async () => { if (!(await guardUnsaved())) return; loadText(serialize(emptyDoc()), null); };
  const onOpen = async () => {
    if (!(await guardUnsaved())) return;
    try { const path = await files.pickOpenPath(); if (!path) return; loadText(await files.readText(path), path); }
    catch (e) { say(`Could not open the file: ${e instanceof Error ? e.message : String(e)}`); }
  };
  const onExample = async () => { if (!(await guardUnsaved())) return; loadText(exampleText, null); say("Example loaded. Choose the folders in the List Files and Move File nodes, then press Run."); };

  useEffect(() => { // close-window guard
    let off: (() => void) | undefined;
    void files.onCloseRequested(async () => { if (!dirtyRef.current) return true; return (await guardUnsaved()); }).then((u) => { off = u; }).catch(() => undefined);
    return () => off?.();
  }, [files, guardUnsaved]);

  useEffect(() => { // recovery copy
    if (!settings.autosaveRecovery || !dirty) return;
    const t = window.setTimeout(() => { void files.writeRecovery(currentText()).catch(() => undefined); }, 3000);
    return () => window.clearTimeout(t);
  }, [doc, dirty, settings.autosaveRecovery, files, currentText]);
  useEffect(() => {
    void files.readRecovery().then(async (t) => {
      if (!t) return;
      const c = await ask({ title: "Recover unsaved work?", message: "The app closed before your last changes were saved. A recovery copy is available.", confirmLabel: "Restore", discardLabel: "Discard" });
      if (c === "confirm" && loadText(t, null)) setSavedText(""); // restored copy counts as unsaved
      if (c !== "cancel") await files.clearRecovery().catch(() => undefined);
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- editing ----
  const setDoc = useCallback((d: Doc) => dispatchHist({ type: "set", doc: d }), []);
  const checkpoint = useCallback(() => { editKey.current = ""; dispatchHist({ type: "checkpoint" }); }, []);
  const onAddAt = useCallback((type: string, pos: { x: number; y: number }) => {
    if (type === "start" && doc.nodes.some((n) => getType(n) === "start")) { say("A workflow can only have one Start node."); return; }
    checkpoint(); setDoc(addNode(doc, type, pos));
  }, [doc, checkpoint, setDoc, say]);
  const onDuplicate = useCallback((ids: string[]) => { checkpoint(); setDoc(duplicateNodes(doc, ids)); }, [doc, checkpoint, setDoc]);
  const onBeginEdit = useCallback((field: string) => {
    const k = `${selectedId}:${field}`;
    if (editKey.current !== k) { dispatchHist({ type: "checkpoint" }); editKey.current = k; }
  }, [selectedId]);
  const undo = () => { editKey.current = ""; dispatchHist({ type: "undo" }); };
  const redo = () => { editKey.current = ""; dispatchHist({ type: "redo" }); };

  // ---- validation & running ----
  const validate = useCallback(async (options?: Record<string, unknown>): Promise<boolean> => {
    const local = localIssues(doc);
    if (local.length) { setIssues(local); say(`${local.length} problem(s) found. Fix the highlighted nodes.`); return false; }
    if (engine?.isRunning) {
      try {
        const r = await engine.request("validate", { workflow: toWorkflowFile(doc), ...(options ? { options } : {}) });
        const list = r["issues"] as Issue[];
        setIssues(list);
        if (!(r["valid"] as boolean)) { say(`${list.filter((i) => i.severity === "error").length} problem(s) found by the engine.`); return false; }
      } catch (e) { say(e instanceof Error ? e.message : String(e)); return false; }
    } else { say("The execution engine is not available, so only basic checks ran."); return false; }
    setIssues(localIssues(doc)); say("Workflow is valid.");
    return true;
  }, [doc, engine, say]);

  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const n of doc.nodes) for (const f of getDef(getType(n))?.config ?? []) {
      const v = n.data.config[f.name];
      if (f.type === "path" && typeof v === "string" && v) set.add(v);
    }
    return [...set];
  }, [doc.nodes]);
  const applyNodeIds = useMemo(() => doc.nodes.filter((n) => getDef(getType(n))?.requiresConfirmation && n.data.config["dryRun"] === false).map((n) => n.id), [doc.nodes]);

  const onRunClicked = async () => {
    if (localIssues(doc).length) { setIssues(localIssues(doc)); say("Fix the highlighted problems before running."); return; }
    setRunPlan({ folders, applyNodeIds });
  };
  const startRun = async (mode: "preview" | "apply") => {
    setRunPlan(null);
    if (!engine?.isRunning) { say("The execution engine is not running."); return; }
    const options = { allowedRoots: folders, dryRun: mode === "preview", approvedNodes: mode === "apply" ? applyNodeIds : [] };
    dispatchRun({ type: "begin", mode });
    setPanel((p) => ({ ...p, collapsed: false }));
    try {
      const r = await engine.request("run", { workflow: toWorkflowFile(doc), options });
      setIssues((r["warnings"] as Issue[]) ?? []);
    } catch (e) {
      if (e instanceof EngineRequestError && e.code === "VALIDATION_FAILED") setIssues((e.details["issues"] as Issue[]) ?? []);
      dispatchRun({ type: "reset" });
      say(e instanceof Error ? e.message : String(e));
    }
  };
  const onStop = async () => { try { await engine?.request("cancel"); } catch (e) { say(e instanceof Error ? e.message : String(e)); } };

  useEffect(() => { // shortcuts
    const h = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const inField = (e.target as HTMLElement | null)?.closest("input,textarea,select");
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); void save(e.shiftKey); }
      else if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); void onOpen(); }
      else if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); void onNew(); }
      else if (mod && e.key.toLowerCase() === "z" && !inField) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && e.key.toLowerCase() === "y" && !inField) { e.preventDefault(); redo(); }
      else if (mod && e.key.toLowerCase() === "d" && !inField && selected.length) { e.preventDefault(); onDuplicate(selected); }
      else if (e.key === "F5" && engineStatus.state === "ready" && !isActive(run)) { e.preventDefault(); void onRunClicked(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const engineInfo = engineStatus.state === "ready" ? `Engine ${engineStatus.version} · offline` : engineStatus.state === "starting" ? "Engine starting…" : "Engine unavailable";
  const selectNodeFromPanel = (id: string) => {
    dispatchHist({ type: "set", doc: { ...doc, nodes: doc.nodes.map((n) => ({ ...n, selected: n.id === id })) } });
    setSelected([id]);
  };
  useEffect(() => { document.title = `${doc.name}${dirty ? " •" : ""} — ${PRODUCT_NAME}`; }, [doc.name, dirty]);

  return (
    <OverlayContext.Provider value={{ run, issues, selectedId }}>
      <div className="app">
        <Toolbar name={doc.name} dirty={dirty} filePath={filePath} canUndo={hist.past.length > 0} canRedo={hist.future.length > 0} running={isActive(run)}
          engineReady={engineStatus.state === "ready"} settings={settings} engineInfo={engineInfo}
          onName={(n) => { if (editKey.current !== "name") { dispatchHist({ type: "checkpoint" }); editKey.current = "name"; } setDoc({ ...doc, name: n }); }}
          onNew={() => void onNew()} onOpen={() => void onOpen()} onSave={() => void save(false)} onSaveAs={() => void save(true)} onUndo={undo} onRedo={redo}
          onValidate={() => void validate(folders.length ? { allowedRoots: folders } : undefined)} onRun={() => void onRunClicked()} onStop={() => void onStop()}
          onSettings={(s) => { setSettings(s); saveSettings(s); }} onExample={() => void onExample()} />
        {engineStatus.state === "unavailable" && (
          <div className="banner banner--error" role="alert">The execution engine is not available: {engineStatus.message}
            <button className="btn" onClick={() => void startEngine()}>Retry</button></div>
        )}
        <div className="workspace">
          <NodeLibrary onAdd={(t) => onAddAt(t, canvas.current?.center() ?? { x: 80, y: 80 })} />
          <main className="center">
            <Canvas key={canvasKey} ref={canvas} doc={doc} showMiniMap={settings.showMiniMap} initialViewport={viewport0} onSet={setDoc} onCheckpoint={checkpoint}
              onAddAt={onAddAt} onDuplicate={onDuplicate} onSelect={(ids) => { setSelected(ids); }} onRejected={say} />
            <ExecutionPanel run={run} names={nodeTypes} selectedId={selectedId} collapsed={panel.collapsed} height={panel.height}
              onToggle={() => setPanel((p) => ({ ...p, collapsed: !p.collapsed }))} onResize={(h) => setPanel((p) => ({ ...p, height: h }))} onSelect={selectNodeFromPanel} />
          </main>
          <Inspector node={selectedNode} extraSelected={selected.length} issues={issues.filter((i) => i.nodeId === selectedId)} run={selectedId ? run.nodes[selectedId] : undefined}
            onChange={(id, f, v) => setDoc(updateConfig(doc, id, f, v))} onBeginEdit={onBeginEdit} onBrowse={() => files.pickDirectory()}
            onDuplicate={(id) => onDuplicate([id])} onDelete={(id) => { checkpoint(); setDoc(deleteNodes(doc, [id])); setSelected([]); }} />
        </div>
        {issues.length > 0 && !isActive(run) && (
          <div className="issues" role="region" aria-label="Validation problems">
            <strong>{issues.filter((i) => i.severity === "error").length} error(s), {issues.filter((i) => i.severity === "warning").length} warning(s)</strong>
            <ul>{issues.slice(0, 8).map((i, k) => <li key={k} className={`issue--${i.severity}`}>{i.nodeId ? `[${doc.nodes.find((n) => n.id === i.nodeId) ? getDef(nodeTypes[i.nodeId] ?? "")?.name : i.nodeId}] ` : ""}{i.message}</li>)}</ul>
            <button className="btn" onClick={() => setIssues([])}>Dismiss</button>
          </div>
        )}
        {toast && <div className="toast" role="status">{toast}</div>}
        {confirm && <ConfirmDialog spec={confirm.spec} onChoose={(c) => { confirm.resolve(c); setConfirm(null); }} />}
        {runPlan && <RunDialog plan={runPlan} onRun={(m) => void startRun(m)} onClose={() => setRunPlan(null)} />}
      </div>
    </OverlayContext.Provider>
  );
}
