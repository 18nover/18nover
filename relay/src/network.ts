import { BlockList, isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { createHash } from "node:crypto";
import { connect as tlsConnect } from "node:tls";

const BLOCKED = new BlockList();
[
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
].forEach(([address, prefix]) => BLOCKED.addSubnet(String(address), Number(prefix), "ipv4"));
[
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64],
  ["2001:2::", 48], ["2001:10::", 28], ["2001:20::", 28], ["2001:db8::", 32],
  ["2002::", 16], ["3fff::", 20], ["fc00::", 7], ["fec0::", 10], ["fe80::", 10], ["ff00::", 8],
].forEach(([address, prefix]) => BLOCKED.addSubnet(String(address), Number(prefix), "ipv6"));

export type ValidatedSource = {
  normalized: string;
  pinned: string;
  hostname: string;
  address: string;
  port: number;
  fingerprint?: string;
};

export async function validateAndPinRtsp(raw: string, username: string, password: string, allowedPorts: Set<number>, timeoutMs = 5_000): Promise<ValidatedSource> {
  if (!raw || raw.length > 4096 || /[\r\n\0]/.test(raw) || raw.includes("#") || /%(?![0-9a-f]{2})/i.test(raw)) throw safeNetworkError("INVALID_RTSP_URL");
  let url: URL;
  try { url = new URL(raw); } catch { throw safeNetworkError("INVALID_RTSP_URL"); }
  if (url.protocol !== "rtsp:" && url.protocol !== "rtsps:") throw safeNetworkError("INVALID_RTSP_SCHEME");
  if (!url.hostname || url.hash || url.username || url.password) throw safeNetworkError("INVALID_RTSP_URL");
  const port = url.port ? Number(url.port) : url.protocol === "rtsps:" ? 322 : 554;
  if (!allowedPorts.has(port)) throw safeNetworkError("CAMERA_PORT_NOT_APPROVED");

  const results = isIP(url.hostname)
    ? [{ address: url.hostname, family: isIP(url.hostname) }]
    : await withTimeout(lookup(url.hostname, { all: true, verbatim: true }), timeoutMs, "DNS_TIMEOUT");
  if (!results.length || results.some((result) => !isGlobalAddress(result.address))) throw safeNetworkError("CAMERA_ADDRESS_NOT_GLOBAL");

  const selected = results[0]!;
  const source = new URL(url.toString());
  source.port = String(port);
  if (username) source.username = username;
  if (password) source.password = password;
  const pinned = new URL(source.toString());
  pinned.hostname = selected.family === 6 ? `[${selected.address}]` : selected.address;
  const fingerprint = url.protocol === "rtsps:"
    ? await verifiedTlsFingerprint(selected.address, port, isIP(url.hostname) ? undefined : url.hostname, timeoutMs)
    : undefined;
  return { normalized: source.toString(), pinned: pinned.toString(), hostname: url.hostname, address: selected.address, port, ...(fingerprint ? { fingerprint } : {}) };
}

export function isGlobalAddress(address: string) {
  if (address.toLowerCase().startsWith("::ffff:")) return false;
  const family = isIP(address);
  if (!family) return false;
  return !BLOCKED.check(address, family === 4 ? "ipv4" : "ipv6");
}

export function safeNetworkError(code: string) {
  const error = new Error(code);
  error.name = "CameraNetworkError";
  return error;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(safeNetworkError(code)), timeoutMs); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function verifiedTlsFingerprint(address: string, port: number, servername: string | undefined, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = tlsConnect({ host: address, port, servername, rejectUnauthorized: true, minVersion: "TLSv1.2" });
    const finish = (error?: Error, fingerprint?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error || !fingerprint) reject(safeNetworkError("CAMERA_TLS_INVALID"));
      else resolve(fingerprint);
    };
    const timer = setTimeout(() => finish(safeNetworkError("CAMERA_TLS_INVALID")), timeoutMs);
    socket.once("error", () => finish(safeNetworkError("CAMERA_TLS_INVALID")));
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate(true);
      if (!socket.authorized || !certificate.raw?.byteLength) return finish(safeNetworkError("CAMERA_TLS_INVALID"));
      finish(undefined, createHash("sha256").update(certificate.raw).digest("hex").toUpperCase());
    });
  });
}
