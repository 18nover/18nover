import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";

function writeSecretFiles() {
  const directory = mkdtempSync(join(tmpdir(), "18nover-relay-config-test-"));
  const masterKeyPath = join(directory, "db_master_key");
  const hmacKeysPath = join(directory, "relay_hmac_keys.json");
  const jwtKeyPath = join(directory, "relay_jwt_private_key.pem");
  writeFileSync(masterKeyPath, randomBytes(32).toString("base64"));
  writeFileSync(hmacKeysPath, JSON.stringify({ "sites-v1": randomBytes(32).toString("base64") }));
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  writeFileSync(jwtKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
  return { masterKeyPath, hmacKeysPath, jwtKeyPath };
}

function baseEnv(): NodeJS.ProcessEnv {
  const { masterKeyPath, hmacKeysPath, jwtKeyPath } = writeSecretFiles();
  return {
    RELAY_DB_MASTER_KEY_FILE: masterKeyPath,
    RELAY_HMAC_KEYS_FILE: hmacKeysPath,
    RELAY_JWT_PRIVATE_KEY_FILE: jwtKeyPath,
    RELAY_PUBLIC_ORIGIN: "https://stream.example.com",
    RELAY_SITES_ORIGIN: "https://18nover.example.chatgpt.site",
    RELAY_JWT_ISSUER: "https://stream.example.com",
    RELAY_JWT_AUDIENCE: "mediamtx",
    // Matches the exact values docker-compose.yml sets for the controller service.
    MEDIAMTX_API_ORIGIN: "http://mediamtx:9997",
    MEDIAMTX_RTSP_ORIGIN: "rtsp://mediamtx:8554",
    MEDIAMTX_WHEP_ORIGIN: "http://mediamtx:8889",
  };
}

test("loads successfully with the exact MediaMTX origins docker-compose.yml sets, including the path-less rtsp:// origin", () => {
  const config = loadConfig(baseEnv());
  assert.equal(config.mediaRtspOrigin, "rtsp://mediamtx:8554");
  assert.equal(config.mediaApiOrigin, "http://mediamtx:9997");
  assert.equal(config.mediaWhepOrigin, "http://mediamtx:8889");
});

test("still rejects an internal media origin carrying an actual path", () => {
  const env = { ...baseEnv(), MEDIAMTX_RTSP_ORIGIN: "rtsp://mediamtx:8554/live" };
  assert.throws(() => loadConfig(env), /internal media origin is invalid/);
});

test("still rejects a non-HTTPS Sites origin", () => {
  const env = { ...baseEnv(), RELAY_SITES_ORIGIN: "http://18nover.example.chatgpt.site" };
  assert.throws(() => loadConfig(env), /origin must be HTTPS/);
});
