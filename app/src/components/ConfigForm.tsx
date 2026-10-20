import { FolderOpen } from "lucide-react";
import type { ConfigFieldDef, Issue } from "../model/types";

interface Props {
  fields: ConfigFieldDef[]; config: Record<string, unknown>; issues: Issue[];
  onChange: (field: string, value: unknown) => void; onBeginEdit: (field: string) => void;
  onBrowse: (field: string) => Promise<string | null>;
}

export function ConfigForm({ fields, config, issues, onChange, onBeginEdit, onBrowse }: Props) {
  if (fields.length === 0) return <p className="empty">This node has no settings.</p>;
  return (
    <div className="form">
      {fields.map((f) => {
        const v = config[f.name];
        const problems = issues.filter((i) => i.field === f.name);
        const id = `cfg-${f.name}`;
        return (
          <div className="field" key={f.name}>
            {f.type === "boolean" ? (
              <label className="check"><input id={id} type="checkbox" checked={v === true} onFocus={() => onBeginEdit(f.name)} onChange={(e) => onChange(f.name, e.target.checked)} /> {f.label}</label>
            ) : (
              <label htmlFor={id}>{f.label}{f.required && <span className="req"> *</span>}</label>
            )}
            {(f.type === "string") && <input id={id} value={String(v ?? "")} onFocus={() => onBeginEdit(f.name)} onChange={(e) => onChange(f.name, e.target.value)} />}
            {f.type === "path" && (
              <div className="row">
                <input id={id} value={String(v ?? "")} placeholder="Choose a folder…" onFocus={() => onBeginEdit(f.name)} onChange={(e) => onChange(f.name, e.target.value)} />
                <button type="button" className="btn btn--icon" title="Browse…" aria-label={`Browse for ${f.label}`}
                        onClick={async () => { const p = await onBrowse(f.name); if (p) { onBeginEdit(f.name); onChange(f.name, p); } }}><FolderOpen size={14} /></button>
              </div>
            )}
            {(f.type === "number" || f.type === "integer") && (
              <input id={id} type="number" value={v === null || v === undefined ? "" : String(v)} min={f.minimum ?? undefined} max={f.maximum ?? undefined}
                     step={f.type === "integer" ? 1 : "any"} onFocus={() => onBeginEdit(f.name)}
                     onChange={(e) => onChange(f.name, e.target.value === "" ? null : Number(e.target.value))} />
            )}
            {f.type === "enum" && (
              <select id={id} value={String(v ?? "")} onFocus={() => onBeginEdit(f.name)} onChange={(e) => onChange(f.name, e.target.value)}>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            {f.type === "stringList" && (
              <textarea id={id} rows={3} placeholder={f.placeholder ? `${f.placeholder} (one per line)` : "One per line"} value={((v as string[]) ?? []).join("\n")}
                        onFocus={() => onBeginEdit(f.name)} onChange={(e) => onChange(f.name, e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))} />
            )}
            {f.description && <div className="field__help">{f.description}</div>}
            {problems.map((p, i) => <div key={i} className="field__error" role="alert">{p.message}</div>)}
          </div>
        );
      })}
    </div>
  );
}
