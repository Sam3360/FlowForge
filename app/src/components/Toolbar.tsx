import { CheckCircle2, FilePlus, FolderOpen, Play, Redo2, Save, SaveAll, Settings, Square, Undo2 } from "lucide-react";
import { useState } from "react";
import { PRODUCT_NAME } from "../config/product";
import type { Settings as AppSettings } from "../services/settings";

interface Props {
  name: string; dirty: boolean; filePath: string | null; canUndo: boolean; canRedo: boolean; running: boolean; engineReady: boolean;
  settings: AppSettings; engineInfo: string;
  onName: (n: string) => void; onNew: () => void; onOpen: () => void; onSave: () => void; onSaveAs: () => void;
  onUndo: () => void; onRedo: () => void; onValidate: () => void; onRun: () => void; onStop: () => void;
  onSettings: (s: AppSettings) => void; onExample: () => void;
}

export function Toolbar(p: Props) {
  const [menu, setMenu] = useState(false);
  return (
    <header className="toolbar">
      <div className="brand">{PRODUCT_NAME}</div>
      <input className="wfname" value={p.name} aria-label="Workflow name" onFocus={(e) => e.currentTarget.select()} onChange={(e) => p.onName(e.target.value)} />
      <span className={`dirty ${p.dirty ? "is-dirty" : ""}`} data-testid="dirty-indicator" title={p.filePath ?? "Not saved yet"}>{p.dirty ? "● Unsaved changes" : p.filePath ? "Saved" : "New"}</span>
      <div className="sep" />
      <button className="btn" onClick={p.onNew} title="New (Ctrl+N)"><FilePlus size={15} /> New</button>
      <button className="btn" onClick={p.onOpen} title="Open (Ctrl+O)"><FolderOpen size={15} /> Open</button>
      <button className="btn" onClick={p.onSave} title="Save (Ctrl+S)"><Save size={15} /> Save</button>
      <button className="btn" onClick={p.onSaveAs} title="Save As (Ctrl+Shift+S)"><SaveAll size={15} /> Save As</button>
      <div className="sep" />
      <button className="btn btn--icon" onClick={p.onUndo} disabled={!p.canUndo} aria-label="Undo" title="Undo (Ctrl+Z)"><Undo2 size={15} /></button>
      <button className="btn btn--icon" onClick={p.onRedo} disabled={!p.canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><Redo2 size={15} /></button>
      <div className="spacer" />
      <button className="btn" onClick={p.onValidate}><CheckCircle2 size={15} /> Validate</button>
      {p.running
        ? <button className="btn btn--danger" onClick={p.onStop}><Square size={14} /> Stop</button>
        : <button className="btn btn--primary" onClick={p.onRun} disabled={!p.engineReady} title={p.engineReady ? "Run (F5)" : "The execution engine is not available"}><Play size={14} /> Run</button>}
      <div className="menuwrap">
        <button className="btn btn--icon" aria-label="Settings" aria-expanded={menu} onClick={() => setMenu(!menu)}><Settings size={15} /></button>
        {menu && (
          <div className="menu" role="menu">
            <label className="menu__item"><input type="checkbox" checked={p.settings.showMiniMap} onChange={(e) => p.onSettings({ ...p.settings, showMiniMap: e.target.checked })} /> Show mini-map</label>
            <label className="menu__item"><input type="checkbox" checked={p.settings.autosaveRecovery} onChange={(e) => p.onSettings({ ...p.settings, autosaveRecovery: e.target.checked })} /> Keep recovery copy</label>
            <button className="menu__item" onClick={() => { setMenu(false); p.onExample(); }}>Open “Organize Downloads” example</button>
            <div className="menu__info">{p.engineInfo}</div>
          </div>
        )}
      </div>
    </header>
  );
}
