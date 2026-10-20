import {
  Background, BackgroundVariant, ConnectionLineType, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, applyEdgeChanges, applyNodeChanges,
  useReactFlow, type EdgeChange, type NodeChange, type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Copy, Maximize, Trash2 } from "lucide-react";
import { forwardRef, useCallback, useImperativeHandle, useMemo, useState } from "react";
import { categoryColor, getDef, NODE_DEFS } from "../model/definitions";
import { connect, connectionProblem, deleteEdges, deleteNodes, getType, type Doc, type ForgeNode } from "../model/editor";
import { FlowNode } from "./FlowNode";
import { DRAG_MIME } from "./NodeLibrary";
import { useOverlay } from "./RunContext";

export interface CanvasHandle { getViewport(): Viewport; fit(): void; center(): { x: number; y: number } }
interface Props {
  doc: Doc; showMiniMap: boolean; initialViewport?: Viewport;
  onSet: (d: Doc) => void; onCheckpoint: () => void; onAddAt: (type: string, pos: { x: number; y: number }) => void;
  onDuplicate: (ids: string[]) => void; onSelect: (ids: string[]) => void; onRejected: (reason: string) => void;
}
const nodeTypes = { forge: FlowNode };

const CanvasInner = forwardRef<CanvasHandle, Props>(function CanvasInner(p, ref) {
  const rf = useReactFlow();
  const { run } = useOverlay();
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId: string | null; flow: { x: number; y: number } } | null>(null);
  useImperativeHandle(ref, () => ({
    getViewport: () => rf.getViewport(), fit: () => void rf.fitView({ padding: 0.2, duration: 200 }),
    center: () => rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }),
  }), [rf]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    if (changes.some((c) => c.type === "remove")) p.onCheckpoint();
    const nodes = applyNodeChanges(changes, p.doc.nodes as never) as unknown as ForgeNode[];
    const ids = new Set(nodes.map((n) => n.id));
    p.onSet({ ...p.doc, nodes, edges: p.doc.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) });
    if (changes.some((c) => c.type === "select")) p.onSelect(nodes.filter((n) => n.selected).map((n) => n.id));
  }, [p]);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (changes.some((c) => c.type === "remove")) p.onCheckpoint();
    p.onSet({ ...p.doc, edges: applyEdgeChanges(changes, p.doc.edges) });
  }, [p]);

  const edges = useMemo(() => p.doc.edges.map((e) => {
    const src = run.nodes[e.source];
    const active = src?.status === "completed" && src.activePorts?.includes(e.sourceHandle ?? "");
    const sdef = getDef(getType(p.doc.nodes.find((n) => n.id === e.source) ?? ({ data: { nodeType: "" } } as ForgeNode)));
    const type = sdef?.outputs.find((o) => o.name === e.sourceHandle)?.type;
    return { ...e, type: "default", className: active ? "edge--active" : src?.status === "completed" ? "edge--inactive" : "", animated: src?.status === "running",
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 }, data: { type } };
  }), [p.doc, run.nodes]);

  const onDrop = (ev: React.DragEvent) => {
    const type = ev.dataTransfer.getData(DRAG_MIME);
    if (!type) return;
    ev.preventDefault();
    p.onAddAt(type, rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY }));
  };

  const empty = p.doc.nodes.length === 0;
  return (
    <div className="canvas" onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }} onDrop={onDrop} onClick={() => setMenu(null)}>
      <ReactFlow nodes={p.doc.nodes as never} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onNodeDragStart={p.onCheckpoint} defaultViewport={p.initialViewport} fitView={!p.initialViewport} fitViewOptions={{ padding: 0.2 }}
        connectionLineType={ConnectionLineType.Bezier} minZoom={0.2} maxZoom={1.8} deleteKeyCode={["Delete", "Backspace"]} multiSelectionKeyCode="Shift"
        selectionOnDrag panOnDrag={[1, 2]} proOptions={{ hideAttribution: true }}
        isValidConnection={(c) => !!c.sourceHandle && !!c.targetHandle && connectionProblem(p.doc, { source: c.source, sourceHandle: c.sourceHandle, target: c.target, targetHandle: c.targetHandle }) === null}
        onConnect={(c) => {
          if (!c.sourceHandle || !c.targetHandle) return;
          const input = { source: c.source, sourceHandle: c.sourceHandle, target: c.target, targetHandle: c.targetHandle };
          const problem = connectionProblem(p.doc, input);
          if (problem) { p.onRejected(problem); return; }
          p.onCheckpoint(); p.onSet(connect(p.doc, input));
        }}
        onConnectEnd={(_, st) => {
          if (!st.isValid && st.fromHandle && st.toHandle) {
            const a = st.fromNode?.id, b = st.toNode?.id;
            if (a && b) { const prob = st.fromHandle.type === "source"
              ? connectionProblem(p.doc, { source: a, sourceHandle: st.fromHandle.id ?? "", target: b, targetHandle: st.toHandle.id ?? "" }) : null;
              if (prob) p.onRejected(prob); }
          }
        }}
        onNodeContextMenu={(ev, n) => { ev.preventDefault(); setMenu({ x: ev.clientX, y: ev.clientY, nodeId: n.id, flow: rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY }) }); }}
        onPaneContextMenu={(ev) => { ev.preventDefault(); const e = ev as MouseEvent; setMenu({ x: e.clientX, y: e.clientY, nodeId: null, flow: rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }) }); }}
        onEdgeContextMenu={(ev, edge) => { ev.preventDefault(); p.onCheckpoint(); p.onSet(deleteEdges(p.doc, [edge.id])); }}
        colorMode="dark">
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
        <Controls showInteractive={false} position="bottom-left" />
        {p.showMiniMap && <MiniMap pannable zoomable nodeColor={(n) => categoryColor(getDef(String((n.data as { nodeType?: string }).nodeType))?.category ?? "")} maskColor="rgba(0,0,0,0.55)" />}
      </ReactFlow>
      <button className="btn fitbtn" onClick={() => void rf.fitView({ padding: 0.2, duration: 200 })} title="Fit to screen"><Maximize size={14} /> Fit</button>
      {empty && (
        <div className="canvas__empty"><h2>Build your first workflow</h2>
          <p>Drag <b>Start</b> from the library onto the canvas, then add nodes and connect output ports (right) to input ports (left).</p>
          <p className="muted">Tip: right-click the canvas to add a node, or open the Organize Downloads example from the settings menu.</p></div>
      )}
      {menu && (
        <div className="ctxmenu" style={{ left: menu.x, top: menu.y }} role="menu" onClick={(e) => e.stopPropagation()}>
          {menu.nodeId ? (
            <>
              <button role="menuitem" onClick={() => { p.onDuplicate([menu.nodeId!]); setMenu(null); }}><Copy size={13} /> Duplicate</button>
              <button role="menuitem" onClick={() => { p.onCheckpoint(); p.onSet(deleteNodes(p.doc, [menu.nodeId!])); setMenu(null); }}><Trash2 size={13} /> Delete node</button>
            </>
          ) : (
            <><div className="ctxmenu__title">Add node</div>
              {NODE_DEFS.map((d) => <button role="menuitem" key={d.type} onClick={() => { p.onAddAt(d.type, menu.flow); setMenu(null); }}>{d.name}</button>)}</>
          )}
        </div>
      )}
    </div>
  );
});

export const Canvas = forwardRef<CanvasHandle, Props>(function Canvas(p, ref) {
  return <ReactFlowProvider><CanvasInner ref={ref} {...p} /></ReactFlowProvider>;
});
