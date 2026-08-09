import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type RelayConfig = {
  port: number;
  dbPath: string;
  masterKey: Buffer;
  hmacKeys: Map<string, Buffer>;
  jwtPrivateKeyPem: string;
  jwtIssuer: string;
  jwtAudience: string;
  publicOrigin: string;
  sitesOrigin: string;
  mediaApiOrigin: string;
  mediaRtspOrigin: string;
  mediaWhepOrigin: string;
  allowedPorts: Set<number>;
  maxCameras: number;
  maxWarmCameras: number;
  maxTranscoders: number;
  ffprobePath: string;
  ffmpegPath: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  const masterKey = readBase64Secret(required(env, "RELAY_DB_MASTER_KEY_FILE"));
  if (masterKey.byteLength !== 32) throw new Error("database master key must decode to exactly 32 bytes");
  const hmacFile = JSON.parse(readFileSync(required(env, "RELAY_HMAC_KEYS_FILE"), "utf8")) as unknown;
  if (!hmacFile || typeof hmacFile !== "object" || Array.isArray(hmacFile)) throw new Error("HMAC key file is invalid");
  const hmacKeys = new Map<string, Buffer>();
  for (const [id, value] of Object.entries(hmacFile as Record<string, unknown>)) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || typeof value !== "string") throw new Error("HMAC key file is invalid");
    const key = Buffer.from(value, "base64");
    if (key.byteLength < 32) throw new Error("each HMAC key must contain at least 32 bytes");
    hmacKeys.set(id, key);
  }
  if (!hmacKeys.size) throw new Error("at least one HMAC key is required");

  const publicOrigin = httpsOrigin(required(env, "RELAY_PUBLIC_ORIGIN"));
  const sitesOrigin = httpsOrigin(required(env, "RELAY_SITES_ORIGIN"));
  const jwtIssuer = httpsOrigin(required(env, "RELAY_JWT_ISSUER"));
  const jwtAudience = bounded(required(env, "RELAY_JWT_AUDIENCE"), 128);
  const mediaApiOrigin = internalOrigin(required(env, "MEDIAMTX_API_ORIGIN"), ["http:"]);
  const mediaRtspOrigin = internalOrigin(required(env, "MEDIAMTX_RTSP_ORIGIN"), ["rtsp:"]);
  const mediaWhepOrigin = internalOrigin(required(env, "MEDIAMTX_WHEP_ORIGIN"), ["http:"]);
  const allowedPorts = new Set((env.RELAY_ALLOWED_CAMERA_PORTS ?? "554,8554").split(",").map((value) => Number(value.trim())));
  if ([...allowedPorts].some((port) => !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error("allowed camera ports are invalid");

  return {
    port: integer(env.PORT ?? "8080", 1, 65535),
    dbPath: resolve(env.RELAY_DB_PATH ?? "/var/lib/nover/relay.sqlite"),
    masterKey,
    hmacKeys,
    jwtPrivateKeyPem: readFileSync(required(env, "RELAY_JWT_PRIVATE_KEY_FILE"), "utf8"),
    jwtIssuer,
    jwtAudience,
    publicOrigin,
    sitesOrigin,
    mediaApiOrigin,
    mediaRtspOrigin,
    mediaWhepOrigin,
    allowedPorts,
    maxCameras: integer(env.RELAY_MAX_CAMERAS ?? "8", 1, 64),
    maxWarmCameras: integer(env.RELAY_MAX_WARM_CAMERAS ?? "4", 1, 16),
    maxTranscoders: integer(env.RELAY_MAX_TRANSCODERS ?? "2", 0, 16),
    ffprobePath: env.FFPROBE_PATH ?? "/usr/bin/ffprobe",
    ffmpegPath: env.FFMPEG_PATH ?? "/usr/bin/ffmpeg",
  };
}

function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name];
  if (!value || /[\r\n\0]/.test(value)) throw new Error(`${name} is required`);
  return value;
}
function bounded(value: string, max: number) { if (!value || value.length > max || /[\r\n\0]/.test(value)) throw new Error("configuration value is invalid"); return value; }
function integer(value: string, min: number, max: number) { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error("numeric configuration is invalid"); return parsed; }
function readBase64Secret(path: string) { const value = readFileSync(path, "utf8").trim(); if (!/^[A-Za-z0-9+/_=-]+$/.test(value)) throw new Error("secret is not base64"); return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64"); }
function httpsOrigin(value: string) { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("origin must be HTTPS"); return url.origin; }
function internalOrigin(value: string, protocols: string[]) { const url = new URL(value); if (!protocols.includes(url.protocol) || !url.hostname || url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) throw new Error("internal media origin is invalid"); return `${url.protocol}//${url.host}`; }
