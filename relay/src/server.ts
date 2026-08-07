import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Authenticator } from "./auth.js";
import type { CameraInput, CameraService } from "./cameras.js";
import type { RelayConfig } from "./config.js";
import type { MediaMtxClient } from "./mediamtx.js";
import { WhepGateway } from "./whep-gateway.js";

const CAMERA_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const SAFE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export function createRelayServer(config: RelayConfig, auth: Authenticator, cameras: CameraService, media: MediaMtxClient) {
  const limiter = new RateLimiter();
  const whep = new WhepGateway(config, auth);
  return createServer(async (request, response) => {
    const method = request.method?.toUpperCase() ?? "GET";
    const url = new URL(request.url ?? "/", "http://relay.internal");
    try {
      if (method === "GET" && url.pathname === "/healthz") return json(response, 200, { status: "ok" });
      if (method === "GET" && url.pathname === "/readyz") {
        const telemetry = await media.telemetry();
        return json(response, telemetry.network === "healthy" ? 200 : 503, { status: telemetry.network === "healthy" ? "ready" : "not_ready" });
      }
      if (method === "GET" && url.pathname === "/.well-known/jwks.json") return json(response, 200, auth.jwks(), { "Cache-Control": "public, max-age=60" });
      if (await whep.handle(request, response, method, url)) return;
      if (!url.pathname.startsWith("/api/v1/")) return json(response, 404, { error: { code: "NOT_FOUND", message: "Not found." } });
      if (url.search) return json(response, 400, { error: { code: "INVALID_REQUEST", message: "Query parameters are not supported." } });

      const rawBody = await readBody(request);
      if (!auth.verifyRequest(request.headers, method, url.pathname, rawBody)) return json(response, 401, { error: { code: "INVALID_SIGNATURE", message: "Request authentication failed." } });
      const keyId = String(request.headers["x-18nover-key-id"] ?? "unknown");
      if (!limiter.take(`${keyId}:${method}:${routeClass(url.pathname)}`, url.pathname === "/api/v1/sessions" ? 1_200 : url.pathname === "/api/v1/probes" ? 5 : 30)) {
        return json(response, 429, { error: { code: "RATE_LIMITED", message: "Too many requests." } });
      }
      const body = parseObject(rawBody);

      if (method === "POST" && url.pathname === "/api/v1/probes") {
        const input = cameraInput(body);
        const result = await cameras.probeUnsaved(input);
        return json(response, 200, { result });
      }
      if (method === "POST" && url.pathname === "/api/v1/cameras") {
        const input = cameraInput(body);
        const actorId = text(body.actorId, 256);
        try {
          const camera = await cameras.create(input);
          cameras.audit(actorId, camera.id, "create", "success");
          return json(response, 201, { camera });
        } catch (error) {
          cameras.audit(actorId, null, "create", "failure", errorCode(error));
          throw error;
        }
      }
      if (method === "POST" && url.pathname === "/api/v1/sessions") {
        assertKeys(body, ["cameraId", "profileId", "viewerId", "viewerRole", "requestId", "statusOnly"]);
        const viewerId = text(body.viewerId, 256);
        const viewerRole = text(body.viewerRole, 16);
        if (!["member", "moderator", "host"].includes(viewerRole)) throw requestError("INVALID_VIEWER");
        if (body.statusOnly !== undefined && typeof body.statusOnly !== "boolean") throw requestError("INVALID_STATUS_MODE");
        if (!limiter.take(`${keyId}:session-viewer:${viewerId}`, 30)) {
          return json(response, 429, { error: { code: "RATE_LIMITED", message: "Too many session requests." } });
        }
        await cameras.refreshStatuses();
        const cameraId = body.cameraId === null || body.cameraId === undefined ? null : cameraIdValue(body.cameraId);
        const profileId = body.profileId === undefined ? "auto" : text(body.profileId, 64);
        const selected = cameraId ? cameras.list().find((camera) => camera.id === cameraId) ?? null : cameras.list().find((camera) => camera.state === "online") ?? null;
        const playback = selected && body.statusOnly !== true ? await cameras.playback(selected.id, profileId, viewerId) : null;
        const network = await media.telemetry();
        return json(response, 200, {
          cameras: cameras.list(),
          playback,
          telemetry: {
            viewers: network.viewers,
            voiceMembers: 0,
            bitrateMbps: selected?.bitrateKbps ? Math.round(selected.bitrateKbps / 10) / 100 : null,
            latencySeconds: null,
            fps: selected?.fps ?? null,
            cpuPercent: null,
            network: network.network,
            uptimeSeconds: selected ? cameras.uptime(selected.id) : 0,
          },
          realtime: null,
          voice: null,
        });
      }

      const retest = url.pathname.match(/^\/api\/v1\/cameras\/([a-zA-Z0-9_-]+)\/probe$/);
      if (method === "POST" && retest) {
        assertKeys(body, ["actorId"]);
        const cameraId = cameraIdValue(retest[1]);
        const actorId = text(body.actorId, 256);
        try {
          const result = await cameras.retest(cameraId);
          cameras.audit(actorId, cameraId, "retest", "success");
          return json(response, 200, result);
        } catch (error) {
          cameras.audit(actorId, cameraId, "retest", "failure", errorCode(error));
          throw error;
        }
      }
      const cameraRoute = url.pathname.match(/^\/api\/v1\/cameras\/([a-zA-Z0-9_-]+)$/);
      if (cameraRoute && method === "PATCH") {
        assertKeys(body, ["name", "enabled", "url", "username", "password", "substreamUrl", "transport", "audio", "actorId"]);
        const cameraId = cameraIdValue(cameraRoute[1]);
        const actorId = text(body.actorId, 256);
        const { actorId: _actorId, ...changes } = body;
        try {
          const camera = await cameras.patch(cameraId, changes);
          cameras.audit(actorId, cameraId, "patch", "success");
          return json(response, 200, { camera });
        } catch (error) {
          cameras.audit(actorId, cameraId, "patch", "failure", errorCode(error));
          throw error;
        }
      }
      if (cameraRoute && method === "DELETE") {
        assertKeys(body, ["actorId"]);
        const cameraId = cameraIdValue(cameraRoute[1]);
        const actorId = text(body.actorId, 256);
        try {
          await cameras.remove(cameraId);
          cameras.audit(actorId, cameraId, "delete", "success");
        } catch (error) {
          cameras.audit(actorId, cameraId, "delete", "failure", errorCode(error));
          throw error;
        }
        response.writeHead(204, {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
        });
        return response.end();
      }
      return json(response, 404, { error: { code: "NOT_FOUND", message: "Not found." } });
    } catch (error) {
      return safeError(response, error);
    }
  });
}

class RateLimiter {
  private readonly buckets = new Map<string, number[]>();
  take(key: string, limit: number) {
    const now = Date.now();
    const recent = (this.buckets.get(key) ?? []).filter((time) => now - time < 60_000);
    if (recent.length >= limit) { this.buckets.set(key, recent); return false; }
    recent.push(now);
    this.buckets.set(key, recent);
    return true;
  }
}

async function readBody(request: IncomingMessage) {
  const announced = Number(request.headers["content-length"] ?? 0);
  if (announced > 16_384) throw requestError("REQUEST_TOO_LARGE");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.byteLength;
    if (size > 16_384) throw requestError("REQUEST_TOO_LARGE");
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function parseObject(value: string) { let parsed: unknown; try { parsed = JSON.parse(value || "{}"); } catch { throw requestError("INVALID_JSON"); } if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw requestError("INVALID_BODY"); return parsed as Record<string, unknown>; }
function cameraInput(body: Record<string, unknown>): CameraInput {
  assertKeys(body, ["name", "url", "username", "password", "substreamUrl", "transport", "audio", "actorId"]);
  if (body.transport !== "tcp") throw requestError("INVALID_TRANSPORT");
  const transport: "tcp" = body.transport;
  if (typeof body.audio !== "boolean") throw requestError("INVALID_AUDIO");
  const name = text(body.name, 64).trim();
  if (name.length < 2) throw requestError("INVALID_NAME");
  return { name, url: text(body.url, 4096), username: text(body.username ?? "", 256, true), password: text(body.password ?? "", 512, true), ...(body.substreamUrl ? { substreamUrl: text(body.substreamUrl, 4096) } : {}), transport, audio: body.audio };
}
function text(value: unknown, max: number, allowEmpty = false) { if (typeof value !== "string" || value.length > max || (!allowEmpty && !value) || /[\r\n\0]/.test(value)) throw requestError("INVALID_TEXT"); return value; }
function cameraIdValue(value: unknown) { const id = text(value, 64); if (!CAMERA_ID.test(id)) throw requestError("INVALID_CAMERA_ID"); return id; }
function assertKeys(body: Record<string, unknown>, allowed: string[]) { if (Object.keys(body).some((key) => !allowed.includes(key))) throw requestError("UNKNOWN_FIELD"); }
function requestError(code: string) { const error = new Error(code); error.name = "RequestError"; return error; }
function errorCode(error: unknown) { return error instanceof Error ? error.message : "INTERNAL_ERROR"; }
function routeClass(path: string) { return path.replace(/[a-zA-Z0-9][a-zA-Z0-9_-]{7,}/g, ":id"); }

function safeError(response: ServerResponse, error: unknown) {
  const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
  const requestCodes = new Set(["INVALID_JSON", "INVALID_BODY", "INVALID_TEXT", "INVALID_NAME", "INVALID_CAMERA_NAME", "INVALID_TRANSPORT", "INVALID_AUDIO", "INVALID_CAMERA_ID", "UNKNOWN_FIELD", "REQUEST_TOO_LARGE", "INVALID_VIEWER", "INVALID_STATUS_MODE"]);
  if (requestCodes.has(code)) return json(response, code === "REQUEST_TOO_LARGE" ? 413 : 400, { error: { code, message: "The request is invalid." } });
  if (code === "CAMERA_NOT_FOUND" || code === "PROFILE_NOT_FOUND") return json(response, 404, { error: { code, message: "The camera or profile was not found." } });
  if (["CAMERA_LIMIT", "CAMERA_DUPLICATE", "WARM_CAMERA_CAPACITY", "TRANSCODER_CAPACITY", "TRANSCODER_UNAVAILABLE", "PROBE_CAPACITY"].includes(code)) return json(response, 409, { error: { code, message: "Relay capacity or an existing camera prevents this request." } });
  if (["INVALID_RTSP_URL", "INVALID_RTSP_SCHEME", "CAMERA_PORT_NOT_APPROVED", "CAMERA_ADDRESS_NOT_GLOBAL", "DNS_TIMEOUT", "CAMERA_UNREACHABLE", "NO_VIDEO_TRACK", "PROBE_FAILED", "PROBE_OUTPUT_LIMIT", "INVALID_MEDIA_METADATA", "COMPLETE_CREDENTIALS_REQUIRED", "CAMERA_UNAVAILABLE", "SUBSTREAM_UNAVAILABLE", "PROFILE_UNAVAILABLE"].includes(code)) return json(response, 422, { error: { code, message: "The camera source could not be validated or played." } });
  if (code === "RATE_LIMITED") return json(response, 429, { error: { code, message: "Too many requests." } });
  return json(response, 500, { error: { code: "INTERNAL_ERROR", message: "The relay could not complete the request." } });
}

function json(response: ServerResponse, status: number, value: unknown, extra: Record<string, string> = {}) {
  response.writeHead(status, { ...SAFE_HEADERS, ...extra });
  response.end(JSON.stringify(value));
}
