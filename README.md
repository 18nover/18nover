# 18nover

18nover is a private, desktop-first, one-to-many RTSP camera streaming dashboard. Hosts get a VLC-style **Open Network Stream** workflow; viewers receive authenticated WHEP/WebRTC playback and never receive a camera URL or credential.

## Project structure

```
onlystream/
├── src/                        # ALL application source
│   ├── app/                    #   Next.js/vinext App Router — pages, layout, API routes, dashboard UI
│   ├── lib/                    #   Shared library code — no framework routing, imported explicitly
│   │   └── db/                 #     Drizzle schema.ts + getDb() helper
│   ├── worker/                 #   Cloudflare Worker entrypoint (index.ts) — this app's deploy glue
│   └── build/                  #   Custom Vite plugin(s) — build-time tooling
├── public/                     # Static assets served as-is (og.png)
├── tests/                      # Integration test(s) (rendered-html.test.mjs)
├── docs/                       # Human-facing documentation
│   └── examples/               #   Reference-only scaffolding (e.g. D1 usage example), not part of the build
├── drizzle/                    # Generated DB migration history (drizzle-kit output)
├── relay/                      # Independent relay/controller service — own package.json + Docker deploy
├── .openai/                    # OpenAI Sites hosting platform config — platform-fixed location
└── package.json, tsconfig.json, vite.config.ts, next.config.ts, eslint.config.mjs,
    postcss.config.mjs, drizzle.config.ts, pnpm-workspace.yaml, .env.example, .gitignore
```

- **`src/app` vs `src/lib`** — `app/` is Next.js-routable: the framework auto-discovers pages and API routes by file location. `lib/` is plain code, reachable only via explicit imports. They're kept separate so App Router's file-convention magic never applies to non-route files.
- **`src/worker` vs `relay/`** — easy to conflate, genuinely different. `src/worker/index.ts` is a small Cloudflare Workers entrypoint for *this app's* deploy. `relay/` is a wholly separate backend service (the RTSP→WebRTC media relay controller) with its own package.json, tests, and Docker Compose deployment, consumed only over HTTP — never imported as code.
- **`work/` and `outputs/` — deleted.** `work/` was empty and unreferenced anywhere in the repo. `outputs/` was a gitignored leftover from a prior session (duplicate asset, stale status doc, a tarball), not part of the app.
- **`examples/` moved under `docs/`** — reference-only scaffolding (a D1 usage example, excluded from the real build), not runtime or test code, so it lives with the other documentation now.
- **`.vinext/` and `.wrangler/`** — not restructured, not part of the tree above. Both are auto-generated, gitignored local caches (vinext's font-optimization cache; Cloudflare Wrangler's dev-server state) that regenerate on `npm run dev`/`build`. Safe to delete by hand anytime; not something to "clean up" as part of this reorg.
- **Root config files stay at root** — every one of those tools (npm, tsc, vite, eslint, postcss, drizzle-kit) looks for its config at the project root by default.

## What is implemented

- Premium three-column dashboard with stream telemetry, one primary video, camera switcher, Chat/Guide/Members companions, and an audio-only LiveKit voice footer.
- Browser WHEP reader with five-minute, one-use, exact-path playback grants, first-frame camera switching, 300 ms crossfade, failed-switch retention, WebRTC metrics, local-only JPEG snapshots, and explicit unavailable states.
- Host-only RTSP setup sheet with separate credentials, substream, transport, audio, bounded probe result, and no browser persistence.
- Same-origin Sites API routes with explicit Host, Moderator, and Member identity allowlists, Host-only camera management, HMAC request signing, timestamps, one-time nonces, strict input/response reconstruction, no-store headers, and RTSP redaction.
- Docker relay stack: Caddy, a TypeScript controller, and a commit-pinned MediaMTX v1.19.3 build with a redirect-denial/exact-dial-target patch. The controller provides encrypted SQLite camera records, public-address/port validation, DNS pinning, RTSPS certificate fingerprinting, TCP-only pulls, temporary-path probing, direct/transcoded codec planning, two-worker CPU transcoding capacity, reconciliation, JWKS, and path-scoped ES256 tokens.
- Controller-owned WHEP signaling gateway with one-use grants scoped to one output path, no more than three active sessions per viewer, renewable ten-minute leases, bounded SDP, and authenticated cleanup. MediaMTX WHEP HTTP stays private; only WebRTC media is exposed on 8189.
- Security and integration acceptance guides under `docs/`.

This is not a meeting app: there is no participant video grid, viewer camera permission, or “join meeting” flow. Voice is optional and requests microphone access only on explicit unmute/push-to-talk.

## Local dashboard

The Sites/vinext application requires Node 22.13 or later.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

To preview Host controls locally, set the explicit loopback-only `NOVER_DEV_*` values in `.env.local` and set `SITES_ORIGIN` to the exact printed local origin. A real session still requires a reachable relay and matching HMAC key.

## Relay

See [docs/deployment-operations.md](docs/deployment-operations.md) before starting the containers. The abbreviated topology is:

```text
Public RTSP/RTSPS camera (TCP only, validated and IP-pinned)
  → private, redirect-denying MediaMTX pull path
  → direct browser-safe stream OR bounded FFmpeg H.264/Opus rendition
  → controller WHEP signaling through Caddy + MediaMTX WebRTC UDP/TCP
  → browser
```

Only ports 80/TCP, 443/TCP+UDP, and 8189/TCP+UDP are published. MediaMTX RTSP/WHEP HTTP/Control API and the controller API remain private Compose listeners.

## Verification

```bash
npm run lint
npm test
cd relay
npm ci
npm run typecheck
npm test
```

Sites release is intentionally two-step. After the local and relay preflight checks pass, deploy one access-restricted candidate for named operators only and run the real-camera integration from that exact origin. Do not widen access to the intended private audience until the candidate passes DNS/TLS/ICE, real RTSP playback, capacity, rollback, WHEP lifecycle, and the fail-closed credential-leak audit in `docs/`. If an access-restricted candidate is unavailable, stop rather than publish with broader access.
