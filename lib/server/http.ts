import { AccessError } from "./auth";
import { ConfigurationError } from "./config";
import { RelayError } from "./relay-client";

export const PRIVATE_HEADERS = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export function jsonResponse(value: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  Object.entries(PRIVATE_HEADERS).forEach(([name, headerValue]) => headers.set(name, headerValue));
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { ...init, headers });
}

export function noContentResponse() {
  return new Response(null, { status: 204, headers: PRIVATE_HEADERS });
}

export async function readJsonObject(request: Request, maxBytes = 16_384): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new AccessError(415, "JSON_REQUIRED", "Send the request as application/json.");
  const announced = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(announced) && announced > maxBytes) throw new AccessError(413, "REQUEST_TOO_LARGE", "The request is too large.");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new AccessError(413, "REQUEST_TOO_LARGE", "The request is too large.");
  let value: unknown;
  try { value = JSON.parse(text || "{}"); } catch { throw new AccessError(400, "INVALID_JSON", "The request body is not valid JSON."); }
  if (!isPlainObject(value)) throw new AccessError(400, "INVALID_BODY", "The request body must be an object.");
  return value;
}

export function apiError(error: unknown) {
  if (error instanceof AccessError) return jsonResponse({ error: { code: error.code, message: error.message } }, { status: error.status });
  if (error instanceof ConfigurationError) return jsonResponse({ error: { code: "SERVICE_UNAVAILABLE", message: "The secure relay is not configured." } }, { status: 503 });
  if (error instanceof RelayError) return jsonResponse({ error: { code: error.code, message: error.safeMessage } }, { status: error.status });
  return jsonResponse({ error: { code: "INTERNAL_ERROR", message: "The request could not be completed." } }, { status: 500 });
}

export function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new AccessError(400, "UNKNOWN_FIELD", "The request contains an unsupported field.");
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
