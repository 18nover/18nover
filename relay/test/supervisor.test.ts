import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import type { Authenticator } from "../src/auth.js";
import type { RelayConfig } from "../src/config.js";
import { TranscoderSupervisor } from "../src/supervisor.js";

test("a third incompatible feed reports transcoder capacity instead of starting", async () => {
  const config = {
    maxTranscoders: 2,
    ffmpegPath: "/bin/true",
    mediaRtspOrigin: "rtsp://mediamtx:8554",
    mediaWhepOrigin: "http://mediamtx:8889",
    masterKey: randomBytes(32),
  } as RelayConfig;
  const auth = {
    issueToken: async () => "test-token",
  } as unknown as Authenticator;
  const supervisor = new TranscoderSupervisor(config, auth, () => undefined);
  try {
    assert.equal(await supervisor.start("orbit:main", "orbit-source", "orbit", true, 1920, 1080), true);
    assert.equal(await supervisor.start("explorer:main", "explorer-source", "explorer", true, 1920, 1080), true);
    assert.equal(await supervisor.start("third:main", "third-source", "third", true, 1920, 1080), false);
    assert.equal(supervisor.activeCount, 2);
  } finally {
    await supervisor.shutdown();
  }
});
