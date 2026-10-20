import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { FILE_EXTENSION } from "../config/product";

/** Everything that touches the user's disk or native dialogs. Replaceable in tests. */
export interface FileService {
  pickOpenPath(): Promise<string | null>;
  pickSavePath(suggestedName: string): Promise<string | null>;
  pickDirectory(): Promise<string | null>;
  readText(path: string): Promise<string>;
  /** Must write atomically (temp file + rename). */
  writeTextAtomic(path: string, text: string): Promise<void>;
  writeRecovery(text: string): Promise<void>;
  readRecovery(): Promise<string | null>;
  clearRecovery(): Promise<void>;
  /** Handler resolves true to allow the window to close. */
  onCloseRequested(handler: () => Promise<boolean>): Promise<() => void>;
}

const FILTERS = [{ name: "Workflow", extensions: ["json"] }];

export const tauriFiles: FileService = {
  async pickOpenPath() {
    const r = await open({ multiple: false, directory: false, filters: FILTERS });
    return typeof r === "string" ? r : null;
  },
  async pickSavePath(suggestedName) {
    return (await save({ defaultPath: `${suggestedName}.${FILE_EXTENSION}`, filters: FILTERS })) ?? null;
  },
  async pickDirectory() {
    const r = await open({ multiple: false, directory: true });
    return typeof r === "string" ? r : null;
  },
  readText: (path) => invoke<string>("read_text_file", { path }),
  writeTextAtomic: (path, text) => invoke<void>("write_text_atomic", { path, text }),
  writeRecovery: (text) => invoke<void>("write_recovery", { text }),
  readRecovery: () => invoke<string | null>("read_recovery"),
  clearRecovery: () => invoke<void>("clear_recovery"),
  async onCloseRequested(handler) {
    return getCurrentWindow().onCloseRequested(async (ev) => {
      if (!(await handler())) ev.preventDefault();
    });
  },
};
