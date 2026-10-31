import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Check, Clock, Loader2, SkipForward, X } from "lucide-react";
import { categoryColor, getDef } from "../model/definitions";
import type { ForgeNode } from "../model/editor";
import { nodeIcon } from "./icons";
import { useOverlay } from "./RunContext";

const fmtMs = (ms?: number): string => (ms === undefined ? "" : ms < 1000 ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(2)} s`);

export function FlowNode({ id, data, selected }: NodeProps<ForgeNode>) {
  const def = getDef(data.nodeType);
  const { run, issues } = useOverlay();
  if (!def) return <div className="node node--unknown">Unknown node: {data.nodeType}</div>;
  const rs = run.nodes[id];
  const nodeIssues = issues.filter((i) => i.nodeId === id && i.severity === "error");
  const nodeWarnings = issues.filter((i) => i.nodeId === id && i.severity === "warning");
  const Icon = nodeIcon(def.type);
  const taken = rs?.activePorts;
  return (
    <div className={`node ${selected ? "is-selected" : ""} ${nodeIssues.length ? "has-issue" : nodeWarnings.length ? "has-warning" : ""}`} data-status={rs?.status ?? "idle"}
         style={{ ["--accent" as string]: categoryColor(def.category) }} data-testid={`node-${id}`}>
      <div className="node__header">
        <Icon size={14} /> <span className="node__title">{def.name}</span>
        <span className="node__status" title={rs?.status}>
          {rs?.status === "running" && <Loader2 size={13} className="spin" />}
          {rs?.status === "completed" && <Check size={13} />}
          {rs?.status === "failed" && <X size={13} />}
          {rs?.status === "skipped" && <SkipForward size={13} />}
          {rs?.status === "pending" && <Clock size={13} />}
          {rs?.status === "cancelled" && <X size={13} />}
        </span>
      </div>
      <div className="node__body">
        {def.inputs.map((p) => (
          <div className="port port--in" key={p.name}>
            <Handle type="target" position={Position.Left} id={p.name} className={`handle handle--${p.type}`} />
            <span>{p.label}</span>
          </div>
        ))}
        {def.outputs.map((p) => (
          <div className={`port port--out ${taken && !taken.includes(p.name) ? "is-inactive" : ""} ${taken?.includes(p.name) && def.outputs.length > 1 ? "is-taken" : ""}`} key={p.name}>
            <span>{p.label}</span>
            <Handle type="source" position={Position.Right} id={p.name} className={`handle handle--${p.type}`} />
          </div>
        ))}
      </div>
      <div className="node__footer">
        {nodeIssues.length > 0 && <span className="node__issue" title={nodeIssues.map((i) => i.message).join("\n")}><AlertTriangle size={12} /> {nodeIssues.length}</span>}
        {nodeWarnings.length > 0 && <span className="node__warn" title={nodeWarnings.map((i) => i.message).join("\n")}><AlertTriangle size={12} /> {nodeWarnings.length}</span>}
        {def.sideEffects && <span className="node__tag">{data.config["dryRun"] === false ? "changes files" : "preview"}</span>}
        <span className="node__time">{fmtMs(rs?.durationMs)}</span>
      </div>
    </div>
  );
}
