import type { IncomingMessage, ServerResponse } from "node:http";
import type { Authenticator } from "./auth.js";
import type { RelayConfig } from "./config.js";

const CREATE_PATH = /^\/whep\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/whep$/;
const RESOURCE_PATH = /^\/whep\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/whep\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/;
const MAX_SDP_BYTES = 256_000;
const WHEP_LEASE_MS = 10 * 60_000;

export class WhepGateway {
  private readonly resources = new Map<string, { grantKey: string; internalPath: string; cameraPath: string; expiresAt: number }>();

  constructor(private readonly config: RelayConfig, private readonly auth: Authenticator) {}

  async handle(request: IncomingMessage, response: ServerResponse, method: string, url: URL) {
    if (!url.pathname.startsWith("/whep/")) return false;
    await this.cleanupExpiredResources();
    if (url.search) return this.fail(response, 400, "Invalid WHEP request."), true;
    if (request.headers.origin !== this.config.sitesOrigin) return this.fail(response, 403, "Origin is not allowed."), true;
    this.cors(response);

    if (method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return true;
    }

    const create = url.pathname.match(CREATE_PATH);
    if (method === "POST" && create) {
      await this.create(request, response, create[1]!);
      return true;
    }
    const resource = url.pathname.match(RESOURCE_PATH);
    if (method === "HEAD" && resource) {
      this.keepAlive(request, response, url.pathname);
      return true;
    }
    if (method === "DELETE" && resource) {
      await this.remove(request, response, url.pathname, resource[1]!, resource[2]!);
      return true;
    }
    this.fail(response, 404, "WHEP resource not found.");
    return true;
  }

  private async create(request: IncomingMessage, response: ServerResponse, path: string) {
    const token = bearer(request);
    if (!token || request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/sdp") return this.fail(response, 401, "Playback authorization failed.");
    const grant = this.auth.consumeViewerToken(token, path);
    if (!grant) return this.fail(response, 429, "Playback session limit reached or credential already used.");

    try {
      const offer = await readBoundedRequest(request);
      const internalUrl = `${this.config.mediaWhepOrigin}/${path}/whep`;
      const upstream = await fetch(internalUrl, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/sdp" },
        body: offer,
      });
      const answer = await readBoundedResponse(upstream);
      if (upstream.status !== 201) throw new Error("WHEP_CREATE_FAILED");
      const location = upstream.headers.get("Location");
      if (!location) throw new Error("WHEP_LOCATION_MISSING");
      const internalResource = new URL(location, internalUrl);
      const expectedPrefix = `/${path}/whep/`;
      const resourceId = internalResource.pathname.startsWith(expectedPrefix) ? internalResource.pathname.slice(expectedPrefix.length) : "";
      if (internalResource.origin !== this.config.mediaWhepOrigin || internalResource.search || internalResource.hash || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(resourceId)) throw new Error("WHEP_LOCATION_INVALID");
      const publicPath = `/whep/${path}/whep/${resourceId}`;
      this.resources.set(publicPath, { grantKey: grant.key, internalPath: internalResource.pathname, cameraPath: path, expiresAt: grant.leaseExpiresAt });
      response.writeHead(201, {
        "Cache-Control": "no-store",
        "Content-Type": "application/sdp",
        Location: `${this.config.publicOrigin}${publicPath}`,
        "X-Content-Type-Options": "nosniff",
      });
      response.end(answer);
    } catch {
      this.auth.releaseViewerGrant(grant.key);
      this.fail(response, 502, "The media relay could not create a playback session.");
    }
  }

  private async remove(request: IncomingMessage, response: ServerResponse, publicPath: string, path: string, resourceId: string) {
    const token = bearer(request);
    const resource = this.resources.get(publicPath);
    if (!token || !resource || !this.auth.matchesViewerToken(token, resource.grantKey) || resource.internalPath !== `/${path}/whep/${resourceId}`) return this.fail(response, 404, "WHEP resource not found.");
    this.resources.delete(publicPath);
    this.auth.releaseViewerGrant(resource.grantKey);
    try {
      const cleanupToken = await this.auth.issueToken("whep-cleanup", "read", path, 60);
      await fetch(`${this.config.mediaWhepOrigin}${resource.internalPath}`, {
        method: "DELETE",
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
        headers: { Authorization: `Bearer ${cleanupToken}` },
      });
    } catch {
      // Local ownership is released; MediaMTX session expiry is the cleanup fallback.
    }
    response.writeHead(204, { "Cache-Control": "no-store" });
    response.end();
  }

  private cors(response: ServerResponse) {
    response.setHeader("Access-Control-Allow-Origin", this.config.sitesOrigin);
    response.setHeader("Access-Control-Allow-Methods", "POST, HEAD, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    response.setHeader("Access-Control-Expose-Headers", "Location");
    response.setHeader("Vary", "Origin");
  }

  private keepAlive(request: IncomingMessage, response: ServerResponse, publicPath: string) {
    const token = bearer(request);
    const resource = this.resources.get(publicPath);
    if (!token || !resource || !this.auth.matchesViewerToken(token, resource.grantKey)) return this.fail(response, 404, "WHEP resource not found.");
    resource.expiresAt = Date.now() + WHEP_LEASE_MS;
    this.auth.touchViewerGrant(resource.grantKey, resource.expiresAt);
    response.writeHead(204, { "Cache-Control": "no-store" });
    response.end();
  }

  private async cleanupExpiredResources() {
    const now = Date.now();
    for (const [path, resource] of this.resources) {
      if (resource.expiresAt <= now) {
        this.resources.delete(path);
        this.auth.releaseViewerGrant(resource.grantKey);
        try {
          const cleanupToken = await this.auth.issueToken("whep-cleanup", "read", resource.cameraPath, 60);
          await fetch(`${this.config.mediaWhepOrigin}${resource.internalPath}`, {
            method: "DELETE",
            redirect: "error",
            signal: AbortSignal.timeout(5_000),
            headers: { Authorization: `Bearer ${cleanupToken}` },
          });
        } catch {
          // ICE/session expiry remains the final cleanup boundary.
        }
      }
    }
  }

  private fail(response: ServerResponse, status: number, message: string) {
    if (response.headersSent) return response.end();
    response.writeHead(status, { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
    response.end(message);
  }
}

function bearer(request: IncomingMessage) {
  const value = request.headers.authorization;
  const match = typeof value === "string" ? value.match(/^Bearer ([A-Za-z0-9._~-]{64,8192})$/) : null;
  return match?.[1] ?? null;
}

async function readBoundedRequest(request: IncomingMessage) {
  const announced = request.headers["content-length"];
  if (announced !== undefined && (!/^\d+$/.test(announced) || Number(announced) > MAX_SDP_BYTES)) throw new Error("WHEP_BODY_INVALID");
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_SDP_BYTES) throw new Error("WHEP_BODY_INVALID");
    chunks.push(buffer);
  }
  if (!total) throw new Error("WHEP_BODY_INVALID");
  return Buffer.concat(chunks);
}

async function readBoundedResponse(response: Response) {
  const announced = response.headers.get("Content-Length");
  if (announced !== null && (!/^\d+$/.test(announced) || Number(announced) > MAX_SDP_BYTES)) throw new Error("WHEP_BODY_INVALID");
  if (!response.body) throw new Error("WHEP_BODY_INVALID");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_SDP_BYTES) { await reader.cancel(); throw new Error("WHEP_BODY_INVALID"); }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}
