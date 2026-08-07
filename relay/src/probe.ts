import { spawn } from "node:child_process";
import type { Authenticator } from "./auth.js";
import type { RelayConfig } from "./config.js";
import type { MediaMtxClient } from "./mediamtx.js";
import type { ProbeResult } from "./types.js";

type FfprobeStream = {
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  bit_rate?: string;
  has_b_frames?: number;
};

type FfprobeOutput = {
  streams?: FfprobeStream[];
  format?: { bit_rate?: string };
};

export class CameraProber {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly config: RelayConfig, private readonly media: MediaMtxClient, private readonly auth: Authenticator) {}

  async probePinnedSource(pinnedSource: string, audioEnabled: boolean, transport: "tcp" | "udp" = "tcp", sourceFingerprint?: string): Promise<ProbeResult> {
    await this.acquire();
    const path = `probe-${crypto.randomUUID().replace(/-/g, "")}`;
    try {
      await this.media.ensurePullPath(path, pinnedSource, transport, sourceFingerprint);
      const ready = await this.media.waitReady(path, 8_000);
      if (!ready) throw cameraError("CAMERA_UNREACHABLE");
      const token = await this.auth.issueToken("relay-probe", "read", path, 60);
      const internal = `${this.config.mediaRtspOrigin}/${path}?token=${encodeURIComponent(token)}`;
      const result = await runFfprobe(this.config.ffprobePath, internal);
      return planProbe(result, audioEnabled);
    } finally {
      await this.media.deletePath(path).catch(() => undefined);
      this.release();
    }
  }

  private async acquire() {
    if (this.active < 2) { this.active += 1; return; }
    if (this.waiters.length >= 8) throw cameraError("PROBE_CAPACITY");
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  private release() {
    this.active -= 1;
    this.waiters.shift()?.();
  }
}

export function planProbe(value: FfprobeOutput, audioEnabled: boolean): ProbeResult {
  const video = value.streams?.find((stream) => stream.codec_type === "video");
  const audio = value.streams?.find((stream) => stream.codec_type === "audio");
  if (!video?.codec_name || !video.width || !video.height) throw cameraError("NO_VIDEO_TRACK");
  const fps = parseRate(video.avg_frame_rate ?? video.r_frame_rate ?? "0/1");
  const inputCodec = video.codec_name.toLowerCase();
  const audioCodec = audioEnabled && audio?.codec_name ? audio.codec_name.toLowerCase() : null;
  const profile = video.profile ?? null;
  const pixelFormat = video.pix_fmt ?? null;
  const hasBFrames = Number(video.has_b_frames ?? 0) > 0;
  const compatibleVideo = inputCodec === "h264" && !hasBFrames && pixelFormat === "yuv420p" && /baseline/i.test(profile ?? "");
  const compatibleAudio = !audioCodec || ["opus", "pcm_mulaw", "pcm_alaw", "pcmu", "pcma"].includes(audioCodec);
  const relayMode = compatibleVideo && compatibleAudio ? "direct" : "transcoded";
  const rendition = relayMode === "transcoded" ? fitInside(video.width, video.height, 1920, 1080) : { width: video.width, height: video.height };
  const outputWidth = rendition.width;
  const outputHeight = rendition.height;
  const label = relayMode === "direct" ? "Source" : outputHeight >= 1000 ? "1080p" : outputHeight >= 700 ? "720p" : "480p";
  const bitrate = numberOrNull(video.bit_rate ?? value.format?.bit_rate);
  return {
    inputCodec,
    profile,
    pixelFormat,
    hasBFrames,
    width: video.width,
    height: video.height,
    fps,
    bitrateKbps: bitrate === null ? null : Math.round(bitrate / 1000),
    audioCodec,
    latestFrameAt: new Date().toISOString(),
    relayMode,
    profiles: [{ id: "source", label, width: outputWidth, height: outputHeight, bitrateKbps: relayMode === "transcoded" ? 5_400 : bitrate === null ? null : Math.round(bitrate / 1000), path: "", relayMode }],
  };
}

async function runFfprobe(binary: string, internalUrl: string): Promise<FfprobeOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [
      "-hide_banner", "-v", "error", "-rtsp_transport", "tcp", "-rw_timeout", "8000000",
      "-show_entries", "stream=codec_type,codec_name,profile,pix_fmt,width,height,avg_frame_rate,r_frame_rate,bit_rate,has_b_frames:format=bit_rate",
      "-of", "json", internalUrl,
    ], { stdio: ["ignore", "pipe", "pipe"], shell: false, env: { PATH: "/usr/bin:/bin", LANG: "C" } });
    let stdout = Buffer.alloc(0);
    let overflow = false;
    const timer = setTimeout(() => { child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 750).unref(); }, 10_000);
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.byteLength + chunk.byteLength > 1_048_576) { overflow = true; child.kill("SIGTERM"); return; }
      stdout = Buffer.concat([stdout, chunk]);
    });
    child.stderr.resume();
    child.once("error", () => { clearTimeout(timer); reject(cameraError("PROBE_FAILED")); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (overflow) return reject(cameraError("PROBE_OUTPUT_LIMIT"));
      if (code !== 0) return reject(cameraError("CAMERA_UNREACHABLE"));
      try { resolve(JSON.parse(stdout.toString("utf8")) as FfprobeOutput); } catch { reject(cameraError("INVALID_MEDIA_METADATA")); }
    });
  });
}

function parseRate(value: string) { const [numerator, denominator] = value.split("/").map(Number); if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || !denominator) return 0; return Math.round((numerator! / denominator!) * 100) / 100; }
function numberOrNull(value: string | undefined) { if (!value) return null; const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : null; }
function fitInside(width: number, height: number, maxWidth: number, maxHeight: number) {
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(2, Math.floor((width * scale) / 2) * 2),
    height: Math.max(2, Math.floor((height * scale) / 2) * 2),
  };
}
export function cameraError(code: string) { const error = new Error(code); error.name = "CameraError"; return error; }
