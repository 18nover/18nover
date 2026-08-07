# Lockard Live

Lockard Live is a private, desktop-first, one-to-many RTSP camera streaming dashboard. Hosts get a VLC-style **Open Network Stream** workflow; viewers receive authenticated WHEP/WebRTC playback and never receive a camera URL or credential.

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

To preview Host controls locally, set the explicit loopback-only `LOCKARD_DEV_*` values in `.env.local` and set `SITES_ORIGIN` to the exact printed local origin. A real session still requires a reachable relay and matching HMAC key.

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
