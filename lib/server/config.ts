export type ServerConfig = {
  sitesOrigin: string;
  relayOrigin: string;
  relayKeyId: string;
  relayHmacSecret: Uint8Array;
  hostUserIds: Set<string>;
  moderatorUserIds: Set<string>;
  memberUserIds: Set<string>;
  timeoutMs: number;
};

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export function getServerConfig(): ServerConfig {
  const sitesOrigin = requireSitesOrigin(process.env.SITES_ORIGIN);
  const relayOrigin = requireHttpsOrigin("LOCKARD_RELAY_ORIGIN", process.env.LOCKARD_RELAY_ORIGIN);
  const relayKeyId = requireValue("LOCKARD_RELAY_HMAC_KEY_ID", process.env.LOCKARD_RELAY_HMAC_KEY_ID, 64);
  const relaySecretValue = requireValue("LOCKARD_RELAY_HMAC_SECRET_BASE64", process.env.LOCKARD_RELAY_HMAC_SECRET_BASE64, 256);
  const relayHmacSecret = decodeBase64(relaySecretValue);
  if (relayHmacSecret.byteLength < 32) throw new ConfigurationError("LOCKARD_RELAY_HMAC_SECRET_BASE64 must decode to at least 32 bytes.");

  const parsedTimeout = Number(process.env.LOCKARD_RELAY_TIMEOUT_MS ?? "10000");
  const timeoutMs = Number.isFinite(parsedTimeout) ? Math.min(30_000, Math.max(1_000, parsedTimeout)) : 10_000;
  const hostUserIds = identitySet(process.env.LOCKARD_HOST_USER_IDS);
  const moderatorUserIds = identitySet(process.env.LOCKARD_MODERATOR_USER_IDS);
  const memberUserIds = identitySet(process.env.LOCKARD_MEMBER_USER_IDS);
  if (process.env.NODE_ENV === "production" && hostUserIds.size === 0) {
    throw new ConfigurationError("LOCKARD_HOST_USER_IDS must contain at least one stable Sites user ID in production.");
  }
  return { sitesOrigin, relayOrigin, relayKeyId, relayHmacSecret, hostUserIds, moderatorUserIds, memberUserIds, timeoutMs };
}

function requireValue(name: string, value: string | undefined, maxLength: number) {
  if (!value || value.length > maxLength || /[\r\n\0]/.test(value)) throw new ConfigurationError(`${name} is missing or invalid.`);
  return value;
}

function requireHttpsOrigin(name: string, value: string | undefined) {
  const raw = requireValue(name, value, 512);
  let url: URL;
  try { url = new URL(raw); } catch { throw new ConfigurationError(`${name} is not a URL.`); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new ConfigurationError(`${name} must be a bare HTTPS origin.`);
  }
  return url.origin;
}

function requireSitesOrigin(value: string | undefined) {
  const raw = requireValue("SITES_ORIGIN", value, 512);
  let url: URL;
  try { url = new URL(raw); } catch { throw new ConfigurationError("SITES_ORIGIN is not a URL."); }
  const localDev = process.env.NODE_ENV !== "production" && process.env.LOCKARD_DEV_AUTH_ENABLED === "true" && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((!localDev && url.protocol !== "https:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new ConfigurationError("SITES_ORIGIN must be a bare HTTPS origin (or an explicit loopback development origin). ");
  }
  return url.origin;
}

function decodeBase64(value: string) {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new ConfigurationError("LOCKARD_RELAY_HMAC_SECRET_BASE64 is not valid base64.");
  }
}

function identitySet(value: string | undefined) {
  if (value && (value.length > 16_384 || /[\r\n\0]/.test(value))) throw new ConfigurationError("A Lockard identity allowlist is invalid.");
  return new Set((value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean));
}
