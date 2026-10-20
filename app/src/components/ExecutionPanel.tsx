import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { getDef } from "../model/definitions";
import type { RunState } from "../model/runState";

interface Props {
  run: RunState; names: Record<string, string>; selectedId: string | null; collapsed: boolean; height: number;
  onToggle: () => void; onSelect: (id: string) => void; onResize: (h: number) => void;
}

export function ExecutionPanel({ run, names, selectedId, collapsed, height, onToggle, onSelect, onResize }: Props) {
  const [tab, setTab] = useState<"nodes" | "logs">("nodes");
  const total = run.summary?.["durationMs"] as number | undefined;
  const startDrag = (e: React.MouseEvent) => {
    const y0 = e.clientY, h0 = height;
    const move = (m: MouseEvent) => onResize(Math.max(120, Math.min(600, h0 + (y0 - m.clientY))));
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  return (
    <section className="execpanel" style={{ height: collapsed ? 34 : height }} aria-label="Execution panel">
      {!collapsed && <div className="execpanel__resize" onMouseDown={startDrag} role="separator" aria-label="Resize execution panel" />}
      <div className="execpanel__bar">
        <button className="btn btn--icon" onClick={onToggle} aria-label={collapsed ? "Expand execution panel" : "Collapse execution panel"}>{collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
        <strong>Execution</strong>
        <span className={`pill pill--${run.status}`} data-testid="run-status">{run.status === "idle" ? "no run yet" : run.status}</span>
        {run.mode && <span className="muted">{run.mode === "preview" ? "preview: nothing is changed" : "applying changes"}</span>}
        {total !== undefined && <span className="muted">{total} ms</span>}
        <div className="tabs tabs--inline" role="tablist">
          <button role="tab" aria-selected={tab === "nodes"} onClick={() => setTab("nodes")}>Nodes</button>
          <button role="tab" aria-selected={tab === "logs"} onClick={() => setTab("logs")}>Logs ({run.logs.length})</button>
        </div>
      </div>
      {!collapsed && (
        <div className="execpanel__body">
          {run.engineError && <div className="errorbox" role="alert">{run.engineError}</div>}
          {run.status === "cancelled" && <div className="warnbox">Run cancelled. Work already finished is not undone; check the node results.</div>}
          {tab === "nodes" && (run.order.length === 0 ? <p className="empty">Run the workflow to see per-node status, timing and data here.</p> : (
            <table className="nodes-table"><thead><tr><th>Node</th><th>Status</th><th>Time</th><th>Detail</th></tr></thead><tbody>
              {run.order.map((id) => {
                const r = run.nodes[id]; const def = getDef(names[id] ?? "");
                return (
                  <tr key={id} className={selectedId === id ? "is-selected" : ""} onClick={() => onSelect(id)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") onSelect(id); }}>
                    <td>{def?.name ?? id} <span className="muted">{id}</span></td>
                    <td><span className={`status status--${r?.status}`}>{r?.status}</span></td>
                    <td>{r?.durationMs !== undefined ? `${r.durationMs} ms` : ""}</td>
                    <td className="detail">{r?.error?.message ?? r?.reason ?? (typeof r?.summary?.["branch"] === "string" ? `branch: ${String(r.summary["branch"])}` : "")}</td>
                  </tr>
                );
              })}
            </tbody></table>
          ))}
          {tab === "logs" && (run.logs.length === 0 ? <p className="empty">No log messages.</p> : (
            <div className="logs" role="log">{run.logs.map((l, i) => (
              <div key={i} className={`log log--${l.level}`}><span className="muted">{l.ts.slice(11, 23)}</span> <span>{l.nodeId ?? "run"}</span> {l.message}</div>
            ))}</div>
          ))}
        </div>
      )}
    </section>
  );
}
