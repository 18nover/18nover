import { requireHost, requireSameOrigin, requireViewer } from "../../../../lib/server/auth";
import { getServerConfig } from "../../../../lib/server/config";
import { apiError, jsonResponse, noContentResponse, readJsonObject } from "../../../../lib/server/http";
import { relayRequest, sanitizeCamera } from "../../../../lib/server/relay-client";
import { validateCameraId, validateCameraPatch } from "../../../../lib/server/validation";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const config = getServerConfig();
    requireSameOrigin(request, config.sitesOrigin);
    const viewer = requireViewer(request, config);
    requireHost(viewer);
    const id = validateCameraId((await context.params).id);
    const input = validateCameraPatch(await readJsonObject(request));
    const value = await relayRequest(config, "PATCH", `/api/v1/cameras/${encodeURIComponent(id)}`, { ...input, actorId: viewer.id }) as Record<string, unknown>;
    return jsonResponse({ camera: sanitizeCamera(value.camera ?? value) });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const config = getServerConfig();
    requireSameOrigin(request, config.sitesOrigin);
    const viewer = requireViewer(request, config);
    requireHost(viewer);
    const id = validateCameraId((await context.params).id);
    await relayRequest(config, "DELETE", `/api/v1/cameras/${encodeURIComponent(id)}`, { actorId: viewer.id });
    return noContentResponse();
  } catch (error) {
    return apiError(error);
  }
}
