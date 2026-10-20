import { createContext, useContext } from "react";
import type { Issue } from "../model/types";
import { initialRun, type RunState } from "../model/runState";

export interface Overlay { run: RunState; issues: Issue[]; selectedId: string | null }
export const OverlayContext = createContext<Overlay>({ run: initialRun(), issues: [], selectedId: null });
export const useOverlay = (): Overlay => useContext(OverlayContext);
