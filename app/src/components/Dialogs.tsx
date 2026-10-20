import { useState, type ReactNode } from "react";

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <h2>{title}</h2>{children}
      </div>
    </div>
  );
}

export interface ConfirmSpec { title: string; message: string; confirmLabel: string; discardLabel?: string }
export function ConfirmDialog({ spec, onChoose }: { spec: ConfirmSpec; onChoose: (c: "confirm" | "discard" | "cancel") => void }) {
  return (
    <Modal title={spec.title} onClose={() => onChoose("cancel")}>
      <p>{spec.message}</p>
      <div className="modal__actions">
        <button className="btn" onClick={() => onChoose("cancel")}>Cancel</button>
        {spec.discardLabel && <button className="btn btn--danger" onClick={() => onChoose("discard")}>{spec.discardLabel}</button>}
        <button className="btn btn--primary" autoFocus onClick={() => onChoose("confirm")}>{spec.confirmLabel}</button>
      </div>
    </Modal>
  );
}

export interface RunPlan { folders: string[]; applyNodeIds: string[] }
export function RunDialog({ plan, onRun, onClose }: { plan: RunPlan; onRun: (mode: "preview" | "apply") => void; onClose: () => void }) {
  const [ack, setAck] = useState(false);
  const canApply = plan.applyNodeIds.length > 0;
  return (
    <Modal title="Run workflow" onClose={onClose}>
      <p>This run may read and change files <strong>only inside</strong> these folders:</p>
      {plan.folders.length === 0 ? <p className="muted">No folders are used by this workflow.</p> : <ul className="folders">{plan.folders.map((f) => <li key={f}><code>{f}</code></li>)}</ul>}
      {canApply ? (
        <div className="warnbox">
          Move File is set to apply changes. <strong>Run a preview first</strong>: it lists every planned move and changes nothing.
          <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I reviewed the preview and want to move these files. Moves cannot be undone automatically.</label>
        </div>
      ) : <p className="muted">All file operations in this workflow are previews or read-only; nothing will be changed.</p>}
      <div className="modal__actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        {canApply && <button className="btn btn--danger" disabled={!ack} onClick={() => onRun("apply")}>Run and apply changes</button>}
        <button className="btn btn--primary" autoFocus onClick={() => onRun("preview")}>{canApply ? "Run preview (no changes)" : "Run"}</button>
      </div>
    </Modal>
  );
}
