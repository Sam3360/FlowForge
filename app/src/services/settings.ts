export interface Settings { showMiniMap: boolean; autosaveRecovery: boolean }
const KEY = "flowforge.settings.v1";
export const DEFAULT_SETTINGS: Settings = { showMiniMap: true, autosaveRecovery: true };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULT_SETTINGS;
  } catch { return DEFAULT_SETTINGS; }
}
export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable: settings stay in memory */ }
}
