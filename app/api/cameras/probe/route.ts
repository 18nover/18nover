import { requireHost, requireSameOrigin, requireViewer } from "../../../../lib/server/auth";
import { getServerConfig } from "../../../../lib/server/config";
import { apiError, jsonResponse, readJsonObject } from "../../../../lib/server/http";
import { relayRequest, sanitizeProbe } from "../../../../lib/server/relay-client";
import { validateCameraInput } from "../../../../lib/server/validation";

export async function POST(request: Request) {
  try {
    const config = getServerConfig();
    requireSameOrigin(request, config.sitesOrigin);
    const viewer = requireViewer(request, config);
    requireHost(viewer);
    const input = validateCameraInput(await readJsonObject(request));
    const value = await relayRequest(config, "POST", "/api/v1/probes", { ...input, actorId: viewer.id }) as Record<string, unknown>;
    return jsonResponse({ result: sanitizeProbe(value.result ?? value) });
  } catch (error) {
    return apiError(error);
  }
}
