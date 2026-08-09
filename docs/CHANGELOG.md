# 18nover — changelog

All dates are 2026-08-05 unless noted otherwise.

## 2026-08-09 — First real relay boot, controller boot-blocking bug fix

### Added

- Companion sidebar collapse toggle: a chevron button by the resize handle that zeros `--sidebar-width`, animated with a 220ms `grid-template-columns` transition, styled for both themes and hidden on the mobile breakpoint.
- `relay/test/config.test.ts`: `loadConfig()` had zero prior test coverage. Now covers the exact `MEDIAMTX_*_ORIGIN` values `docker-compose.yml` sets, a rejected non-root internal-origin path, and a rejected non-HTTPS Sites origin.

### Fixed

- `relay/src/config.ts`'s `internalOrigin()` required `url.pathname === "/"` for every internal media origin, but `rtsp://mediamtx:8554` — the literal `MEDIAMTX_RTSP_ORIGIN` value `docker-compose.yml` sets — parses to pathname `""` under WHATWG URL rules, since `rtsp:` isn't a "special" scheme that gets normalized to `/`. This meant the controller could never boot with the shipped compose file, on any host. Now accepts both `""` and `/` as "no path."
- `docs/deployment-operations.md`'s secret-generation commands specified `chmod 600 relay/secrets/*`. Docker Compose's non-Swarm file secrets bind-mount the host file's own permission bits into the container as-is; the controller/MediaMTX containers run as fixed non-root `uid 10001`, which can never read a mode-0600 file owned by whatever host account generated it. Changed to `chmod 644` (the containing `relay/secrets/` directory stays mode-0700).

### Verified

- First-ever local build and boot of the real relay stack in this repo's history (`docs/HANDOFF.md` had "Docker daemon/server was unavailable" and "custom MediaMTX image has not been built or run" as open items). Built `18nover-mediamtx:1.19.3-redirect-guard` from the exact pinned upstream commit with the redirect-guard patch applied (the Dockerfile's own commit-hash assertion passed), built the controller image, and — after the two fixes above — got the controller to `controller_ready`/`healthy`.
- Ran a real HMAC-signed `POST /api/v1/probes` against a live public Wowza RTSP test stream (not a fixture): confirmed the port-allowlist gate rejects it under the default `554,8554` policy, then confirmed a real successful probe after widening the allowlist for that test only — real DNS pinning, real TCP connect, real `ffprobe` codec detection (H.264 Main, B-frames, 854x480@30fps), correct `transcoded` decision.
- Sites app: lint, typecheck, build, and all 3 rendered-HTML tests pass. Relay: typecheck and 19/19 tests pass (16 prior + 3 new).
- Clarified how Sites publishing actually works: candidate versions, env vars/secrets, and audience allowlists are managed through the ChatGPT web/desktop app's Sites panel, not a CLI in this repo.

### Not verified

- None of the above ran on the operator's actual production Linux host — only in a local sandbox (nested Docker Desktop under WSL2), which also showed unusually slow cross-container network latency (10-20s for calls that should be near-instant) that may or may not reproduce on a real host; flagged in `docs/HANDOFF.md` to watch for, not assumed fixed.
- The operator's real camera (at home, not available this session), real DNS/TLS, real WHEP/browser playback, 12-viewer capacity, backup/restore, and the fail-closed credential-leak audit remain open per `docs/deployment-operations.md`'s production audience gate.

## Workspace relocation

- Moved the canonical project from the generated Codex workspace to `C:\18nover\onlystream` (WSL: `/mnt/c/18nover/onlystream`), nested under the `C:\18nover` company directory.
- Preserved the complete Git repository, Sites configuration, source, relay, tests, documentation, and generated deliverables.
- Kept `docs/HANDOFF.md` and `docs/CHANGELOG.md` as the canonical project records without creating duplicate copies.

## Light-first theme and hydration repair

### Added

- Light mode as the deterministic default dashboard theme.
- Persistent moon/sun theme toggle in the header.
- Device-local theme preference under `18nover-theme`.
- Complete light treatment for the header, status rail, camera cards, companion panels, voice footer, sheets, dialogs, toasts, forms, and tooltips.
- Dark media-island treatment retained for the primary video and glass player controls in both themes.
- SSR regression assertions for default light mode, the theme control, and the stable stream-clock placeholder.

### Fixed

- React hydration mismatch caused by `useState(new Date())` plus server/browser timezone and second differences.
- Server HTML now renders `--:--:--`; the localized clock begins asynchronously after hydration.
- Keyboard focus now reveals the chat message overflow action, not only pointer hover.
- Restored the required `src/build/sites-vite-plugin.ts` after it was incorrectly treated as disposable output during emergency disk cleanup.
- Updated ignore rules so temporary `dist`, `.vinext`, and `.wrangler` symlinks cannot be staged accidentally.

### Verified

- Application TypeScript: pass.
- ESLint: pass.
- vinext production build: pass.
- Rendered tests: 3/3 pass.
- Local SSR response includes `data-theme="light"` and `data-stream-clock="true">--:--:--`.
- Social image continues to return HTTP 200 with the expected PNG type and length.

### Operational incident

- The Windows `C:` drive reached zero free bytes and interrupted a source-file write.
- Recovered `src/app/dashboard.tsx` from the previously verified source archive.
- Removed only regenerable caches and moved active build/runtime caches to `/tmp` symlinks.
- The drive now reports approximately 1.1 GB free but remains at 100% utilization; further durable work requires cleanup.

## RTSP relay and browser playback implementation

### Added

- Host camera probe, create, replace, retest, enable/pause, and confirmed-delete Sites routes.
- Safe `CameraSummary` contract that excludes source URL and credentials.
- TypeScript relay controller with encrypted SQLite persistence, sanitized audit events, camera reconciliation, metrics, and health/readiness endpoints.
- URL normalization, approved-port enforcement, special-network blocking, full DNS-answer validation, selected-address pinning, reconnect revalidation, and TCP-only transport.
- RTSPS trusted TLS preflight, original-hostname SNI, and certificate fingerprint pinning.
- FFprobe camera test workflow reporting codecs, profile, B-frames, resolution, FPS, bitrate, audio, last frame, available outputs, and Direct/Transcoded mode.
- Direct browser-compatible H.264 pass-through and FFmpeg low-latency H.264/Opus rendition planning.
- Two-worker CPU transcoding limit, restart supervision, and circuit breaking.
- Eight-camera registration limit and four-warm-source limit.
- MediaMTX path creation, rehydration, telemetry, and status refresh.

### Security

- AES-GCM source and credential storage with record-bound associated data.
- Same-origin Sites access with explicit Host/Moderator/Member allowlists.
- HMAC request binding to timestamp, nonce, method, path, and body digest.
- Persistent nonce replay protection, including future-dated replay coverage.
- ES256 JWKS and five-minute exact-path read permissions.
- Controller-owned WHEP gateway with one-use grants, three active sessions per viewer, renewable ten-minute leases, bounded SDP, strict upstream location checks, and authenticated cleanup.
- Custom MediaMTX v1.19.3 build pinned to commit `5ccc80ad7b1609330a4c397c51a7e701f963d74f`.
- MediaMTX patch denies RTSP redirects before logging and restricts source dialing to the exact validated TCP tuple.
- Private MediaMTX RTSP, WHEP HTTP, Control API, metrics, and profiling listeners.
- Non-root controller and MediaMTX containers, read-only filesystems, dropped capabilities, no Docker socket, bounded CPU/memory/PIDs, and private control networking.

### Reliability

- Camera switches keep the current video visible until the target's first frame.
- Successful switch crossfades for approximately 300 ms.
- Failed switch retains the current camera.
- Bounded reconnect obtains fresh playback credentials and eventually shows an explicit unavailable state.
- Substream failure does not take down an otherwise healthy main stream.
- Stale activation generations cannot overwrite newer readiness state.
- Transcoder terminal failures enter a bounded circuit rather than restart indefinitely.
- WHEP reader performs lease keepalive and cleanup.

### Voice and companions

- Audio-only LiveKit connection and remote audio-track attachment.
- Push-to-talk keyboard handling with input/contenteditable protection, keyup, window-blur, and visibility fail-safes.
- Production Chat, Guide, and Members panels no longer present preview events as real data.
- Video, realtime companions, and voice degrade independently.

### Tests

- Relay security/unit suite reached 16/16 passing tests.
- Coverage includes HMAC binding and replay, ES256 path scope, one-use/capped WHEP grants, AES-GCM tamper detection, encrypted persistence, address rejection, source pinning, codec decisions, and transcoder capacity.
- Docker Compose configuration render passed with the example environment.
- MediaMTX redirect patch applied cleanly in a dry run against the exact pinned commit.

## Dashboard product implementation

### Added

- Premium desktop-first three-column livestream dashboard.
- Sticky header with 18nover branding, live/standby state, uptime, health, viewer count, search, notification center, and profile controls.
- Left operations rail with viewers, voice, camera, bitrate, latency, FPS, CPU, and network status.
- Large 16:9 primary stage with dark glass overlays and hover player controls.
- Horizontal camera switcher with Host-only registration card and camera context menus.
- Chat, AI Guide event log, and Members tabs.
- Persistent voice footer with speaking avatars and push-to-talk hint.
- Command palette, contextual menus, tooltips, toasts, empty states, and responsive layouts.
- Local-only canvas snapshot generation.
- IBM Plex Sans, IBM Plex Mono, and Space Grotesk.

### Guardrails

- No meeting join/leave language.
- No viewer camera permission.
- No participant video grid.
- Microphone permission occurs only after an explicit voice action.
- No simulated production camera footage.

## Social artwork

### Changed

- Replaced the broken social image with a generated, reference-informed 18nover infrastructure card.
- Saved the verified image as `public/og.png` and `outputs/18nover-social-card.png`.
- Updated Open Graph and X metadata to use the exact 1731 x 909 PNG.
- Added PNG signature and IHDR dimension regression coverage.

### Verified

- PNG is RGB, non-interlaced, 1,235,777 bytes.
- SHA-256: `776e174ff1ac3a60c6b4a62f894d11b8fc8ead02f0bbb1de33b9fdb7e46567c7`.

## Documentation and release controls

### Added

- Deployment and operations runbook.
- Source-network and custom MediaMTX maintenance policy.
- Access-restricted Sites candidate workflow.
- Real-camera Direct/Transcoded integration checklist.
- Two-camera, 12-viewer, 30-minute capacity runbook.
- Quiesced database backup and coordinated rollback/restore procedure.
- Security trust-boundary and negative-test matrix.
- Fail-closed raw and encoded credential-leak audit.

### Not released

- No real camera, stream domain, DNS/TLS control, stable Sites identity list, or working Docker daemon was available in this workspace.
- The Docker stack and custom MediaMTX image have not been run here.
- Real RTSP/WHEP/ICE, RTSPS, redirects, capacity, backup/restore, and leak-audit gates remain open.
- Private Sites publication is intentionally blocked until those checks pass.
