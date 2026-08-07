import assert from "node:assert/strict";
import test from "node:test";
import { isGlobalAddress, validateAndPinRtsp } from "../src/network.js";

test("accepts globally routable addresses", () => {
  assert.equal(isGlobalAddress("8.8.8.8"), true);
  assert.equal(isGlobalAddress("2606:4700:4700::1111"), true);
});

test("rejects private, loopback, link-local, documentation, multicast and mapped addresses", () => {
  for (const address of [
    "127.0.0.1",
    "10.10.10.10",
    "172.16.1.1",
    "192.168.1.1",
    "169.254.169.254",
    "224.0.0.1",
    "192.0.2.2",
    "203.0.113.20",
    "::1",
    "fe80::1",
    "fc00::1",
    "ff02::1",
    "2001:db8::1",
    "64:ff9b::c000:0201",
    "2002:c0a8:0101::1",
    "3fff::1",
    "::ffff:127.0.0.1",
  ]) assert.equal(isGlobalAddress(address), false, address);
});

test("normalizes an approved source to an explicit pinned address without embedded input credentials", async () => {
  const result = await validateAndPinRtsp("rtsp://8.8.8.8/live?channel=1", "reader", "read-only", new Set([554, 8554]));
  assert.equal(result.address, "8.8.8.8");
  assert.equal(result.port, 554);
  assert.equal(result.pinned, "rtsp://reader:read-only@8.8.8.8:554/live?channel=1");
  assert.equal(result.hostname, "8.8.8.8");
});

test("rejects embedded credentials, unapproved secure defaults, fragments and alternate schemes", async () => {
  const allowed = new Set([554, 8554]);
  await assert.rejects(validateAndPinRtsp("rtsp://user:pass@8.8.8.8/live", "", "", allowed), /INVALID_RTSP_URL/);
  await assert.rejects(validateAndPinRtsp("rtsps://8.8.8.8/live", "", "", allowed), /CAMERA_PORT_NOT_APPROVED/);
  await assert.rejects(validateAndPinRtsp("rtsp://8.8.8.8/live#fragment", "", "", allowed), /INVALID_RTSP_URL/);
  await assert.rejects(validateAndPinRtsp("https://8.8.8.8/live", "", "", allowed), /INVALID_RTSP_SCHEME/);
});
