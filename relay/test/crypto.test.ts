import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { decryptCameraSecret, encryptCameraSecret, endpointFingerprint, redact } from "../src/crypto.js";

const secret = {
  url: "rtsps://camera.invalid/stream?token=write-only",
  username: "reader",
  password: "camera-password",
  transport: "tcp" as const,
  audio: true,
};

test("AES-GCM camera envelope round-trips and binds camera ID as AAD", () => {
  const key = randomBytes(32);
  const envelope = encryptCameraSecret(key, "orbit", secret);
  assert.deepEqual(decryptCameraSecret(key, "orbit", envelope), secret);
  assert.throws(() => decryptCameraSecret(key, "explorer", envelope));
});

test("AES-GCM rejects tampered ciphertext", () => {
  const key = randomBytes(32);
  const envelope = JSON.parse(encryptCameraSecret(key, "orbit", secret)) as { data: string };
  envelope.data = `${envelope.data.slice(0, -2)}aa`;
  assert.throws(() => decryptCameraSecret(key, "orbit", JSON.stringify(envelope)));
});

test("fingerprints are keyed and redaction removes RTSP sources", () => {
  const source = "rtsp://reader:camera-password@camera.invalid:554/live?token=abc";
  assert.notEqual(endpointFingerprint(randomBytes(32), source), endpointFingerprint(randomBytes(32), source));
  const output = redact(`failed to open ${source}`, ["camera-password"]);
  assert.doesNotMatch(output, /reader|camera-password|token=abc|rtsp:\/\//i);
});
