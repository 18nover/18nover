import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { encryptCameraSecret } from "../src/crypto.js";
import { RelayDatabase, toSummary } from "../src/db.js";
import type { CameraRecord } from "../src/types.js";

test("HMAC nonces can be reserved exactly once inside the replay window", () => {
  const directory = mkdtempSync(join(tmpdir(), "18nover-relay-test-"));
  const db = new RelayDatabase(join(directory, "test.sqlite"));
  try {
    const expires = Math.floor(Date.now() / 1000) + 35;
    assert.equal(db.reserveNonce("sites", "nonce", expires), true);
    assert.equal(db.reserveNonce("sites", "nonce", expires), false);
    assert.equal(db.reserveNonce("sites", "another", expires), true);
  } finally {
    db.close();
  }
});

test("camera restart metadata persists without plaintext source material and summaries strip internal paths", () => {
  const directory = mkdtempSync(join(tmpdir(), "18nover-relay-test-"));
  const path = join(directory, "test.sqlite");
  const db = new RelayDatabase(path);
  const key = randomBytes(32);
  const source = "rtsp://camera.example.invalid/private?token=vendor-secret";
  const now = new Date().toISOString();
  const record: CameraRecord = {
    id: "orbit",
    name: "Orbit",
    encryptedSecret: encryptCameraSecret(key, "orbit", { url: source, username: "reader", password: "read-only", transport: "tcp", audio: true }),
    sourceFingerprint: "keyed-fingerprint",
    state: "connecting",
    relayMode: "transcoded",
    inputCodec: "hevc",
    profiles: [{ id: "main", label: "1080p", width: 1920, height: 1080, bitrateKbps: 5400, path: "camera-orbit", relayMode: "transcoded" }],
    width: 1920,
    height: 1080,
    fps: 30,
    bitrateKbps: 5400,
    audio: true,
    lastFrameAt: now,
    errorCode: null,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
  try {
    db.insert(record);
    const restored = db.get("orbit");
    assert.ok(restored);
    assert.deepEqual(toSummary(restored).profiles, [{ id: "main", label: "1080p", width: 1920, height: 1080, bitrateKbps: 5400 }]);
    assert.doesNotMatch(JSON.stringify(toSummary(restored)), /rtsp|vendor-secret|read-only|camera-orbit/i);
  } finally {
    db.close();
  }
  assert.doesNotMatch(readFileSync(path, "latin1"), /rtsp|vendor-secret|read-only/i);
});
