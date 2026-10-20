import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { categoryColor, NODE_DEFS } from "../model/definitions";
import { nodeIcon } from "./icons";

export const DRAG_MIME = "application/x-flowforge-node";

export function NodeLibrary({ onAdd }: { onAdd: (type: string) => void }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const m = new Map<string, typeof NODE_DEFS>();
    for (const d of NODE_DEFS) {
      if (needle && !`${d.name} ${d.description} ${d.category}`.toLowerCase().includes(needle)) continue;
      m.set(d.category, [...(m.get(d.category) ?? []), d]);
    }
    return [...m.entries()];
  }, [q]);
  return (
    <aside className="library" aria-label="Node library">
      <div className="panel-title">Nodes</div>
      <label className="search"><Search size={14} /><input placeholder="Search nodes…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search nodes" /></label>
      <div className="library__list">
        {groups.length === 0 && <p className="empty">No nodes match “{q}”. Try “filter” or “move”.</p>}
        {groups.map(([cat, defs]) => (
          <section key={cat}>
            <h3 style={{ ["--accent" as string]: categoryColor(cat) }}>{cat}</h3>
            {defs.map((d) => {
              const Icon = nodeIcon(d.type);
              return (
                <div key={d.type} className="library__item" draggable role="button" tabIndex={0} title="Drag onto the canvas, or press Enter to add"
                     style={{ ["--accent" as string]: categoryColor(d.category) }}
                     onDragStart={(e) => { e.dataTransfer.setData(DRAG_MIME, d.type); e.dataTransfer.effectAllowed = "copy"; }}
                     onDoubleClick={() => onAdd(d.type)} onKeyDown={(e) => { if (e.key === "Enter") onAdd(d.type); }}>
                  <Icon size={15} />
                  <div><div className="library__name">{d.name}</div><div className="library__desc">{d.description}</div></div>
                </div>
              );
            })}
          </section>
        ))}
        <p className="hint">Drag nodes onto the canvas, or double-click to add one.</p>
      </div>
    </aside>
  );
}
