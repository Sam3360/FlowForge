import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Canvas, type CanvasHandle } from "./components/Canvas";
import { ConfirmDialog, RunDialog, type ConfirmSpec, type RunPlan } from "./components/Dialogs";
import { ExecutionPanel, type PanelTab } from "./components/ExecutionPanel";
import { Inspector } from "./components/Inspector";
import { NodeLibrary } from "./components/NodeLibrary";
import { OverlayContext } from "./components/RunContext";
import { Toolbar } from "./components/Toolbar";
import { PRODUCT_NAME } from "./config/product";
import { EngineClient, EngineRequestError } from "./engine/client";
import { getDef } from "./model/definitions";
import { addNode, deleteNodes, duplicateNodesWithIds, emptyDoc, getType, localIssues, parseWorkflowText, serialize, toWorkflowFile, updateConfig, type Doc, type Viewport } from "./model/editor";
import { historyReducer, initHistory } from "./model/history";
import { addRecord, recordFromRun, type RunNodeInfo, type RunRecord } from "./model/runHistory";
import { initialRun, isActive, isTerminal, runReducer } from "./model/runState";
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
  const [issues, setIssues] = useState<Issue[]>([]);
  const [run, dispatchRun] = useReducer(runReducer, undefined, initialRun);
  const [engineStatus, setEngineStatus] = useState<EngineStatus>({ state: "starting" });
  const [settings, setSettings] = useState(() => (typeof localStorage === "undefined" ? DEFAULT_SETTINGS : loadSettings()));
  const [toast, setToast] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null);
  const [records, setRecords] = useState<RunRecord[]>([]);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>("nodes");
  const [validating, setValidating] = useState(false);
  const runCounter = useRef(0);
  const recordedKey = useRef("");
  const [panel, setPanel] = useState({ collapsed: false, height: 240 });
  const [confirm, setConfirm] = useState<{ spec: ConfirmSpec; resolve: (c: "confirm" | "discard" | "cancel") => void } | null>(null);
  const [runPlan, setRunPlan] = useState<RunPlan | null>(null);
  const canvas = useRef<CanvasHandle>(null);
  const editKey = useRef<string>("");

  const dirty = useMemo(() => serialize(doc) !== savedText, [doc, savedText]);
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const selected = useMemo(() => doc.nodes.filter((n) => n.selected).map((n) => n.id), [doc.nodes]); // single source of truth: survives undo/redo
  const selectedId = selected.length === 1 ? (selected[0] ?? null) : null;
  const selectedNode = doc.nodes.find((n) => n.id === selectedId) ?? null;
    const say = useCallback((text: string, action?: { label: string; run: () => void }) => {
    const t = { text, ...(action ? { action } : {}) };
    setToast(t);
    window.setTimeout(() => setToast((cur) => (cur === t ? null : cur)), action ? 9000 : 5000);
  }, []);
  const showTab = useCallback((t: PanelTab) => { setPanelTab(t); setPanel((p) => ({ ...p, collapsed: false })); }, []);

  // what the panel/canvas display: the live run, or a finished run the user chose to inspect
  const viewing = records.find((r) => r.id === viewingId) ?? null;
  const nodeInfo = useMemo<Record<string, RunNodeInfo>>(() => Object.fromEntries(doc.nodes.map((n) => [n.id, { type: getType(n), name: getDef(getType(n))?.name ?? getType(n) }])), [doc.nodes]);
  const shownRun = viewing ? viewing.run : run;
  const shownInfo = viewing ? { ...nodeInfo, ...viewing.nodeInfo } : nodeInfo;

  useEffect(() => { // record each run exactly once, only when the engine has reported a final state
    if (!isTerminal(run.status)) return;
    const key = `${run.startedAtMs}:${run.runId ?? "local"}:${run.status}`;
    if (recordedKey.current === key) return;
    recordedKey.current = key;
    runCounter.current += 1;
    const rec = recordFromRun(run, nodeInfo, doc.name, runCounter.current);
    if (rec) setRecords((l) => addRecord(l, rec));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.status, run.runId, run.startedAtMs]);

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
    setFilePath(path); setSavedText(serialize(r.doc)); setIssues([]); setViewingId(null); dispatchRun({ type: "reset" });
    if (r.warnings.length) say(`Opened with ${r.warnings.length} adjustment(s): ${r.warnings[0]}${r.warnings.length > 1 ? ` (+${r.warnings.length - 1} more)` : ""}`);
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
  const onDuplicate = useCallback((ids: string[]) => {
    const r = duplicateNodesWithIds(doc, ids);
    if (r.newIds.length === 0) { say("There is nothing to duplicate (a workflow can only have one Start node)."); return; }
    checkpoint(); setDoc(r.doc);
  }, [doc, checkpoint, setDoc, say]);
  const onBeginEdit = useCallback((field: string) => {
    const k = `${selectedId}:${field}`;
    if (editKey.current !== k) { dispatchHist({ type: "checkpoint" }); editKey.current = k; }
  }, [selectedId]);
  const undo = useCallback(() => { editKey.current = ""; dispatchHist({ type: "undo" }); }, []);
  const redo = () => { editKey.current = ""; dispatchHist({ type: "redo" }); };

  // ---- validation & running ----
  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const n of doc.nodes) for (const f of getDef(getType(n))?.config ?? []) {
      const v = n.data.config[f.name];
      if (f.type === "path" && typeof v === "string" && v) set.add(v);
    }
    return [...set];
  }, [doc.nodes]);

  /** The engine is the authority; the local check is only used when the engine is unavailable. */
  const validate = useCallback(async (announce: boolean): Promise<Issue[] | null> => {
    setValidating(true);
    try {
      let list: Issue[];
      if (engine?.isRunning) {
        const r = await engine.request("validate", { workflow: toWorkflowFile(doc), options: { allowedRoots: folders, dryRun: true } });
        list = r["issues"] as Issue[];
      } else {
        list = localIssues(doc);
        say("The execution engine is not available, so only basic checks were made.");
      }
      setIssues(list);
      const errs = list.filter((i) => i.severity === "error").length, warns = list.length - errs;
      if (errs || (announce && warns)) showTab("problems");
      if (errs) { say(`${errs} problem(s) must be fixed before running.`); return null; }
      if (announce) say(warns ? `Valid, with ${warns} warning(s).` : "Workflow is valid.");
      return list;
    } catch (e) {
      say(e instanceof EngineRequestError && e.hint ? `${e.message} ${e.hint}` : e instanceof Error ? e.message : String(e));
      return null;
    } finally { setValidating(false); }
  }, [doc, engine, folders, say, showTab]);

  const applyNodeIds = useMemo(() => doc.nodes.filter((n) => getDef(getType(n))?.requiresConfirmation && n.data.config["dryRun"] === false).map((n) => n.id), [doc.nodes]);

  const onRunClicked = async () => {
    const list = await validate(false); // blocking errors stop here; warnings do not
    if (!list) return;
    setRunPlan({ folders, applyNodeIds, warnings: list.filter((i) => i.severity === "warning").length });
  };
  const startRun = async (mode: "preview" | "apply") => {
    setRunPlan(null);
    if (!engine?.isRunning) { say("The execution engine is not running."); return; }
    const options = { allowedRoots: folders, dryRun: mode === "preview", approvedNodes: mode === "apply" ? applyNodeIds : [] };
    setViewingId(null);
    dispatchRun({ type: "begin", mode });
    showTab("nodes");
    try {
      const r = await engine.request("run", { workflow: toWorkflowFile(doc), options });
      setIssues((r["warnings"] as Issue[]) ?? []);
    } catch (e) {
      dispatchRun({ type: "reset" }); // the engine refused the run: nothing started, so nothing to show or record
      if (e instanceof EngineRequestError && e.code === "VALIDATION_FAILED") { setIssues((e.details["issues"] as Issue[]) ?? []); showTab("problems"); }
      say(e instanceof EngineRequestError && e.hint ? `${e.message} ${e.hint}` : e instanceof Error ? e.message : String(e));
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

  const goToNode = useCallback((id: string) => {
    if (!doc.nodes.some((n) => n.id === id)) { say("That node is no longer in the workflow."); return; }
    dispatchHist({ type: "set", doc: { ...doc, nodes: doc.nodes.map((n) => ({ ...n, selected: n.id === id })) } });
    canvas.current?.focus(id);
  }, [doc, say]);
  const announceDeleted = useCallback((n: number) => say(`Deleted ${n} node${n === 1 ? "" : "s"} and their connections.`, { label: "Undo", run: undo }), [say, undo]);
  const deleteIds = async (ids: string[]) => {
    if (ids.length === 0) return;
    if (ids.length >= 5) {
      const c = await ask({ title: "Delete nodes?", message: `Delete ${ids.length} nodes and all their connections? You can undo this with Ctrl+Z.`, confirmLabel: "Delete" });
      if (c !== "confirm") return;
    }
    checkpoint(); setDoc(deleteNodes(doc, ids)); announceDeleted(ids.length);
  };

  const engineInfo = engineStatus.state === "ready" ? `Engine ${engineStatus.version} · offline` : engineStatus.state === "starting" ? "Engine starting…" : "Engine unavailable";
  useEffect(() => { document.title = `${doc.name}${dirty ? " •" : ""} — ${PRODUCT_NAME}`; }, [doc.name, dirty]);

  return (
    <OverlayContext.Provider value={{ run: shownRun, issues, selectedId }}>
      <div className="app">
        <Toolbar name={doc.name} dirty={dirty} filePath={filePath} canUndo={hist.past.length > 0} canRedo={hist.future.length > 0} running={isActive(run)}
          engineReady={engineStatus.state === "ready"} settings={settings} engineInfo={engineInfo}
          onName={(n) => { if (editKey.current !== "name") { dispatchHist({ type: "checkpoint" }); editKey.current = "name"; } setDoc({ ...doc, name: n }); }}
          onNew={() => void onNew()} onOpen={() => void onOpen()} onSave={() => void save(false)} onSaveAs={() => void save(true)} onUndo={undo} onRedo={redo}
          onValidate={() => void validate(true)} onRun={() => void onRunClicked()} onStop={() => void onStop()}
          onSettings={(s) => { setSettings(s); saveSettings(s); }} onExample={() => void onExample()} />
        {engineStatus.state === "unavailable" && (
          <div className="banner banner--error" role="alert">The execution engine is not available: {engineStatus.message}
            <button className="btn" onClick={() => void startEngine()}>Retry</button></div>
        )}
        <div className="workspace">
          <NodeLibrary onAdd={(t) => onAddAt(t, canvas.current?.center() ?? { x: 80, y: 80 })} />
          <main className="center">
            <Canvas key={canvasKey} ref={canvas} doc={doc} showMiniMap={settings.showMiniMap} initialViewport={viewport0} onSet={setDoc} onCheckpoint={checkpoint}
              onAddAt={onAddAt} onDuplicate={onDuplicate} onSelect={() => undefined} onRejected={(m) => say(m)}
              onDeleted={announceDeleted} onExample={() => void onExample()} onAddStart={() => onAddAt("start", { x: 80, y: 160 })} />
            <ExecutionPanel run={shownRun} live={run} nodeInfo={shownInfo} selectedId={selectedId} collapsed={panel.collapsed} height={panel.height} tab={panelTab}
              validating={validating} issues={issues} records={records} viewing={viewing} onTab={setPanelTab}
              onToggle={() => setPanel((p) => ({ ...p, collapsed: !p.collapsed }))} onResize={(h) => setPanel((p) => ({ ...p, height: h }))} onSelect={goToNode}
              onGoToIssue={(i) => { if (i.nodeId) goToNode(i.nodeId); }} onClearIssues={() => setIssues([])}
              onView={(id) => { setViewingId(id); if (id) showTab("nodes"); }} />
          </main>
          <Inspector node={selectedNode} extraSelected={selected.length} issues={issues.filter((i) => i.nodeId === selectedId)} run={selectedId ? shownRun.nodes[selectedId] : undefined}
            onDuplicateSelected={() => onDuplicate(selected)} onDeleteSelected={() => void deleteIds(selected)}
            onChange={(id, f, v) => setDoc(updateConfig(doc, id, f, v))} onBeginEdit={onBeginEdit} onBrowse={() => files.pickDirectory()}
            onDuplicate={(id) => onDuplicate([id])} onDelete={(id) => void deleteIds([id])} />
        </div>
        {toast && <div className="toast" role="status">{toast.text}{toast.action && <button className="btn" onClick={() => { toast.action!.run(); setToast(null); }}>{toast.action.label}</button>}</div>}
        {viewing && <div className="viewbanner" role="status">Viewing the results of past run #{viewing.number} ({viewing.status}). The canvas shows that run, not the current state. <button className="btn" onClick={() => setViewingId(null)}>Back to live</button></div>}
        {confirm && <ConfirmDialog spec={confirm.spec} onChoose={(c) => { confirm.resolve(c); setConfirm(null); }} />}
        {runPlan && <RunDialog plan={runPlan} onRun={(m) => void startRun(m)} onClose={() => setRunPlan(null)} />}
      </div>
    </OverlayContext.Provider>
  );
}
