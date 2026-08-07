import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { CameraSecret } from "./types.js";

const VERSION = 1;

export function encryptCameraSecret(key: Buffer, cameraId: string, value: CameraSecret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`camera:${cameraId}:v${VERSION}`));
  const plaintext = Buffer.from(JSON.stringify(value));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return JSON.stringify({ v: VERSION, iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), data: ciphertext.toString("base64url") });
}

export function decryptCameraSecret(key: Buffer, cameraId: string, envelope: string): CameraSecret {
  let parsed: { v: number; iv: string; tag: string; data: string };
  try { parsed = JSON.parse(envelope) as typeof parsed; } catch { throw new Error("encrypted camera secret is invalid"); }
  if (parsed.v !== VERSION || !parsed.iv || !parsed.tag || !parsed.data) throw new Error("encrypted camera secret is invalid");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parsed.iv, "base64url"));
  decipher.setAAD(Buffer.from(`camera:${cameraId}:v${VERSION}`));
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(parsed.data, "base64url")), decipher.final()]);
  const value = JSON.parse(plaintext.toString("utf8")) as CameraSecret;
  if (!value || typeof value.url !== "string" || typeof value.username !== "string" || typeof value.password !== "string") throw new Error("decrypted camera secret is invalid");
  return value;
}

export function endpointFingerprint(key: Buffer, normalizedSecret: string) {
  return createHmac("sha256", key).update("camera-endpoint\0").update(normalizedSecret).digest("base64url");
}

export function verifyHmac(key: Buffer, value: string, signature: string) {
  let supplied: Buffer;
  try { supplied = Buffer.from(signature, "base64url"); } catch { return false; }
  const expected = createHmac("sha256", key).update(value).digest();
  return expected.byteLength === supplied.byteLength && timingSafeEqual(expected, supplied);
}

export function redact(value: string, secrets: string[] = []) {
  let result = value.replace(/rtsps?:\/\/[^\s"']+/gi, "[REDACTED_RTSP]");
  for (const secret of secrets.filter((entry) => entry.length >= 3)) result = result.split(secret).join("[REDACTED]");
  return result.replace(/[\r\n\0]+/g, " ").slice(0, 512);
}
