import assert from "node:assert/strict";
import { createHash, createHmac, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { decodeProtectedHeader, errors, importSPKI, jwtVerify } from "jose";
import { Authenticator } from "../src/auth.js";
import type { RelayConfig } from "../src/config.js";
import { RelayDatabase } from "../src/db.js";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "18nover-auth-test-"));
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const hmacKey = randomBytes(32);
  const config: RelayConfig = {
    port: 8080,
    dbPath: join(directory, "relay.sqlite"),
    masterKey: randomBytes(32),
    hmacKeys: new Map([["sites-v1", hmacKey]]),
    jwtPrivateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    jwtIssuer: "https://stream.example.com",
    jwtAudience: "mediamtx",
    publicOrigin: "https://stream.example.com",
    sitesOrigin: "https://18nover.example.com",
    mediaApiOrigin: "http://mediamtx:9997",
    mediaRtspOrigin: "rtsp://mediamtx:8554",
    mediaWhepOrigin: "http://mediamtx:8889",
    allowedPorts: new Set([554, 8554]),
    maxCameras: 8,
    maxWarmCameras: 4,
    maxTranscoders: 2,
    ffprobePath: "/usr/bin/ffprobe",
    ffmpegPath: "/usr/bin/ffmpeg",
  };
  const db = new RelayDatabase(config.dbPath);
  const auth = new Authenticator(config, db);
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  return { auth, config, db, hmacKey, publicKeyPem };
}

function signedHeaders(key: Buffer, method: string, path: string, body: string, timestamp = String(Math.floor(Date.now() / 1000))) {
  const nonce = randomBytes(16).toString("base64url");
  const digest = createHash("sha256").update(body).digest("hex");
  const canonical = `v1\n${timestamp}\n${nonce}\n${method}\n${path}\n${digest}`;
  return {
    "x-18nover-key-id": "sites-v1",
    "x-18nover-timestamp": timestamp,
    "x-18nover-nonce": nonce,
    "x-18nover-signature": createHmac("sha256", key).update(canonical).digest("base64url"),
  };
}

test("HMAC authentication binds method, path, body and a one-time nonce", async () => {
  const { auth, db, hmacKey } = fixture();
  try {
    await auth.initialize();
    const body = JSON.stringify({ cameraId: "orbit" });
    const headers = signedHeaders(hmacKey, "POST", "/api/v1/sessions", body);
    assert.equal(auth.verifyRequest(headers, "POST", "/api/v1/sessions", body), true);
    assert.equal(auth.verifyRequest(headers, "POST", "/api/v1/sessions", body), false, "nonce replay");
    assert.equal(auth.verifyRequest(signedHeaders(hmacKey, "POST", "/api/v1/sessions", body), "PATCH", "/api/v1/sessions", body), false, "method tamper");
    assert.equal(auth.verifyRequest(signedHeaders(hmacKey, "POST", "/api/v1/sessions", body), "POST", "/api/v1/cameras", body), false, "path tamper");
    assert.equal(auth.verifyRequest(signedHeaders(hmacKey, "POST", "/api/v1/sessions", body, String(Math.floor(Date.now() / 1000) - 31)), "POST", "/api/v1/sessions", body), false, "clock skew");
  } finally {
    db.close();
  }
});

test("a future-dated request cannot be replayed while its signature is still inside the accepted skew", async () => {
  const { auth, db, hmacKey } = fixture();
  const originalNow = Date.now;
  const base = Math.floor(originalNow() / 1000) * 1000;
  try {
    await auth.initialize();
    Date.now = () => base;
    const body = "{}";
    const headers = signedHeaders(hmacKey, "POST", "/api/v1/sessions", body, String(base / 1000 + 30));
    assert.equal(auth.verifyRequest(headers, "POST", "/api/v1/sessions", body), true);
    Date.now = () => base + 36_000;
    assert.equal(auth.verifyRequest(headers, "POST", "/api/v1/sessions", body), false, "nonce remains reserved for the future timestamp acceptance window");
  } finally {
    Date.now = originalNow;
    db.close();
  }
});

test("ES256 viewer tokens expose only one exact read permission and expire", async () => {
  const { auth, config, db, publicKeyPem } = fixture();
  try {
    await auth.initialize();
    const token = await auth.issueToken("viewer-1", "read", "camera-orbit", 300);
    assert.equal(decodeProtectedHeader(token).alg, "ES256");
    const key = await importSPKI(publicKeyPem, "ES256");
    const { payload } = await jwtVerify(token, key, { issuer: config.jwtIssuer, audience: config.jwtAudience });
    assert.equal(payload.sub, "viewer-1");
    assert.deepEqual(payload.mediamtx_permissions, [{ action: "read", path: "camera-orbit" }]);
    assert.ok(Number(payload.exp) - Number(payload.iat) <= 300);

    const expired = await auth.issueToken("viewer-1", "read", "camera-orbit", -1);
    await assert.rejects(jwtVerify(expired, key, { issuer: config.jwtIssuer, audience: config.jwtAudience }), errors.JWTExpired);
    const jwks = auth.jwks() as { keys: Array<Record<string, unknown>> };
    assert.equal(jwks.keys.length, 1);
    assert.equal("d" in jwks.keys[0]!, false, "JWKS must not expose a private key");
  } finally {
    db.close();
  }
});

test("viewer WHEP credentials are exact-path, single-use, and capped at three active sessions", async () => {
  const { auth, db } = fixture();
  try {
    await auth.initialize();
    const tokens = await Promise.all(Array.from({ length: 4 }, () => auth.issueViewerToken("viewer-1", "camera-orbit", 300)));
    assert.equal(auth.consumeViewerToken(tokens[0]!, "camera-explorer"), null, "wrong path");
    const first = auth.consumeViewerToken(tokens[0]!, "camera-orbit");
    const second = auth.consumeViewerToken(tokens[1]!, "camera-orbit");
    const third = auth.consumeViewerToken(tokens[2]!, "camera-orbit");
    assert.ok(first && second && third);
    assert.equal(auth.consumeViewerToken(tokens[0]!, "camera-orbit"), null, "single use");
    assert.equal(auth.consumeViewerToken(tokens[3]!, "camera-orbit"), null, "active-session cap");
    auth.releaseViewerGrant(first.key);
    assert.ok(auth.consumeViewerToken(tokens[3]!, "camera-orbit"), "capacity returns after resource cleanup");
  } finally {
    db.close();
  }
});
