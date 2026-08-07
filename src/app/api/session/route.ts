import { apiError, jsonResponse, readJsonObject } from "../../../lib/server/http";
import { requireSameOrigin, requireViewer } from "../../../lib/server/auth";
import { getServerConfig } from "../../../lib/server/config";
import {
  relayRequest,
  sanitizeCamera,
  sanitizeCredentials,
  sanitizePlayback,
  sanitizeTelemetry,
} from "../../../lib/server/relay-client";
import { validateSessionBody } from "../../../lib/server/validation";

export async function POST(request: Request) {
  try {
    const config = getServerConfig();
    requireSameOrigin(request, config.sitesOrigin);
    const viewer = requireViewer(request, config);
    const input = validateSessionBody(await readJsonObject(request));
    const requestId = crypto.randomUUID();
    const value = await relayRequest(config, "POST", "/api/v1/sessions", {
      cameraId: input.cameraId ?? null,
      profileId: input.profileId ?? "auto",
      viewerId: viewer.id,
      viewerRole: viewer.role,
      requestId,
      statusOnly: input.statusOnly ?? false,
    }) as Record<string, unknown>;

    const cameras = Array.isArray(value.cameras) ? value.cameras.map(sanitizeCamera) : [];
    return jsonResponse({
      viewer,
      cameras,
      playback: sanitizePlayback(value.playback, config.relayOrigin),
      telemetry: sanitizeTelemetry(value.telemetry),
      realtime: sanitizeCredentials(value.realtime, "realtime"),
      voice: sanitizeCredentials(value.voice, "voice"),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return apiError(error);
  }
}
