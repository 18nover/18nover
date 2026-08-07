import type { Authenticator } from "./auth.js";
import type { RelayConfig } from "./config.js";

export class MediaMtxClient {
  constructor(private readonly config: RelayConfig, private readonly auth: Authenticator) {}

  async ensurePullPath(path: string, source: string, _transport: "tcp" | "udp" = "tcp", sourceFingerprint?: string) {
    await this.upsertPath(path, {
      source,
      sourceOnDemand: false,
      sourceFingerprint: sourceFingerprint ?? "",
      rtspTransport: "tcp",
      rtspAnyPort: false,
      maxReaders: 100,
    });
  }

  async ensurePublisherPath(path: string) {
    await this.upsertPath(path, { source: "publisher", overridePublisher: false, maxReaders: 100 });
  }

  async deletePath(path: string) {
    const response = await this.request("DELETE", `/v3/config/paths/delete/${encodeURIComponent(path)}`);
    if (!response.ok && response.status !== 404) throw new Error("media path deletion failed");
  }

  async waitReady(path: string, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const response = await this.request("GET", `/v3/paths/get/${encodeURIComponent(path)}`);
      if (response.ok) {
        const value = await response.json() as { online?: boolean; ready?: boolean };
        if (value.online ?? value.ready) return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    return false;
  }

  async pathStats(path: string) {
    const response = await this.request("GET", `/v3/paths/get/${encodeURIComponent(path)}`);
    if (!response.ok) return { online: false, onlineTime: null, inboundBytes: 0 };
    const value = await response.json() as { online?: boolean; ready?: boolean; onlineTime?: string | null; readyTime?: string | null; inboundBytes?: number; bytesReceived?: number };
    return {
      online: Boolean(value.online ?? value.ready),
      onlineTime: validDate(value.onlineTime ?? value.readyTime),
      inboundBytes: finiteNonNegative(value.inboundBytes ?? value.bytesReceived),
    };
  }

  async telemetry() {
    const response = await this.request("GET", "/v3/paths/list");
    if (!response.ok) return { viewers: 0, network: "degraded" as const };
    const value = await response.json() as { items?: Array<{ readers?: Array<{ type?: string }> }> };
    const viewers = (value.items ?? []).reduce((sum, item) => sum + (item.readers ?? []).filter((reader) => reader.type === "webRTCSession").length, 0);
    return { viewers, network: "healthy" as const };
  }

  private async upsertPath(path: string, value: Record<string, unknown>) {
    const add = await this.request("POST", `/v3/config/paths/add/${encodeURIComponent(path)}`, value);
    if (add.ok) return;
    if (add.status !== 400 && add.status !== 409) throw new Error("media path activation failed");
    const patch = await this.request("PATCH", `/v3/config/paths/patch/${encodeURIComponent(path)}`, value);
    if (!patch.ok) throw new Error("media path activation failed");
  }

  private async request(method: string, path: string, body?: Record<string, unknown>) {
    const token = await this.auth.issueToken("relay-controller", "api", "", 60);
    const init: RequestInit = {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(2_000),
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
    };
    if (body) init.body = JSON.stringify(body);
    return fetch(`${this.config.mediaApiOrigin}${path}`, init);
  }
}

function validDate(value: unknown) { return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null; }
function finiteNonNegative(value: unknown) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : 0; }
