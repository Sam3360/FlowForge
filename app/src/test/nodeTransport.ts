/** Test-only transport: spawns the REAL Python engine as a child process. Not used by the production app. */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import type { Transport } from "../engine/client";

export class NodeProcessTransport implements Transport {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private lineCb: (l: string) => void = () => undefined;
  private exitCb: (r: string) => void = () => undefined;
  private buf = "";
  private stopping = false;
  constructor(private python = process.env["FLOWFORGE_PYTHON"] ?? "python3") {}
  onLine(cb: (l: string) => void) { this.lineCb = cb; }
  onExit(cb: (r: string) => void) { this.exitCb = cb; }
  async start() {
    const cwd = path.resolve(__dirname, "../../../engine");
    this.proc = spawn(this.python, ["-m", "flowforge_engine"], { cwd });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (d: string) => {
      this.buf += d;
      let i: number;
      while ((i = this.buf.indexOf("\n")) >= 0) { const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1); if (line) this.lineCb(line); }
    });
    this.proc.on("exit", (code) => { if (!this.stopping) this.exitCb(`exit code ${String(code)}`); });
    const proc = this.proc;
    await new Promise<void>((resolve, reject) => { proc.once("spawn", () => resolve()); proc.once("error", (e) => reject(e)); });
  }
  async send(line: string) { this.proc!.stdin.write(line + "\n"); }
  async stop() { this.stopping = true; this.proc?.stdin.end(); this.proc?.kill(); }
  kill() { this.proc?.kill("SIGKILL"); }
}
