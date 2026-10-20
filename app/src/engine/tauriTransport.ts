import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Transport } from "./client";

/** Talks to the Python sidecar through Rust commands (see src-tauri/src/engine.rs). */
export class TauriTransport implements Transport {
  private lineCb: (l: string) => void = () => undefined;
  private exitCb: (r: string) => void = () => undefined;
  private unlisten: UnlistenFn[] = [];

  onLine(cb: (l: string) => void): void { this.lineCb = cb; }
  onExit(cb: (r: string) => void): void { this.exitCb = cb; }

  async start(): Promise<void> {
    this.unlisten.push(await listen<string>("engine-line", (e) => this.lineCb(e.payload)));
    this.unlisten.push(await listen<string>("engine-exit", (e) => this.exitCb(e.payload)));
    await invoke("engine_start");
  }
  async send(line: string): Promise<void> { await invoke("engine_send", { line }); }
  async stop(): Promise<void> {
    await invoke("engine_stop");
    this.unlisten.forEach((u) => u());
    this.unlisten = [];
  }
}
