import { spawn, type ChildProcess } from "node:child_process";
import type { Authenticator } from "./auth.js";
import type { RelayConfig } from "./config.js";

type Worker = {
  id: string;
  inputPath: string;
  outputPath: string;
  audio: boolean;
  width: number;
  height: number;
  child: ChildProcess | null;
  failures: number[];
  stopped: boolean;
  restartTimer: NodeJS.Timeout | null;
};

export class TranscoderSupervisor {
  private readonly workers = new Map<string, Worker>();
  private readonly breakerUntil = new Map<string, number>();

  constructor(private readonly config: RelayConfig, private readonly auth: Authenticator, private readonly onState: (id: string, state: "starting" | "online" | "error") => void) {}

  get activeCount() { return [...this.workers.values()].filter((worker) => !worker.stopped).length; }

  async start(id: string, inputPath: string, outputPath: string, audio: boolean, width: number, height: number) {
    if (this.workers.has(id)) await this.stop(id);
    const blockedUntil = this.breakerUntil.get(id) ?? 0;
    if (blockedUntil > Date.now()) return false;
    this.breakerUntil.delete(id);
    if (this.activeCount >= this.config.maxTranscoders) return false;
    const worker: Worker = { id, inputPath, outputPath, audio, width, height, child: null, failures: [], stopped: false, restartTimer: null };
    this.workers.set(id, worker);
    await this.spawnWorker(worker);
    return true;
  }

  async stop(id: string) {
    const worker = this.workers.get(id);
    if (!worker) return;
    worker.stopped = true;
    if (worker.restartTimer) clearTimeout(worker.restartTimer);
    worker.child?.kill("SIGTERM");
    setTimeout(() => worker.child?.kill("SIGKILL"), 2_000).unref();
    this.workers.delete(id);
  }

  async shutdown() { await Promise.all([...this.workers.keys()].map((id) => this.stop(id))); }

  resetCircuit(id: string) { this.breakerUntil.delete(id); }

  isCircuitOpen(id: string) { return (this.breakerUntil.get(id) ?? 0) > Date.now(); }

  private async spawnWorker(worker: Worker) {
    if (worker.stopped) return;
    this.onState(worker.id, "starting");
    const inputToken = await this.auth.issueToken(`transcoder-${worker.id}`, "read", worker.inputPath, 600);
    const outputToken = await this.auth.issueToken(`transcoder-${worker.id}`, "publish", worker.outputPath, 600);
    const input = `${this.config.mediaRtspOrigin}/${worker.inputPath}?token=${encodeURIComponent(inputToken)}`;
    const output = `${this.config.mediaRtspOrigin}/${worker.outputPath}?token=${encodeURIComponent(outputToken)}`;
    const args = [
      "-hide_banner", "-nostdin", "-loglevel", "warning", "-rtsp_transport", "tcp", "-i", input,
      "-map", "0:v:0", "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
      "-profile:v", "baseline", "-pix_fmt", "yuv420p", "-bf", "0", "-g", "30", "-keyint_min", "30",
      "-sc_threshold", "0", "-r", "30", "-vf", `scale=${worker.width}:${worker.height}:force_original_aspect_ratio=decrease:force_divisible_by=2`, "-b:v", "5400k", "-maxrate", "6000k", "-bufsize", "6000k",
    ];
    if (worker.audio) args.push("-map", "0:a:0?", "-c:a", "libopus", "-application", "lowdelay", "-b:a", "96k", "-ar", "48000");
    else args.push("-an");
    args.push("-f", "rtsp", "-rtsp_transport", "tcp", output);
    const child = spawn(this.config.ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"], shell: false, env: { PATH: "/usr/bin:/bin", LANG: "C" } });
    worker.child = child;
    child.stderr?.resume();
    child.once("error", () => this.scheduleRestart(worker));
    child.once("close", () => this.scheduleRestart(worker));
  }

  private scheduleRestart(worker: Worker) {
    if (worker.stopped || worker.restartTimer) return;
    const now = Date.now();
    worker.failures = worker.failures.filter((time) => now - time < 300_000);
    worker.failures.push(now);
    if (worker.failures.length >= 5) {
      worker.stopped = true;
      this.workers.delete(worker.id);
      this.breakerUntil.set(worker.id, now + 300_000);
      this.onState(worker.id, "error");
      return;
    }
    const delay = Math.min(30_000, 1_000 * 2 ** (worker.failures.length - 1)) + Math.floor(Math.random() * 500);
    worker.restartTimer = setTimeout(() => { worker.restartTimer = null; void this.spawnWorker(worker); }, delay);
  }
}
