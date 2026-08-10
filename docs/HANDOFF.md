# 18nover — AI handoff

Updated: 2026-08-10  
Workspace: `/home/jerry/18nover/18nover` (native Linux/WSL2, fully tracked by git; the `C:\18nover\onlystream` Windows path and low-disk workaround described further below is historical and no longer applies)

## Current outcome

18nover is implemented as a private, desktop-first, one-to-many RTSP camera dashboard. The application UI, same-origin Sites routes, TypeScript relay controller, protected WHEP signaling gateway, Docker Compose topology, custom MediaMTX redirect guard, tests, and operations/security runbooks are present.

The dashboard now defaults to light mode. A moon/sun button in the header switches to dark mode and stores the device-local preference. The primary video remains dark in both themes so video controls and glass overlays remain readable.

The reported React hydration mismatch is fixed. Server rendering now emits a deterministic `--:--:--` stream-clock placeholder; the localized clock starts after hydration. Do not replace this with `suppressHydrationWarning`.

Local preview was healthy at `http://localhost:3001/` at handoff time. A future AI may need to restart it because retained processes do not necessarily survive task changes.

## Non-negotiable product rules

- This is a livestream dashboard, not a meeting application.
- One broadcaster and one primary video; never add a participant video grid.
- Viewers never publish a camera track or receive camera credentials.
- Cameras belong to Hosts only.
- Browser playback is authenticated WHEP/WebRTC, not direct RTSP and not embedded VLC.
- Chat, Guide, presence, and audio-only LiveKit voice are independent companions.
- Never simulate camera footage when a real source is unavailable.
- Do not publish to the wider private audience until the real-camera integration gates pass.

## Intended media path

```text
Public RTSP/RTSPS camera
  -> validated, DNS-pinned, TCP-only MediaMTX pull
  -> direct compatible output OR bounded FFmpeg H.264/Opus transcode
  -> controller-owned authenticated WHEP signaling gateway
  -> MediaMTX WebRTC media on UDP/TCP 8189
  -> browser
```

Camera URLs, paths, queries, usernames, and passwords must remain server-side and encrypted. Browsers receive `CameraSummary` data only.

## Implemented surfaces

### Dashboard

- Three-column layout, sticky header, status widgets, 16:9 stage, camera switcher, resizable companion sidebar, and persistent voice footer.
- Chat, Guide, and Members tabs with truthful production empty states.
- Host-only Add RTSP Camera sheet, probe results, update/retest/pause/delete actions, and credential re-entry on replacement.
- Crossfade after the target's first rendered frame; failed camera switches retain the current feed.
- Bounded reconnect, local-only JPEG snapshot, camera-audio control, quality selection, fullscreen, latency, and bitrate metrics.
- Push-to-talk safeguards and audio-only LiveKit remote-track attachment.
- Light-first theme with persistent dark-mode toggle.

### Sites server boundary

- Same-origin routes under `src/app/api/` for session and camera management.
- Explicit Host, Moderator, and Member allowlists.
- Host-only mutation checks.
- HMAC-signed relay calls with timestamp, nonce, body digest, replay protection, bounded responses, and safe reconstruction.

### Relay

- Encrypted SQLite camera records using AES-GCM.
- Public-address and approved-port enforcement; private, loopback, link-local, metadata, multicast, and other special networks rejected.
- DNS validation/pinning and reconnect revalidation.
- RTSPS trusted TLS preflight with original-hostname SNI and SHA-256 certificate fingerprint.
- TCP-only RTSP source policy.
- FFprobe-based bounded probing and direct/transcoded codec planning.
- Two simultaneous CPU transcoders with a circuit breaker; incompatible third feed reports capacity unavailable.
- Maximum eight registered cameras and four warm sources.
- Sanitized camera audit events.
- ES256 JWKS and exact-path MediaMTX permissions.

### WHEP gateway

- Browser signaling goes through the controller; MediaMTX WHEP HTTP remains private.
- Five-minute, read-only, exact-path grants.
- One-use grant consumption.
- Maximum three active resources per viewer.
- Renewable ten-minute resource lease via authenticated `HEAD`.
- Authenticated `DELETE` cleanup and bounded SDP bodies.

### Containers

- `relay/docker-compose.yml`: Caddy, controller, and custom MediaMTX.
- MediaMTX is pinned to v1.19.3 commit `5ccc80ad7b1609330a4c397c51a7e701f963d74f`.
- `relay/mediamtx/redirect-guard.patch` rejects RTSP redirects before logging and restricts source TCP dialing to the exact validated tuple.
- Only Caddy 80/443 and MediaMTX UDP/TCP 8189 are published.
- Controller and MediaMTX run non-root with read-only filesystems and bounded resources. Do not claim the supplied Caddy container is non-root; its residual privilege is documented.

## Important files

| File | Purpose |
| --- | --- |
| `src/app/dashboard.tsx` | Main interactive dashboard, playback switching, theme, clock, voice, and Host controls |
| `src/app/globals.css` | Dark design plus complete light-theme overrides |
| `src/app/layout.tsx` | Metadata, fonts, light-first browser theme color |
| `src/lib/client/whep.ts` | Strict browser WHEP reader and lifecycle |
| `src/lib/server/auth.ts` | Sites identity and allowlist enforcement |
| `src/lib/server/relay-client.ts` | Signed controller client and safe response handling |
| `relay/src/cameras.ts` | Camera lifecycle, summaries, profiles, healing, and audit |
| `relay/src/whep-gateway.ts` | One-use WHEP proxy and resource ownership |
| `relay/src/network.ts` | URL, DNS, IP, port, pinning, and RTSPS checks |
| `relay/src/supervisor.ts` | FFmpeg capacity and restart circuit breaker |
| `relay/mediamtx/redirect-guard.patch` | Redirect denial and exact-destination dial enforcement |
| `relay/docker-compose.yml` | Private relay topology and published ports |
| `docs/deployment-operations.md` | Bring-up, real-camera, capacity, backup, rollback, and release gates |
| `docs/security-acceptance.md` | Trust boundaries, negative tests, and fail-closed credential audit |
| `src/build/sites-vite-plugin.ts` | Required Sites build plugin; this is source, not disposable build output |

## Latest verification

Passed:

- Application TypeScript check.
- Application ESLint.
- vinext production build.
- Rendered application tests: 3/3.
- Default SSR theme is `light`.
- SSR stream clock is `--:--:--` before hydration.
- Local `/og.png` returns HTTP 200 as `image/png`.
- Relay TypeScript and emitted build.
- Relay tests: 19/19 (16 prior + 3 new `config.test.ts` cases).
- Docker Compose configuration render with the example environment.
- MediaMTX patch dry-run against the exact pinned commit.
- Source archive extraction and non-fixture credential-shape scan.
- 2026-08-09: Docker was available in-session this time. Built the real `18nover-mediamtx:1.19.3-redirect-guard` image (exact-commit checkout assertion in the Dockerfile passed) and the controller image, brought both up locally, and found the controller could not boot at all: `relay/src/config.ts`'s `internalOrigin()` required `url.pathname === "/"`, but `rtsp://mediamtx:8554` (the literal value `docker-compose.yml` sets for `MEDIAMTX_RTSP_ORIGIN`) parses to pathname `""` under WHATWG URL rules because `rtsp:` isn't a "special" scheme. This was a hard, host-independent boot blocker with zero prior test coverage. Fixed in `relay/src/config.ts` (accepts `""` or `"/"` as "no path") and covered by the new `relay/test/config.test.ts`. After the fix, the controller reached `controller_ready` and reported `healthy`.
- 2026-08-09: Also hit and worked around a local-only issue: Docker Compose's non-Swarm file secrets bind-mount the host file's own permission bits into the container; the documented `chmod 600 relay/secrets/*` is unreadable by the containers' fixed non-root `uid 10001` on any host. `docs/deployment-operations.md` now specifies `chmod 644` instead.
- 2026-08-09: With the fix applied, ran a real HMAC-signed `POST /api/v1/probes` against a live public Wowza RTSP test stream (`rtsp://.../app-p5260J38/...`, not a fixture). Confirmed the port-allowlist gate correctly rejects it on the default `554,8554` policy (its port is 1935), then confirmed a real successful probe after widening `RELAY_ALLOWED_CAMERA_PORTS` for that test only: real DNS pinning, real TCP RTSP connect, real `ffprobe` codec detection (H.264 Main, B-frames present, 854x480@30fps), and a correct `transcoded` mode decision. This exercised `network.ts` and `probe.ts` against genuine external traffic, not mocks.
- 2026-08-09: MediaMTX's own Docker healthcheck (`wget` against its Control API, 3s timeout) reported `unhealthy` throughout local testing even though the API was independently confirmed correct (proper `401` on unauthenticated calls, matching its JWT-auth wiring). Cross-container HTTP calls in this particular sandbox (nested Docker Desktop under WSL2) measured 10-20s for what should be a sub-millisecond loopback-adjacent call; a `docker run --network ... curl` test against the same endpoint independently reproduced ~19s response time. This looked like sandbox-specific container networking overhead, not an application defect, but has not been confirmed absent on a real dedicated Linux Docker host — watch this on first real bring-up and treat a repeat as a real finding, not an assumed artifact.

Useful checks after changing the UI:

```bash
export PATH=/tmp/18nover-node-runtime/node-v24.19.0-linux-x64/bin:$PATH
npm run typecheck
npm run lint
npm run build
node --test tests/rendered-html.test.mjs
```

Relay checks:

```bash
cd relay
export PATH=/tmp/18nover-node-runtime/node-v24.19.0-linux-x64/bin:$PATH
npm run typecheck
npm test
npm run build
docker compose --env-file .env.example -f docker-compose.yml config --quiet
```

## Critical workspace warning (historical, resolved)

The paragraphs below described a 2026-08-05 low-disk-space incident on a Windows-hosted workspace at `C:\18nover\onlystream`. As of 2026-08-09 the canonical workspace is a normal, fully tracked git repository at `/home/jerry/18nover/18nover.gay` on native Linux with a real `origin` remote (`github.com/18nover/18nover.gay`) — none of the `/tmp` symlink workarounds or disk-space constraints described below apply anymore. Left in place only as history in case anything references the old paths.

The canonical project was moved to `C:\18nover\onlystream` on 2026-08-05, nested under the `18nover` company directory. The former generated Codex workspace directory was emptied, but Windows may keep that empty directory locked until the original Codex task closes. Do not treat the former path as another project copy.

The Windows `C:` volume currently reports 100% utilization with about 1.1 GB free. A prior edit failed mid-write when free space reached zero. `src/app/dashboard.tsx` was recovered from the verified source archive, and the required `src/build/sites-vite-plugin.ts` was restored from the identical Sites starter.

Only regenerable caches were removed. Current temporary runtime links are:

```text
node_modules -> /tmp/18nover-site-deps.NMOC1U/node_modules
relay/node_modules -> /tmp/18nover-relay-deps.Iwjfif/node_modules
dist -> /tmp/18nover-dist
.vinext -> /tmp/18nover-vinext-cache
.wrangler -> /tmp/18nover-wrangler
Node runtime -> /tmp/18nover-node-runtime/node-v24.19.0-linux-x64
```

These `/tmp` paths are ephemeral. Free substantial Windows disk space before reinstalling dependencies, building Docker images, or assuming the setup will survive a WSL/reboot boundary. Do not delete source directories to make space. In particular, do not delete `src/build/`; it contains required source.

## Worktree state (historical, resolved)

This described an earlier state where application files were untracked (`??`). As of 2026-08-09 the repository is a normal tracked git history on `main` with a GitHub `origin` remote; this section no longer describes the current repo.

The repository currently shows the application files as untracked (`??`) because this workspace began as a generated project without an established tracked baseline. Treat all visible source as intentional user work. Do not run reset, checkout, clean, or broad deletion commands.

Generated runtime symlinks and deliverables are ignored. Inspect exact file names and secret patterns before any future commit or archive.

## Not verified and not shipped

- The custom MediaMTX image and the controller image have been built and booted successfully, but only locally in a sandbox (nested Docker Desktop/WSL2), never yet on the real target production host.
- No real RTSP/RTSPS source, public stream hostname, or production Sites identity list has been supplied yet. The operator has a real camera, but it's at home and wasn't reachable this session; a real Linux Docker host is reportedly ready but connection details haven't been shared yet either.
- Real camera **playback** (WHEP/ICE through a browser), RTSPS, redirect-negative, 12-viewer capacity, restart rehydration, backup/restore, and credential-leak acceptance remain deployment gates. (Real camera **probe** — SSRF/port-allowlist gate plus `ffprobe` codec detection — was exercised successfully against a live public test stream; see Latest verification above. That is not a substitute for the real-camera gate in `docs/deployment-operations.md`, which must run against the operator's actual camera from the actual production origin.)
- The updated site has not been published. How Sites publishing actually works was clarified this session: candidate versions, env vars/secrets, and the audience allowlist are all managed through the ChatGPT web/desktop app's Sites panel — there is no CLI/API for it in this repo. The `NOVER_*`/`SITES_ORIGIN`/relay HMAC env var table in `docs/deployment-operations.md` is what to paste into that panel.
- 2026-08-10: Identified and reached the real Docker host: `lockard-tech`, a Tailscale-connected home machine at LAN address `192.168.1.90`. Confirmed reachable via SSH from the operator's Windows/PowerShell terminal. **Not reachable from a Claude Code session running in this repo's WSL2 sandbox** — direct LAN (port 22) times out, and the sandbox's own Tailscale identity shows `lockard-tech` as offline/unreachable via relay even while the operator's Windows machine reaches it fine; there's also no WSL/Windows interop (`powershell.exe` isn't on `PATH`) to route around it. Conclusion for future sessions: any hands-on work against `lockard-tech` must run from a Claude Code session started directly on that host (or another host that actually reaches it), not relayed command-by-command through this sandbox.
- 2026-08-10: Ran the host-baseline audit from `docs/deployment-operations.md` against `lockard-tech`: Docker 29.7.1 and Compose v5.4.0 both clear the 27/v2.30 minimum; disk has 70G free of 114G (minimum is 40G). CPU and RAM fall short of the stated baseline (8 vCPU / 16 GiB): `lockard-tech` has **4 vCPU and 3.7 GiB total RAM**, with only ~223 MiB free / 3.2 GiB available at idle before this stack even starts. Operator decision: proceed with bring-up on this hardware anyway, scoped to **single-camera integration testing only** (Direct or one Transcoded stream). Do not attempt the two-camera/12-viewer capacity acceptance run on this host without more RAM/CPU first — treat that gate as blocked on a hardware upgrade, not just untested.
- 2026-08-10: Repo cloned onto `lockard-tech` at `~/18nover` (from `https://github.com/18nover/18nover.gay.git`). A sibling directory `~/onlymen` also exists on that host from unrelated prior work — leave it alone.
- 2026-08-10: Confirmed intended public domain is `18nover.gay` (matches the GitHub repo name). DNS pointing and router port-forwarding (TCP 80/443, TCP+UDP 8189) from the public internet to `lockard-tech`'s private LAN address are not yet confirmed — `lockard-tech` only has a private RFC1918 address, so this needs either port-forwarding or a tunnel (Tailscale Funnel/Cloudflare Tunnel) before `18nover.gay` can actually reach it.

Do not describe those items as complete.

## Inputs still required

1. ~~Linux Docker host connection details~~ — resolved 2026-08-10: `lockard-tech`, reachable via SSH from the operator's Windows terminal (not from this repo's WSL2 sandbox — see note above). Host baseline is short on CPU/RAM; proceeding at single-camera scope only.
2. DNS for `18nover.gay` pointed at a public entry point, plus router port-forwarding or a tunnel to `lockard-tech`'s private LAN address (`192.168.1.90`) for TCP 80/443 and TCP+UDP 8189. Not yet confirmed.
3. TCP 80/443 and UDP/TCP 8189 reachability from the public internet — blocked on item 2.
4. The operator's real RTSP/RTSPS camera and read-only credentials — operator reports the camera is now set up and ready at home. Credentials still need to be entered directly into the running dashboard's Host **Add RTSP Camera** sheet once the stack is live; they were correctly never typed into this session's chat/terminal and must not be in the future either.
5. Stable Sites Host, Moderator, and Member user IDs.
6. Existing authenticated realtime WebSocket and audio-only LiveKit integration details if those companions must be live.

## Recommended next actions

1. Preserve the hydration regression test and light-first theme behavior.
2. From a Claude Code session (or shell) running directly on `lockard-tech`: create `relay/.env` and secrets with the corrected `chmod 644` step, confirm DNS/port-forwarding for `18nover.gay` land on this host, build the custom MediaMTX image, bring up the full stack including Caddy/TLS, and confirm `/healthz` and `/readyz` from outside the host.
3. Run the redirect and pinned-destination tests that fit within single-camera scope; defer full container-isolation/capacity testing until the hardware gap (4 vCPU/3.7 GiB vs. the 8/16 baseline) is addressed.
4. Add the operator's real camera through the Host sheet and validate Direct or Transcoded playback end to end (not just the probe step already exercised against a public test stream in the prior session).
5. Deploy an access-restricted Sites candidate through the ChatGPT Sites panel for named operators only, using the env var table in `docs/deployment-operations.md`.
6. Run the WHEP lifecycle gate at single-camera scope. Defer the two-camera/12-viewer capacity, rollback, and credential-leak gates until `lockard-tech` (or a replacement host) meets the stated baseline.
7. Widen access only after every applicable gate passes.

## UI follow-up ideas

- Reduce eight status cards to four primary metrics with advanced diagnostics collapsed below.
- Increase the smallest labels, timestamps, and badges to approximately 11–12 px.
- Give offline Host camera cards a visible reason plus direct **Retest** action.
- Add unread counters and **Jump to latest** controls to Chat and Guide.
- Also expose theme selection in the profile menu under **Appearance**.

## Deliverable fingerprints

- `outputs/18nover-source.tar.gz`  
  SHA-256: `4dc05d32759a13a0f22e2400459c8cbae2f75da816aee61848a0ddaa6e35a787`
- `outputs/18nover-social-card.png`  
  SHA-256: `776e174ff1ac3a60c6b4a62f894d11b8fc8ead02f0bbb1de33b9fdb7e46567c7`

Never put camera URLs, credentials, HMAC keys, database keys, JWT private keys, SDP, bearer tokens, or process argument dumps into a prompt, commit, log bundle, or handoff.
