import { createHash, createPublicKey } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { importPKCS8, SignJWT } from "jose";
import type { RelayConfig } from "./config.js";
import { verifyHmac } from "./crypto.js";
import type { RelayDatabase } from "./db.js";

const WHEP_LEASE_MS = 10 * 60_000;

export class Authenticator {
  private signingKey: Awaited<ReturnType<typeof importPKCS8>> | null = null;
  private publicJwk: Record<string, unknown> | null = null;
  private readonly kid: string;
  private readonly viewerGrants = new Map<string, { subject: string; path: string; tokenExpiresAt: number; leaseExpiresAt: number; used: boolean; active: boolean }>();

  constructor(private readonly config: RelayConfig, private readonly db: RelayDatabase) {
    this.kid = createHash("sha256").update(config.jwtPrivateKeyPem).digest("base64url").slice(0, 16);
  }

  async initialize() {
    this.signingKey = await importPKCS8(this.config.jwtPrivateKeyPem, "ES256");
    const publicJwk = createPublicKey(this.config.jwtPrivateKeyPem).export({ format: "jwk" });
    this.publicJwk = { ...publicJwk, use: "sig", alg: "ES256", kid: this.kid };
  }

  verifyRequest(headers: IncomingHttpHeaders, method: string, path: string, rawBody: string) {
    const keyId = single(headers["x-18nover-key-id"]);
    const timestamp = single(headers["x-18nover-timestamp"]);
    const nonce = single(headers["x-18nover-nonce"]);
    const signature = single(headers["x-18nover-signature"]);
    if (!keyId || !timestamp || !nonce || !signature || !/^[A-Za-z0-9_-]{22}$/.test(nonce)) return false;
    const key = this.config.hmacKeys.get(keyId);
    const seconds = Number(timestamp);
    const now = Math.floor(Date.now() / 1000);
    if (!key || !Number.isInteger(seconds) || Math.abs(now - seconds) > 30) return false;
    const digest = createHash("sha256").update(rawBody).digest("hex");
    const canonical = `v1\n${timestamp}\n${nonce}\n${method.toUpperCase()}\n${path}\n${digest}`;
    if (!verifyHmac(key, canonical, signature)) return false;
    return this.db.reserveNonce(keyId, nonce, Math.max(now, seconds) + 35);
  }

  jwks() {
    if (!this.publicJwk) throw new Error("signing key not initialized");
    return { keys: [this.publicJwk] };
  }

  async issueToken(subject: string, action: "read" | "publish" | "api", path: string, ttlSeconds = 300) {
    if (!this.signingKey) throw new Error("signing key not initialized");
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ mediamtx_permissions: [{ action, path }] })
      .setProtectedHeader({ alg: "ES256", kid: this.kid, typ: "JWT" })
      .setIssuer(this.config.jwtIssuer)
      .setAudience(this.config.jwtAudience)
      .setSubject(subject)
      .setJti(crypto.randomUUID())
      .setIssuedAt(now)
      .setNotBefore(now - 2)
      .setExpirationTime(now + ttlSeconds)
      .sign(this.signingKey);
  }

  async issueViewerToken(subject: string, path: string, ttlSeconds = 300) {
    const token = await this.issueToken(subject, "read", path, ttlSeconds);
    const tokenExpiresAt = Date.now() + ttlSeconds * 1_000;
    this.viewerGrants.set(tokenKey(token), { subject, path, tokenExpiresAt, leaseExpiresAt: tokenExpiresAt, used: false, active: false });
    return token;
  }

  consumeViewerToken(token: string, path: string) {
    this.cleanupViewerGrants();
    const key = tokenKey(token);
    const grant = this.viewerGrants.get(key);
    if (!grant || grant.used || grant.path !== path || grant.tokenExpiresAt <= Date.now()) return null;
    const activeForViewer = [...this.viewerGrants.values()].filter((entry) => entry.subject === grant.subject && entry.active && entry.leaseExpiresAt > Date.now()).length;
    if (activeForViewer >= 3) return null;
    grant.used = true;
    grant.active = true;
    grant.leaseExpiresAt = Date.now() + WHEP_LEASE_MS;
    return { key, subject: grant.subject, leaseExpiresAt: grant.leaseExpiresAt };
  }

  matchesViewerToken(token: string, key: string) { return tokenKey(token) === key; }

  touchViewerGrant(key: string, leaseExpiresAt: number) {
    const grant = this.viewerGrants.get(key);
    if (!grant?.active) return false;
    grant.leaseExpiresAt = leaseExpiresAt;
    return true;
  }

  releaseViewerGrant(key: string) { this.viewerGrants.delete(key); }

  private cleanupViewerGrants() {
    const now = Date.now();
    for (const [key, grant] of this.viewerGrants) {
      const expiry = grant.active ? grant.leaseExpiresAt : grant.tokenExpiresAt;
      if (expiry <= now) this.viewerGrants.delete(key);
    }
  }
}

function single(value: string | string[] | undefined) { return typeof value === "string" ? value : undefined; }
function tokenKey(token: string) { return createHash("sha256").update(token).digest("hex"); }
