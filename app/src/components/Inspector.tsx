import { Copy, Trash2 } from "lucide-react";
import { useState } from "react";
import { getDef } from "../model/definitions";
import { hintFor } from "../model/hints";
import { getType, type ForgeNode } from "../model/editor";
import type { NodeRun, Preview } from "../model/runState";
import type { Issue } from "../model/types";
import { ConfigForm } from "./ConfigForm";

interface Props {
  node: ForgeNode | null; issues: Issue[]; run: NodeRun | undefined;
  onChange: (id: string, field: string, value: unknown) => void; onBeginEdit: (field: string) => void;
  onBrowse: (field: string) => Promise<string | null>; onDuplicate: (id: string) => void; onDelete: (id: string) => void;
  extraSelected?: number; onDuplicateSelected?: () => void; onDeleteSelected?: () => void;
}

export function Inspector({ node, issues, run, onChange, onBeginEdit, onBrowse, onDuplicate, onDelete, extraSelected = 0, onDuplicateSelected, onDeleteSelected }: Props) {
  const [tab, setTab] = useState<"config" | "exec">("config");
  if (!node) return (
    <aside className="inspector" aria-label="Inspector"><div className="panel-title">Inspector</div>
      {extraSelected > 1 ? (
        <div data-testid="multi-select"><p className="empty">{extraSelected} nodes selected.</p>
          <div className="row"><button className="btn" onClick={onDuplicateSelected}><Copy size={14} /> Duplicate</button>
            <button className="btn btn--danger" onClick={onDeleteSelected}><Trash2 size={14} /> Delete</button></div>
          <p className="field__help">Connections between duplicated nodes are copied; connections to other nodes are not. Delete can be undone with Ctrl+Z.</p></div>
      ) : <p className="empty">Select a node to edit its settings. After a run, the Execution tab shows what it received and produced.</p>}
    </aside>
  );
  const def = getDef(getType(node));
  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="panel-title">{def?.name ?? "Unknown node"}
        <span className="actions">
          {getType(node) !== "start" && <button className="btn btn--icon" title="Duplicate" aria-label="Duplicate node" onClick={() => onDuplicate(node.id)}><Copy size={14} /></button>}
          <button className="btn btn--icon" title="Delete" aria-label="Delete node" onClick={() => onDelete(node.id)}><Trash2 size={14} /></button>
        </span>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "config"} onClick={() => setTab("config")}>Configuration</button>
        <button role="tab" aria-selected={tab === "exec"} onClick={() => setTab("exec")}>Execution{run ? ` · ${run.status}` : ""}</button>
      </div>
      {tab === "config" ? (
        <>
          <p className="muted">{def?.description}</p>
          {issues.filter((i) => !i.field).map((i, k) => <div key={k} className={i.severity === "error" ? "field__error" : "field__warn"} role="alert">{i.message}{hintFor(i) ? <span className="muted"> {hintFor(i)}</span> : null}</div>)}
          {def && <ConfigForm fields={def.config} config={node.data.config} issues={issues} onChange={(f, v) => onChange(node.id, f, v)} onBeginEdit={onBeginEdit} onBrowse={onBrowse} />}
        </>
      ) : <ExecutionView run={run} />}
    </aside>
  );
}

function Json({ title, p }: { title: string; p: Preview }) {
  return (
    <details open>
      <summary>{title}{p.totalItems !== null ? ` · ${p.totalItems} item(s)` : ""}{p.truncated ? " · truncated for display" : ""}</summary>
      <pre className="json">{JSON.stringify(p.preview, null, 2)}</pre>
    </details>
  );
}

export function ExecutionView({ run }: { run: NodeRun | undefined }) {
  if (!run) return <p className="empty">This node has not been part of a run yet. Press Run to execute the workflow.</p>;
  return (
    <div className="exec" data-testid="exec-view">
      <dl className="kv">
        <dt>Status</dt><dd className={`status status--${run.status}`}>{run.status}</dd>
        {run.durationMs !== undefined && (<><dt>Duration</dt><dd>{run.durationMs} ms</dd></>)}
        {typeof run.summary?.["branch"] === "string" && (<><dt>Branch taken</dt><dd>{String(run.summary["branch"])}</dd></>)}
        {run.reason && (<><dt>Skipped because</dt><dd>{run.reason}</dd></>)}
      </dl>
      {run.error && (
        <div className="errorbox" role="alert"><strong>{run.error.code}</strong><div>{run.error.message}</div>
          {run.error.hint && <div className="hint-line"><b>What to check:</b> {run.error.hint}</div>}
          <details><summary>Details</summary><pre className="json">{JSON.stringify(run.error.details, null, 2)}</pre></details></div>
      )}
      {run.message && <div className="warnbox">{run.message}</div>}
      {run.summary && <details open><summary>Summary</summary><pre className="json">{JSON.stringify(run.summary, null, 2)}</pre></details>}
      {run.inputs && Object.entries(run.inputs).map(([k, p]) => <Json key={`i${k}`} title={`Input · ${k}`} p={p} />)}
      {run.outputs && Object.entries(run.outputs).map(([k, p]) => <Json key={`o${k}`} title={`Output · ${k}`} p={p} />)}
      {run.partial !== undefined && <details><summary>Partial result at cancellation</summary><pre className="json">{JSON.stringify(run.partial, null, 2)}</pre></details>}
    </div>
  );
}
