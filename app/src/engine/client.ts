/** NDJSON client for the Python engine. The transport is injected: Tauri in the app, a child process in integration tests. */
import type { EngineEvent } from "../model/runState";

export interface Transport {
  start(): Promise<void>;
  send(line: string): Promise<void>;
  onLine(cb: (line: string) => void): void;
  onExit(cb: (reason: string) => void): void;
  stop(): Promise<void>;
}

export const PROTOCOL_VERSION = 1;
export const MAX_LINE_BYTES = 4 * 1024 * 1024;

export class EngineRequestError extends Error {
  constructor(public code: string, message: string, public details: Record<string, unknown> = {}) { super(message); }
}

interface Pending { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }
export interface HelloResult { protocolVersion: number; engineVersion: string; supportedSchemaVersions: number[] }

export class EngineClient {
  private pending = new Map<string, Pending>();
  private nextId = 1;
  private eventListeners = new Set<(e: EngineEvent) => void>();
  private exitListeners = new Set<(reason: string) => void>();
  private started = false;
  info: HelloResult | null = null;

  constructor(private transport: Transport) {
    transport.onLine((l) => this.handleLine(l));
    transport.onExit((r) => this.handleExit(r));
  }

  get isRunning(): boolean { return this.started; }
  onEvent(cb: (e: EngineEvent) => void): () => void { this.eventListeners.add(cb); return () => this.eventListeners.delete(cb); }
  onExit(cb: (reason: string) => void): () => void { this.exitListeners.add(cb); return () => this.exitListeners.delete(cb); }

  async start(): Promise<HelloResult> {
    await this.transport.start();
    this.started = true;
    try {
      const hello = (await this.request("hello", { protocolVersion: PROTOCOL_VERSION })) as unknown as HelloResult;
      this.info = hello;
      return hello;
    } catch (e) {
      this.started = false;
      await this.transport.stop().catch(() => undefined);
      throw e;
    }
  }

  request(type: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!this.started) return Promise.reject(new EngineRequestError("ENGINE_NOT_RUNNING", "The execution engine is not running."));
    const id = String(this.nextId++);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.transport.send(JSON.stringify({ id, type, ...payload })).catch((err: unknown) => {
        this.pending.delete(id);
        reject(new EngineRequestError("ENGINE_SEND_FAILED", `Could not talk to the engine: ${String(err)}`));
      });
    });
  }

  async shutdown(): Promise<void> {
    if (!this.started) return;
    await Promise.race([this.request("shutdown").catch(() => undefined), new Promise((r) => setTimeout(r, 2000))]);
    this.started = false;
    await this.transport.stop().catch(() => undefined);
  }

  private handleLine(line: string): void {
    if (line.length > MAX_LINE_BYTES) return; // refuse to parse absurdly large lines
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(line) as Record<string, unknown>; } catch { return; } // not protocol traffic
    if (msg["type"] === "event") { this.eventListeners.forEach((cb) => cb(msg as unknown as EngineEvent)); return; }
    if (msg["type"] !== "response") return;
    const p = this.pending.get(String(msg["id"]));
    if (!p) return;
    this.pending.delete(String(msg["id"]));
    if (msg["ok"]) p.resolve(msg["result"] as Record<string, unknown>);
    else {
      const err = msg["error"] as { code: string; message: string; details?: Record<string, unknown> };
      p.reject(new EngineRequestError(err.code, err.message, err.details ?? {}));
    }
  }

  private handleExit(reason: string): void {
    this.started = false;
    const msg = `The execution engine stopped unexpectedly (${reason}).`;
    for (const p of this.pending.values()) p.reject(new EngineRequestError("ENGINE_EXITED", msg));
    this.pending.clear();
    this.exitListeners.forEach((cb) => cb(msg));
  }
}
