# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Lockard Live is a private, desktop-first, one-to-many RTSP camera streaming dashboard, built as an OpenAI "Sites" app (vinext/Next.js on Cloudflare Workers). Hosts add RTSP/RTSPS cameras through a VLC-style setup sheet; viewers get authenticated WHEP/WebRTC playback and never see a camera URL or credential. It is **not** a meeting app — one broadcaster, one primary video, no participant grid, no viewer camera publishing.

The repo has two independently-versioned halves that must both be kept green:

- **Sites app** (repo root) — `app/`, `lib/`, `db/`, `worker/`: the Next.js/vinext dashboard and same-origin API routes, deployed to Cloudflare Workers.
- **Relay** (`relay/`) — a standalone TypeScript controller plus a patched MediaMTX, deployed via Docker Compose. Has its own `package.json`, `tsconfig.json`, and test suite.

Read `docs/HANDOFF.md` and `docs/CHANGELOG.md` before starting work — they carry current-state context (what's verified, what's not shipped, non-negotiable product rules) that isn't derivable from the code alone. Update both at the end of a session per the global session-handoff rule.

## Commands

### Sites app (repo root, Node >=22.13)

```bash
npm ci
npm run dev         # vinext dev server
npm run build        # vinext build (writes dist/, dist/.openai/)
npm test              # build + node --test tests/rendered-html.test.mjs
npm run typecheck   # tsc --noEmit
npm run lint          # eslint app lib db worker tests + config files
npm run db:generate  # drizzle-kit generate (only if db/schema.ts is non-empty)
```

`npm test` runs the built worker output (`dist/server/index.js`), so it always builds first — there's no standalone "run this one test" shortcut; `tests/rendered-html.test.mjs` is the only test file and asserts on rendered SSR HTML (theme default, stream-clock placeholder, security meta tags, absence of banned strings like "Join Meeting" or "simulated footage").

### Relay (`relay/`, Node >=24)

```bash
cd relay
npm ci
npm run typecheck
npm test              # node --import tsx --test test/*.test.ts
npm run build         # tsc -p tsconfig.json -> dist/
```

Run a single relay test file directly: `node --import tsx --test test/network.test.ts`.

Compose config check (needs `relay/.env.example` or a real env file):

```bash
docker compose --env-file .env.example -f docker-compose.yml config --quiet
```

### Full verification (do this before considering a change done)

```bash
npm run lint && npm test
cd relay && npm run typecheck && npm test && npm run build
```

## Architecture

### Media path

```
Public RTSP/RTSPS camera (TCP only, validated + DNS-pinned)
  → private, redirect-denying MediaMTX pull path
  → direct browser-safe stream OR bounded FFmpeg H.264/Opus transcode
  → controller-owned WHEP signaling gateway (through Caddy)
  → MediaMTX WebRTC media (UDP/TCP 8189)
  → browser
```

Only Caddy 80/443 and MediaMTX 8189 are published from the relay Compose stack. MediaMTX's RTSP/WHEP-HTTP/Control-API and the controller API are private, control-network-only listeners. Camera URLs, paths, queries, and credentials never leave the relay — the Sites app and browser only ever see the `CameraSummary` contract (`lib/contracts.ts`).

### Sites ↔ Relay boundary

The Next.js app never talks to MediaMTX or stores camera secrets. `app/api/**/route.ts` handlers are thin: validate same-origin + viewer identity, validate the request body, call the relay, sanitize the relay's response, return it.

- `lib/server/auth.ts` — same-origin enforcement (`requireSameOrigin`) and viewer identity/role resolution (`requireViewer`, `requireHost`). Identity comes from `oai-authenticated-user-*` headers (Sites platform auth) or, off-production/loopback-only, explicit `LOCKARD_DEV_*` env vars.
- `lib/server/config.ts` — loads and strictly validates all `SITES_ORIGIN`/`LOCKARD_*` env vars into a `ServerConfig`; throws `ConfigurationError` on anything malformed (used to fail closed, not fall back to defaults).
- `lib/server/relay-client.ts` — `relayRequest()` signs every outbound call with HMAC (timestamp + nonce + body digest, `x-lockard-*` headers) and enforces `redirect: "error"` plus a bounded-response reader. `sanitize*()` functions are the one-way gate that reconstructs relay responses into the public contract types field-by-field (rejecting anything that looks like a leaked `rtsp://` URL) rather than trusting/passing through relay JSON.
- `lib/server/validation.ts` — request-body validation for camera input/patch/session bodies (`lib/server/http.ts` has the shared JSON body reader and error mapping).
- `lib/contracts.ts` — the only types allowed to cross the Sites/browser boundary (`CameraSummary`, `PlaybackGrant`, `SessionResponse`, etc). If you're tempted to pass a raw relay field to the client, it has to go through a contract type and a `sanitize*` function first.

### Relay controller (`relay/src/`)

Single-process TypeScript HTTP server (`node:http`, no framework) fronting MediaMTX and FFmpeg. Entry point `index.ts` wires these together:

- `config.ts` — loads secrets from files (not env values directly) referenced by `RELAY_*_FILE` env vars; validates HMAC keys, JWT key, origins, ports.
- `auth.ts` — verifies inbound Sites HMAC requests (`verifyRequest`, with nonce replay protection via `db.reserveNonce`), issues ES256 JWTs for MediaMTX path permissions, and tracks one-use WHEP viewer grants (max 3 active leases per viewer, 10-minute renewable lease).
- `network.ts` — `validateAndPinRtsp()`: the security-critical gate for any camera URL. Blocks private/loopback/link-local/multicast/special-use address ranges (both IPv4 and IPv6), resolves DNS once and pins the resolved IP, and does a trusted-TLS preflight with certificate fingerprinting for `rtsps://`.
- `cameras.ts` — camera lifecycle (create/patch/probe/retest/delete), state machine, profiles, reconciliation, sanitized audit log. Enforces `RELAY_MAX_CAMERAS` (8) and `RELAY_MAX_WARM_CAMERAS` (4).
- `probe.ts` — FFprobe-based camera testing (codec, resolution, fps, direct-vs-transcode decision).
- `supervisor.ts` — FFmpeg transcoder process supervision, `RELAY_MAX_TRANSCODERS` (2) capacity limit, restart circuit breaker.
- `mediamtx.ts` — MediaMTX Control API client (path creation, telemetry).
- `whep-gateway.ts` — proxies browser WHEP signaling; MediaMTX's own WHEP HTTP endpoint is never exposed directly.
- `db.ts` / `crypto.ts` — encrypted SQLite (AES-GCM, record-bound associated data) for camera records; nonce persistence for replay protection.
- `server.ts` — route table. Every mutating route re-validates the HMAC signature, enforces an allowlist of body keys (`assertKeys`), and maps internal error codes to a fixed safe-message table (`safeError`) — never echoes raw error internals to the caller.

Requests between Sites and the relay are mutually paired: `lib/server/relay-client.ts` (client, signs) and `relay/src/auth.ts`+`server.ts` (server, verifies) must stay in sync on the canonical string format (`v1\n{timestamp}\n{nonce}\n{method}\n{path}\n{bodyDigest}`) and header names (`x-lockard-key-id`, `x-lockard-timestamp`, `x-lockard-nonce`, `x-lockard-signature`).

### Frontend

`app/lockard-dashboard.tsx` is the single large client component: three-column layout, WHEP playback via `lib/client/whep.ts`, camera switcher, Chat/Guide/Members companion panels, audio-only LiveKit voice footer, light/dark theme (light is the deterministic SSR default — a hydration-mismatch regression exists around this, see `tests/rendered-html.test.mjs` and `docs/HANDOFF.md`; don't reintroduce `useState(new Date())` or `suppressHydrationWarning` as a fix). `app/globals.css` holds the full design system including light-theme overrides; the primary video/player chrome stays dark in both themes.

`app/chatgpt-auth.ts` reads the same `oai-authenticated-user-*` headers as `lib/server/auth.ts` for server-component-side auth redirects (`/signin-with-chatgpt`, `/signout-with-chatgpt`).

### Build/deploy plumbing

- `vite.config.ts` wires `vinext`, the custom `sites()` plugin (`build/sites-vite-plugin.ts` — real source, not disposable output, despite living under `build/`), and `@cloudflare/vite-plugin` using bindings read from `.openai/hosting.json` (`d1`/`r2` binding names, currently both `null` — no database is wired up; see `db/schema.ts` and `examples/d1/` for the opt-in pattern).
- `worker/index.ts` is the Cloudflare Worker entry point; it special-cases `/_vinext/image` for image optimization and otherwise delegates to vinext's app-router handler.
- `tsconfig.json` excludes `relay`, `db`, `worker`, `examples`, `work`, `outputs` from the root TS project — those either have their own tsconfig or aren't meant to type-check against the app.
- `examples/d1/` is reference-only scaffolding for adding a database later, not part of the active build.

## Non-negotiable product rules

(from `docs/HANDOFF.md` — violating these is a regression, not a feature choice)

- One broadcaster, one primary video. Never add a participant video grid.
- Viewers never publish a camera track or receive camera credentials/URLs — only `CameraSummary`.
- Cameras belong to Hosts only; all camera mutation routes require `requireHost`.
- Browser playback is authenticated WHEP/WebRTC — never direct RTSP, never embedded VLC.
- Never simulate camera footage when a real source is unavailable (no fixture/demo frames in production paths).
- RTSP-over-UDP is rejected everywhere (`transport !== "tcp"` is a hard error, both in Sites validation and the relay).

## Security-sensitive areas (extra care / extra test coverage expected)

- Anything touching `relay/src/network.ts` (SSRF/address-pinning) or `relay/src/auth.ts` (HMAC/JWT/replay).
- `lib/server/relay-client.ts` sanitize functions — they're the boundary that prevents a compromised or buggy relay from leaking an `rtsp://` URL or credential to the browser.
- Secrets are always file-based in the relay (`RELAY_*_FILE` env vars pointing at Docker secrets), never inline env values. `.env*` files are gitignored except `.env.example`/`relay/.env.example`.
- Never put camera URLs, credentials, HMAC keys, database keys, JWT private keys, SDP, or bearer tokens into logs, commits, or prompts.
