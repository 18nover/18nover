# 18nover — AI handoff

Updated: 2026-08-05  
Workspace: `C:\18nover\onlystream` (WSL: `/mnt/c/18nover/onlystream`)

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
- Relay tests: 16/16.
- Docker Compose configuration render with the example environment.
- MediaMTX patch dry-run against the exact pinned commit.
- Source archive extraction and non-fixture credential-shape scan.

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

## Critical workspace warning

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

## Worktree state

The repository currently shows the application files as untracked (`??`) because this workspace began as a generated project without an established tracked baseline. Treat all visible source as intentional user work. Do not run reset, checkout, clean, or broad deletion commands.

Generated runtime symlinks and deliverables are ignored. Inspect exact file names and secret patterns before any future commit or archive.

## Not verified and not shipped

- Docker daemon/server was unavailable here; only Docker client 29.7.1 was present.
- The custom MediaMTX image has not been built or run on the target host.
- No real RTSP/RTSPS source, public stream hostname, or production Sites identity list was supplied.
- Real camera probe/playback, WHEP/ICE, RTSPS, redirect-negative, 12-viewer capacity, restart rehydration, backup/restore, and credential-leak acceptance remain deployment gates.
- The updated site has not been published.

Do not describe those items as complete.

## Inputs still required

1. Linux Docker host connection.
2. Public stream hostname and DNS/TLS control.
3. TCP 80/443 and UDP/TCP 8189 reachability.
4. Public RTSP/RTSPS camera URL and read-only credentials.
5. Stable Sites Host, Moderator, and Member user IDs.
6. Existing authenticated realtime WebSocket and audio-only LiveKit integration details if those companions must be live.

## Recommended next actions

1. Free at least several gigabytes on `C:` and confirm durable dependencies can be restored.
2. Preserve the hydration regression test and light-first theme behavior.
3. On the selected Docker host, create secrets from the deployment runbook and build the custom MediaMTX image.
4. Run the redirect, pinned-destination, RTSPS, and container-isolation tests.
5. Add one real read-only camera and validate Direct or Transcoded playback.
6. Deploy an access-restricted Sites candidate for named operators only.
7. Run WHEP lifecycle, two-camera/12-viewer capacity, rollback, and credential-leak gates.
8. Widen access only after every gate passes.

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
