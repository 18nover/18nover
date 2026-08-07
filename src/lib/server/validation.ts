import type { CameraInput } from "../contracts";
import { AccessError } from "./auth";
import { assertOnlyKeys } from "./http";

const CAMERA_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export function validateCameraId(value: string) {
  if (!CAMERA_ID.test(value)) throw new AccessError(400, "INVALID_CAMERA_ID", "The camera identifier is invalid.");
  return value;
}

export function validateSessionBody(value: Record<string, unknown>) {
  assertOnlyKeys(value, ["cameraId", "profileId", "statusOnly"]);
  const cameraId = optionalString(value.cameraId, 64);
  const profileId = optionalString(value.profileId, 64);
  if (value.statusOnly !== undefined && typeof value.statusOnly !== "boolean") {
    throw new AccessError(400, "INVALID_STATUS_MODE", "Status-only mode must be enabled or disabled.");
  }
  if (cameraId) validateCameraId(cameraId);
  if (profileId && profileId !== "auto") validateCameraId(profileId);
  return { cameraId, profileId, statusOnly: value.statusOnly as boolean | undefined };
}

export function validateCameraInput(value: Record<string, unknown>): CameraInput {
  assertOnlyKeys(value, ["name", "url", "username", "password", "substreamUrl", "transport", "audio"]);
  const name = requiredString(value.name, 64).trim();
  if (name.length < 2) throw new AccessError(400, "INVALID_NAME", "Camera name must contain at least two characters.");
  const url = validateRtspUrl(requiredString(value.url, 4096));
  const username = requiredString(value.username ?? "", 256);
  const password = requiredString(value.password ?? "", 512);
  const substreamUrl = value.substreamUrl ? validateRtspUrl(requiredString(value.substreamUrl, 4096)) : undefined;
  if (value.transport !== "tcp") throw new AccessError(400, "INVALID_TRANSPORT", "This hardened relay accepts RTSP-over-TCP only.");
  if (typeof value.audio !== "boolean") throw new AccessError(400, "INVALID_AUDIO", "Camera audio must be enabled or disabled.");
  return { name, url, username, password, substreamUrl, transport: value.transport, audio: value.audio };
}

export function validateCameraPatch(value: Record<string, unknown>) {
  assertOnlyKeys(value, ["name", "enabled", "username", "password", "url", "substreamUrl", "transport", "audio"]);
  if (!Object.keys(value).length) throw new AccessError(400, "EMPTY_PATCH", "Provide at least one camera change.");
  const secretFields = ["url", "username", "password", "substreamUrl", "transport", "audio"];
  if (secretFields.some((key) => key in value) && !("url" in value && "username" in value && "password" in value)) {
    throw new AccessError(400, "COMPLETE_CREDENTIALS_REQUIRED", "Re-enter the complete source URL, username, and password when replacing camera credentials.");
  }
  const result: Record<string, unknown> = {};
  if ("name" in value) {
    const name = requiredString(value.name, 64).trim();
    if (name.length < 2) throw new AccessError(400, "INVALID_NAME", "Camera name must contain at least two characters.");
    result.name = name;
  }
  if ("enabled" in value) {
    if (typeof value.enabled !== "boolean") throw new AccessError(400, "INVALID_ENABLED", "Enabled must be true or false.");
    result.enabled = value.enabled;
  }
  if ("url" in value) result.url = validateRtspUrl(requiredString(value.url, 4096));
  if ("substreamUrl" in value) result.substreamUrl = value.substreamUrl ? validateRtspUrl(requiredString(value.substreamUrl, 4096)) : null;
  if ("username" in value) result.username = requiredString(value.username, 256);
  if ("password" in value) result.password = requiredString(value.password, 512);
  if ("transport" in value) {
    if (value.transport !== "tcp") throw new AccessError(400, "INVALID_TRANSPORT", "This hardened relay accepts RTSP-over-TCP only.");
    result.transport = value.transport;
  }
  if ("audio" in value) {
    if (typeof value.audio !== "boolean") throw new AccessError(400, "INVALID_AUDIO", "Camera audio must be enabled or disabled.");
    result.audio = value.audio;
  }
  return result;
}

function validateRtspUrl(raw: string) {
  if (/[\r\n\0]/.test(raw) || raw.includes("#") || /%(?![0-9a-f]{2})/i.test(raw)) throw new AccessError(400, "INVALID_RTSP_URL", "The RTSP URL contains unsupported characters.");
  let url: URL;
  try { url = new URL(raw); } catch { throw new AccessError(400, "INVALID_RTSP_URL", "Enter a valid RTSP or RTSPS URL."); }
  if (url.protocol !== "rtsp:" && url.protocol !== "rtsps:") throw new AccessError(400, "INVALID_RTSP_SCHEME", "Only rtsp:// and rtsps:// sources are accepted.");
  if (!url.hostname || url.hash || url.username || url.password) throw new AccessError(400, "INVALID_RTSP_URL", "Enter the source URL without embedded credentials and use the separate username and password fields.");
  const port = url.port ? Number(url.port) : url.protocol === "rtsps:" ? 322 : 554;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new AccessError(400, "INVALID_RTSP_PORT", "The RTSP port is invalid.");
  return raw;
}

function requiredString(value: unknown, maxLength: number) {
  if (typeof value !== "string" || value.length > maxLength || /[\r\n\0]/.test(value)) throw new AccessError(400, "INVALID_TEXT", "A text field is missing or invalid.");
  return value;
}

function optionalString(value: unknown, maxLength: number) {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredString(value, maxLength);
}
