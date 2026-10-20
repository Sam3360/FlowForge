/** Undo/redo over whole-document snapshots. `set` is transient (selection, mid-drag); `checkpoint` records an undo step. */
import type { Doc } from "./editor";

export interface History { past: Doc[]; present: Doc; future: Doc[] }
export type HistoryAction =
  | { type: "set"; doc: Doc }
  | { type: "checkpoint" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "load"; doc: Doc };

const LIMIT = 100;
export const initHistory = (doc: Doc): History => ({ past: [], present: doc, future: [] });

export function historyReducer(h: History, a: HistoryAction): History {
  switch (a.type) {
    case "set": return { ...h, present: a.doc };
    case "checkpoint": return { past: [...h.past, h.present].slice(-LIMIT), present: h.present, future: [] };
    case "undo": {
      const prev = h.past[h.past.length - 1];
      return prev ? { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] } : h;
    }
    case "redo": {
      const next = h.future[0];
      return next ? { past: [...h.past, h.present], present: next, future: h.future.slice(1) } : h;
    }
    case "load": return initHistory(a.doc);
  }
}
