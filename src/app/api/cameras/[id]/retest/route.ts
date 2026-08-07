import { requireHost, requireSameOrigin, requireViewer } from "../../../../../lib/server/auth";
import { getServerConfig } from "../../../../../lib/server/config";
import { apiError, jsonResponse, readJsonObject } from "../../../../../lib/server/http";
import { relayRequest, sanitizeCamera, sanitizeProbe } from "../../../../../lib/server/relay-client";
import { validateCameraId } from "../../../../../lib/server/validation";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const config = getServerConfig();
    requireSameOrigin(request, config.sitesOrigin);
    const viewer = requireViewer(request, config);
    requireHost(viewer);
    const body = await readJsonObject(request);
    if (Object.keys(body).length) return jsonResponse({ error: { code: "INVALID_BODY", message: "Retest does not accept camera source data." } }, { status: 400 });
    const id = validateCameraId((await context.params).id);
    const value = await relayRequest(config, "POST", `/api/v1/cameras/${encodeURIComponent(id)}/probe`, { actorId: viewer.id }) as Record<string, unknown>;
    return jsonResponse({ camera: sanitizeCamera(value.camera), result: sanitizeProbe(value.result) });
  } catch (error) {
    return apiError(error);
  }
}
