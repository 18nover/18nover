import type { CameraSummary, PlaybackGrant, ProbeResult, RelayTelemetry, RealtimeCredentials, VoiceCredentials } from "../contracts";
import type { ServerConfig } from "./config";

export class RelayError extends Error {
  readonly status: number;
  readonly code: string;
  readonly safeMessage: string;
  constructor(status: number, code: string, safeMessage: string) {
    super(safeMessage);
    this.status = status;
    this.code = code;
    this.safeMessage = safeMessage;
  }
}

const MAX_RELAY_RESPONSE_BYTES = 1_000_000;

export async function relayRequest(config: ServerConfig, method: "POST" | "PATCH" | "DELETE", path: string, body: unknown) {
  const rawBody = body === undefined ? "" : JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const digest = await sha256Hex(rawBody);
  const canonical = `v1\n${timestamp}\n${nonce}\n${method}\n${path}\n${digest}`;
  const keyBytes = config.relayHmacSecret.buffer.slice(
    config.relayHmacSecret.byteOffset,
    config.relayHmacSecret.byteOffset + config.relayHmacSecret.byteLength,
  ) as ArrayBuffer;
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical))));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.relayOrigin}${path}`, {
      method,
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-lockard-key-id": config.relayKeyId,
        "x-lockard-timestamp": timestamp,
        "x-lockard-nonce": nonce,
        "x-lockard-signature": signature,
      },
      body: method === "DELETE" && !rawBody ? undefined : rawBody,
    });
    if (!response.ok) throw mapRelayStatus(response.status);
    if (response.status === 204) return null;
    const text = await readBoundedResponse(response);
    try { return JSON.parse(text); } catch { throw new RelayError(502, "RELAY_FAILURE", "The relay returned an invalid response."); }
  } catch (error) {
    if (error instanceof RelayError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new RelayError(504, "RELAY_TIMEOUT", "The relay did not respond in time.");
    throw new RelayError(502, "RELAY_FAILURE", "The secure relay could not be reached.");
  } finally {
    clearTimeout(timeout);
  }
}

export function sanitizeCamera(value: unknown): CameraSummary {
  const record = object(value);
  return {
    id: safeId(record.id),
    name: safeText(record.name, 64),
    state: oneOf(record.state, ["online", "connecting", "reconnecting", "offline", "error", "capacity"] as const),
    inputCodec: nullableText(record.inputCodec, 32),
    profiles: Array.isArray(record.profiles) ? record.profiles.slice(0, 8).map((profile) => {
      const item = object(profile);
      return { id: safeId(item.id), label: oneOf(item.label, ["Source", "1080p", "720p", "480p"] as const), width: nullableNumber(item.width), height: nullableNumber(item.height), bitrateKbps: nullableNumber(item.bitrateKbps) };
    }) : [],
    width: nullableNumber(record.width),
    height: nullableNumber(record.height),
    fps: nullableNumber(record.fps),
    bitrateKbps: nullableNumber(record.bitrateKbps),
    audio: safeBoolean(record.audio),
    relayMode: oneOf(record.relayMode, ["direct", "transcoded", "unavailable"] as const),
    lastFrameAt: nullableDate(record.lastFrameAt),
    errorCode: nullableText(record.errorCode, 64),
  };
}

export function sanitizePlayback(value: unknown, relayOrigin: string): PlaybackGrant | null {
  if (value === null || value === undefined) return null;
  const record = object(value);
  let url: URL;
  try { url = new URL(safeText(record.whepUrl, 2048)); } catch { throw new RelayError(502, "RELAY_FAILURE", "The relay returned an invalid playback endpoint."); }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.hash
    || url.search
    || url.origin !== relayOrigin
    || !/^\/whep\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/whep$/.test(url.pathname)
  ) throw new RelayError(502, "RELAY_FAILURE", "The relay returned an invalid playback endpoint.");
  return { cameraId: safeId(record.cameraId), profileId: safeId(record.profileId), state: oneOf(record.state, ["online", "degraded"] as const), whepUrl: url.toString(), accessToken: safeText(record.accessToken, 8192), tokenType: "Bearer", expiresAt: safeDate(record.expiresAt) };
}

export function sanitizeTelemetry(value: unknown): RelayTelemetry {
  const record = object(value);
  return { viewers: safeNumber(record.viewers), voiceMembers: safeNumber(record.voiceMembers), bitrateMbps: nullableNumber(record.bitrateMbps), latencySeconds: nullableNumber(record.latencySeconds), fps: nullableNumber(record.fps), cpuPercent: nullableNumber(record.cpuPercent), network: oneOf(record.network, ["healthy", "degraded", "offline"] as const), uptimeSeconds: safeNumber(record.uptimeSeconds) };
}

export function sanitizeProbe(value: unknown): ProbeResult {
  const record = object(value);
  return {
    inputCodec: safeText(record.inputCodec, 32),
    profile: nullableText(record.profile, 64),
    hasBFrames: safeBoolean(record.hasBFrames),
    width: safeNumber(record.width),
    height: safeNumber(record.height),
    fps: safeNumber(record.fps),
    bitrateKbps: nullableNumber(record.bitrateKbps),
    audioCodec: nullableText(record.audioCodec, 32),
    latestFrameAt: safeDate(record.latestFrameAt),
    relayMode: oneOf(record.relayMode, ["direct", "transcoded"] as const),
    profiles: sanitizeCamera({ id: "probe", name: "probe", state: "online", inputCodec: null, profiles: record.profiles, width: null, height: null, fps: null, bitrateKbps: null, audio: false, relayMode: "direct", lastFrameAt: null }).profiles,
  };
}

export function sanitizeCredentials(value: unknown, kind: "realtime" | "voice"): RealtimeCredentials | VoiceCredentials {
  if (value === null || value === undefined) return null;
  const record = object(value);
  const url = new URL(safeText(record.url, 2048));
  const allowed = kind === "voice" ? ["wss:", "https:"] : ["wss:"];
  if (!allowed.includes(url.protocol) || url.username || url.password || url.hash) throw new RelayError(502, "RELAY_FAILURE", "A companion service returned invalid credentials.");
  return { url: url.toString(), token: safeText(record.token, 8192), expiresAt: safeDate(record.expiresAt) };
}

function mapRelayStatus(status: number) {
  const known: Record<number, [string, string]> = {
    404: ["CAMERA_NOT_FOUND", "The camera was not found."],
    409: ["CAMERA_CONFLICT", "The camera conflicts with an existing source or relay capacity."],
    422: ["CAMERA_UNAVAILABLE", "The camera source could not be validated."],
    429: ["RATE_LIMITED", "Too many camera requests. Try again shortly."],
  };
  const match = known[status];
  return match ? new RelayError(status, match[0], match[1]) : new RelayError(502, "RELAY_FAILURE", "The relay rejected the request.");
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RelayError(502, "RELAY_FAILURE", "The relay returned an invalid response.");
  return value as Record<string, unknown>;
}
function safeText(value: unknown, max: number) { if (typeof value !== "string" || !value || value.length > max || /rtsp(?:s)?:\/\//i.test(value)) throw new RelayError(502, "RELAY_FAILURE", "The relay returned an invalid response."); return value; }
function nullableText(value: unknown, max: number) { return value === null || value === undefined || value === "" ? null : safeText(value, max); }
function safeId(value: unknown) { const text = safeText(value, 64); if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(text)) throw new RelayError(502, "RELAY_FAILURE", "The relay returned an invalid identifier."); return text; }
function safeNumber(value: unknown) { const number = Number(value); if (!Number.isFinite(number) || number < 0) throw new RelayError(502, "RELAY_FAILURE", "The relay returned invalid metrics."); return number; }
function safeBoolean(value: unknown) { if (typeof value !== "boolean") throw new RelayError(502, "RELAY_FAILURE", "The relay returned an invalid boolean."); return value; }
function nullableNumber(value: unknown) { return value === null || value === undefined ? null : safeNumber(value); }
function safeDate(value: unknown) { const text = safeText(value, 64); if (!Number.isFinite(Date.parse(text))) throw new RelayError(502, "RELAY_FAILURE", "The relay returned an invalid timestamp."); return text; }
function nullableDate(value: unknown) { return value === null || value === undefined || value === "" ? null : safeDate(value); }
function oneOf<T extends readonly string[]>(value: unknown, choices: T): T[number] { if (typeof value !== "string" || !choices.includes(value)) throw new RelayError(502, "RELAY_FAILURE", "The relay returned an invalid state."); return value as T[number]; }
async function sha256Hex(value: string) { const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))); return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""); }
function base64url(value: Uint8Array) { let binary = ""; value.forEach((byte) => { binary += String.fromCharCode(byte); }); return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }

async function readBoundedResponse(response: Response) {
  const announced = response.headers.get("Content-Length");
  if (announced !== null) {
    if (!/^\d+$/.test(announced)) throw invalidRelayResponse();
    const length = Number(announced);
    if (!Number.isSafeInteger(length) || length > MAX_RELAY_RESPONSE_BYTES) throw invalidRelayResponse();
  }
  if (!response.body) throw invalidRelayResponse();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_RELAY_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw invalidRelayResponse();
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  });
  try { return new TextDecoder("utf-8", { fatal: true }).decode(body); } catch { throw invalidRelayResponse(); }
}

function invalidRelayResponse() {
  return new RelayError(502, "RELAY_FAILURE", "The relay returned an invalid response.");
}
