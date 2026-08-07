import assert from "node:assert/strict";
import test from "node:test";
import { planProbe } from "../src/probe.js";

test("passes through baseline H264 without B frames and compatible audio", () => {
  const result = planProbe({ streams: [
    { codec_type: "video", codec_name: "h264", profile: "Constrained Baseline", pix_fmt: "yuv420p", width: 1920, height: 1080, avg_frame_rate: "30/1", bit_rate: "5400000", has_b_frames: 0 },
    { codec_type: "audio", codec_name: "opus" },
  ] }, true);
  assert.equal(result.relayMode, "direct");
  assert.equal(result.profiles[0]?.label, "Source");
});

test("transcodes H265, H264 B-frames and AAC audio", () => {
  const cases = [
    { codec_name: "hevc", profile: "Main", has_b_frames: 0, audio: "opus" },
    { codec_name: "h264", profile: "High", has_b_frames: 2, audio: "opus" },
    { codec_name: "h264", profile: "Baseline", has_b_frames: 0, audio: "aac" },
  ];
  for (const item of cases) {
    const result = planProbe({ streams: [
      { codec_type: "video", codec_name: item.codec_name, profile: item.profile, pix_fmt: "yuv420p", width: 2560, height: 1440, avg_frame_rate: "60/2", has_b_frames: item.has_b_frames },
      { codec_type: "audio", codec_name: item.audio },
    ] }, true);
    assert.equal(result.relayMode, "transcoded");
    assert.equal(result.profiles[0]?.height, 1080);
    assert.equal(result.profiles[0]?.label, "1080p");
  }
});
