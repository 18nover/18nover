import type { ViewerIdentity, ViewerRole } from "../contracts";
import type { ServerConfig } from "./config";

export class AccessError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function requireSameOrigin(request: Request, configuredOrigin?: string) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") throw new AccessError(403, "CROSS_ORIGIN", "Cross-origin requests are not allowed.");

  const expected = configuredOrigin ?? requestUrl.origin;
  if (!origin || origin !== expected) throw new AccessError(403, "INVALID_ORIGIN", "The request origin is not allowed.");
}

export function requireViewer(request: Request, config: ServerConfig): ViewerIdentity {
  const userId = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  if (userId && email) {
    const displayName = decodeName(encodedName) ?? email;
    const role: ViewerRole | null = config.hostUserIds.has(userId)
      ? "host"
      : config.moderatorUserIds.has(userId)
        ? "moderator"
        : config.memberUserIds.has(userId)
          ? "member"
          : null;
    if (!role) throw new AccessError(403, "MEMBERSHIP_REQUIRED", "This Sites identity is not a member of 18nover.");
    return { id: userId, displayName, role };
  }

  const dev = getExplicitDevViewer(request);
  if (dev) return dev;
  throw new AccessError(401, "AUTH_REQUIRED", "Sign in to access 18nover.");
}

export function requireHost(viewer: ViewerIdentity) {
  if (viewer.role !== "host") throw new AccessError(403, "HOST_REQUIRED", "Only a Host can manage camera sources.");
}

function getExplicitDevViewer(request: Request): ViewerIdentity | null {
  if (process.env.NODE_ENV === "production" || process.env.NOVER_DEV_AUTH_ENABLED !== "true") return null;
  const url = new URL(request.url);
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1" && url.hostname !== "[::1]") return null;
  const id = process.env.NOVER_DEV_USER_ID;
  const name = process.env.NOVER_DEV_USER_NAME;
  const role = process.env.NOVER_DEV_USER_ROLE;
  if (!id || !name || (role !== "host" && role !== "member" && role !== "moderator")) return null;
  return { id, displayName: name, role };
}

function decodeName(value: string | null) {
  if (!value) return null;
  try { return decodeURIComponent(value); } catch { return null; }
}
