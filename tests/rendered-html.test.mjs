import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the 18nover broadcast dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>18nover — Private RTSP streaming(?: · 18nover)?<\/title>/i);
  assert.match(html, /18nover/i);
  assert.match(html, /Stream status/);
  assert.match(html, /Awaiting a camera feed/);
  assert.match(html, /Add camera/);
  assert.match(html, /Host only/);
  assert.match(html, /Chat/);
  assert.match(html, /Guide/);
  assert.match(html, /Voice lounge/);
  assert.match(html, /data-theme="light"/i);
  assert.match(html, /aria-label="Switch to dark mode"/i);
  assert.match(html, /data-stream-clock="true">--:--:--</i);
  assert.doesNotMatch(html, /react-loading-skeleton|Your site is taking shape|codex-preview/i);
  assert.doesNotMatch(html, /Join Meeting|Leave Call|participant video grid/i);
  assert.doesNotMatch(html, /orbit\.jpg|explorer\.jpg|simulated footage/i);
});

test("declares a private, non-indexed product surface", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /name="robots" content="noindex, nofollow"/i);
  assert.match(html, /name="referrer" content="no-referrer"/i);
  assert.match(html, /og:image/i);
});

test("ships a valid social preview PNG at the metadata path", async () => {
  const png = await readFile(new URL("../public/og.png", import.meta.url));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR");
  assert.equal(png.readUInt32BE(16), 1731);
  assert.equal(png.readUInt32BE(20), 909);
  assert.ok(png.byteLength > 100_000);
});
