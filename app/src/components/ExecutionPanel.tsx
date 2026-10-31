import { AlertTriangle, ChevronDown, ChevronUp, Info, Loader2, Undo2 } from "lucide-react";
import { useRef } from "react";
import { hintFor } from "../model/hints";
import type { RunRecord, RunNodeInfo } from "../model/runHistory";
import { failedNodeId, type RunState } from "../model/runState";
import type { Issue } from "../model/types";

export type PanelTab = "nodes" | "logs" | "problems" | "history";
const TABS: PanelTab[] = ["nodes", "logs", "problems", "history"];

interface Props {
  run: RunState; live: RunState; nodeInfo: Record<string, RunNodeInfo>; selectedId: string | null;
  collapsed: boolean; height: number; tab: PanelTab; validating: boolean;
  issues: Issue[]; records: RunRecord[]; viewing: RunRecord | null;
  onTab: (t: PanelTab) => void; onToggle: () => void; onSelect: (id: string) => void; onResize: (h: number) => void;
  onGoToIssue: (i: Issue) => void; onClearIssues: () => void; onView: (id: string | null) => void;
}

const fmtMs = (ms: number | null | undefined): string => (ms === null || ms === undefined ? "—" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`);
const fmtTime = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString(); };
const nameOf = (info: Record<string, RunNodeInfo>, id: string): string => info[id]?.name ?? id;

export function ExecutionPanel(p: Props) {
  const { run, live, nodeInfo, issues, records, viewing } = p;
  const errors = issues.filter((i) => i.severity === "error").length, warnings = issues.length - errors;
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const startDrag = (e: React.MouseEvent) => {
    const y0 = e.clientY, h0 = p.height;
    const move = (m: MouseEvent) => p.onResize(Math.max(120, Math.min(600, h0 + (y0 - m.clientY))));
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  const onTabKey = (e: React.KeyboardEvent) => {
    const i = TABS.indexOf(p.tab);
    const next = e.key === "ArrowRight" ? TABS[(i + 1) % TABS.length] : e.key === "ArrowLeft" ? TABS[(i + TABS.length - 1) % TABS.length] : null;
    if (next) { e.preventDefault(); p.onTab(next); tabRefs.current[next]?.focus(); }
  };
  const label: Record<PanelTab, string> = { nodes: "Nodes", logs: `Logs (${run.logs.length})`, problems: `Problems${issues.length ? ` (${errors}E ${warnings}W)` : ""}`, history: `History (${records.length})` };

  return (
    <section className="execpanel" style={{ height: p.collapsed ? 34 : p.height }} aria-label="Execution panel">
      {!p.collapsed && <div className="execpanel__resize" onMouseDown={startDrag} role="separator" aria-label="Resize execution panel" />}
      <div className="execpanel__bar">
        <button className="btn btn--icon" onClick={p.onToggle} aria-label={p.collapsed ? "Expand execution panel" : "Collapse execution panel"}>{p.collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
        <strong>Execution</strong>
        <span className={`pill pill--${live.status}`} data-testid="run-status" title="Status of the current (live) run">{live.status === "idle" ? "no run yet" : live.status}</span>
        {p.validating && <span className="muted"><Loader2 size={12} className="spin" /> Validating…</span>}
        {live.mode && !viewing && <span className="muted">{live.mode === "preview" ? "preview: nothing is changed" : "applying changes"}</span>}
        {viewing && <span className="chip" data-testid="viewing-chip">Viewing run #{viewing.number} · {fmtTime(viewing.startedAt)}
          <button className="btn" onClick={() => p.onView(null)}><Undo2 size={12} /> Back to live</button></span>}
        <div className="tabs tabs--inline" role="tablist" aria-label="Execution views" onKeyDown={onTabKey}>
          {TABS.map((t) => (
            <button key={t} role="tab" id={`tab-${t}`} ref={(el) => { tabRefs.current[t] = el; }} aria-selected={p.tab === t} tabIndex={p.tab === t ? 0 : -1}
                    aria-controls="execpanel-body" className={t === "problems" && errors ? "has-errors" : ""} onClick={() => p.onTab(t)}>{label[t]}</button>
          ))}
        </div>
      </div>
      {!p.collapsed && (
        <div className="execpanel__body" id="execpanel-body" role="tabpanel" aria-labelledby={`tab-${p.tab}`}>
          {p.tab === "nodes" && <NodesView {...p} />}
          {p.tab === "logs" && (run.logs.length === 0 ? <p className="empty">No log messages{viewing ? " were recorded for this run" : " yet"}.</p> : (
            <div className="logs" role="log">{run.logs.map((l, i) => (
              <div key={i} className={`log log--${l.level}`}><span className="muted">{l.ts.slice(11, 23)}</span> <span>{l.nodeId ? nameOf(nodeInfo, l.nodeId) : "run"}</span> {l.message}</div>
            ))}</div>
          ))}
          {p.tab === "problems" && <ProblemsView issues={issues} nodeInfo={nodeInfo} onGo={p.onGoToIssue} onClear={p.onClearIssues} />}
          {p.tab === "history" && <HistoryView records={records} viewingId={viewing?.id ?? null} onView={p.onView} />}
        </div>
      )}
    </section>
  );
}

function FailureSummary({ run, nodeInfo, onSelect }: Pick<Props, "run" | "nodeInfo" | "onSelect">) {
  const id = failedNodeId(run);
  const err = id ? run.nodes[id]?.error : undefined;
  if (run.status === "failed" && (err || run.engineError)) {
    const msg = err?.message ?? run.engineError ?? "";
    const hint = err?.hint ?? (run.engineError ? "Press Retry in the banner to restart the engine, then run again." : null);
    return (
      <div className="errorbox" role="alert" data-testid="failure-summary">
        <strong>{id ? `Failed at “${nameOf(nodeInfo, id)}”` : "Run failed"}</strong>{err ? <span className="muted"> · {err.code}</span> : null}
        <div>{msg}</div>
        {hint && <div className="hint-line"><b>What to check:</b> {hint}</div>}
        {id && <button className="btn" onClick={() => onSelect(id)}>Go to node</button>}
      </div>
    );
  }
  if (run.status === "cancelled") {
    const cid = run.order.find((n) => run.nodes[n]?.status === "cancelled");
    return <div className="warnbox" data-testid="cancel-summary">Run cancelled{cid ? ` while “${nameOf(nodeInfo, cid)}” was running` : ""}. Work already finished is <b>not undone</b>; check the node results for what completed.</div>;
  }
  return null;
}

function NodesView(p: Props) {
  const { run, nodeInfo } = p;
  return (
    <>
      {run.engineError && run.status !== "failed" && <div className="errorbox" role="alert">{run.engineError}</div>}
      <FailureSummary run={run} nodeInfo={nodeInfo} onSelect={p.onSelect} />
      {run.order.length === 0 ? (
        <p className="empty">{run.status === "starting" ? "Starting the run…" : "Run the workflow to see per-node status, timing and data here."}</p>
      ) : (
        <table className="nodes-table"><thead><tr><th>Node</th><th>Status</th><th>Time</th><th>Detail</th></tr></thead><tbody>
          {run.order.map((id) => {
            const r = run.nodes[id];
            return (
              <tr key={id} className={p.selectedId === id ? "is-selected" : ""} onClick={() => p.onSelect(id)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") p.onSelect(id); }}>
                <td>{nameOf(nodeInfo, id)} <span className="muted">{id}</span></td>
                <td><span className={`status status--${r?.status}`}>{r?.status}</span></td>
                <td>{fmtMs(r?.durationMs)}</td>
                <td className="detail">{r?.error?.message ?? r?.reason ?? (typeof r?.summary?.["branch"] === "string" ? `branch: ${String(r.summary["branch"])}` : "")}</td>
              </tr>
            );
          })}
        </tbody></table>
      )}
    </>
  );
}

function ProblemsView({ issues, nodeInfo, onGo, onClear }: { issues: Issue[]; nodeInfo: Record<string, RunNodeInfo>; onGo: (i: Issue) => void; onClear: () => void }) {
  if (issues.length === 0) return <p className="empty">No problems. Press Validate to check the workflow before running it.</p>;
  const sorted = [...issues].sort((a, b) => Number(a.severity === "warning") - Number(b.severity === "warning"));
  return (
    <div data-testid="problems">
      <div className="problems__bar"><span className="muted">Errors block the run. Warnings are worth a look but do not.</span><button className="btn" onClick={onClear}>Dismiss</button></div>
      <ul className="problems" aria-label="Validation problems">
        {sorted.map((i, k) => (
          <li key={k}>
            <button className={`problem problem--${i.severity}`} onClick={() => onGo(i)} disabled={!i.nodeId} title={i.nodeId ? "Go to node" : undefined}>
              {i.severity === "error" ? <AlertTriangle size={14} /> : <Info size={14} />}
              <span className="problem__main">
                <span><b>{i.severity === "error" ? "Error" : "Warning"}</b>{i.nodeId ? ` · ${nameOf(nodeInfo, i.nodeId)}` : ""}{i.field ? ` · ${i.field}` : ""}</span>
                <span>{i.message}</span>
                {hintFor(i) && <span className="muted">{hintFor(i)}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HistoryView({ records, viewingId, onView }: { records: RunRecord[]; viewingId: string | null; onView: (id: string | null) => void }) {
  if (records.length === 0) return <p className="empty">Finished runs from this session appear here, newest first. History is kept in memory only and is cleared when FlowForge closes.</p>;
  return (
    <table className="nodes-table" aria-label="Run history"><thead><tr><th>#</th><th>Result</th><th>Started</th><th>Duration</th><th>Detail</th></tr></thead><tbody>
      {records.map((r) => (
        <tr key={r.id} className={viewingId === r.id ? "is-selected" : ""} tabIndex={0} onClick={() => onView(r.id)} onKeyDown={(e) => { if (e.key === "Enter") onView(r.id); }} data-testid={`history-${r.number}`}>
          <td>{r.number}</td>
          <td><span className={`status status--${r.status === "success" ? "completed" : r.status}`}>{r.status === "success" ? "completed" : r.status}</span> <span className="muted">{r.mode === "apply" ? "apply" : "preview"}</span></td>
          <td>{fmtTime(r.startedAt)}</td><td>{fmtMs(r.durationMs)}</td>
          <td className="detail">{r.status === "failed" ? `${r.failedNodeName ? `${r.failedNodeName}: ` : ""}${r.error?.message ?? "failed"}` : r.status === "cancelled" ? (r.interruptedNodeId ? `stopped during ${nameOf(r.nodeInfo, r.interruptedNodeId)}` : "stopped before finishing") : r.workflowName}</td>
        </tr>
      ))}
    </tbody></table>
  );
}
