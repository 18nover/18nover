# Lockard Live security acceptance

Run this checklist against an access-restricted Sites candidate before the first production audience is admitted and after any change to identity mapping, source validation, authentication, WHEP signaling, media routing, logging, container isolation, the custom MediaMTX patch, or secrets. Record sanitized evidence and an accountable operator for every result.

## Trust boundaries

- **Browser -> Sites:** Sites supplies an authenticated stable user ID. Lockard Live admits it only when the ID appears in an explicit Host, Moderator, or Member allowlist. Browser API writes require the exact configured origin and same-origin fetch context; only Host may manage cameras.
- **Sites -> controller:** HMAC-SHA256 binds version, timestamp, one-time nonce, method, exact path, and exact body digest. Clock skew is at most 30 seconds, replay nonces persist in SQLite, and responses are reconstructed from safe fields.
- **Browser -> controller WHEP gateway:** Caddy forwards `/whep/*` to the controller. A five-minute ES256 bearer grant is valid once, for one exact output path and `read` only. One viewer may hold at most three active resources. The gateway enforces exact CORS origin, bounded SDP, a renewable ten-minute lease, and authenticated `HEAD`/`DELETE` ownership.
- **Controller -> MediaMTX:** Control API and WHEP HTTP stay on the internal control network and require path-scoped JWTs. MediaMTX validates the controller's JWKS issuer and audience. The browser never reaches MediaMTX WHEP HTTP directly.
- **Controller/MediaMTX -> camera:** The controller accepts only public RTSP/RTSPS endpoints on approved ports, validates every DNS answer, chooses and pins one address/port, and repeats validation on reconnect. Source transport is TCP-only. RTSPS is preflighted with trusted-chain/hostname validation and a SHA-256 peer-certificate fingerprint.
- **Custom MediaMTX source client:** The supplied image is built from MediaMTX v1.19.3 exact commit `5ccc80ad7b1609330a4c397c51a7e701f963d74f` plus a local patch that denies RTSP redirects and refuses any source TCP dial except the exact pinned tuple. Treat this as a security fork that requires explicit revalidation on upgrade.
- **WebRTC media:** Once WHEP signaling succeeds, MediaMTX sends browser media only through the published ICE paths on UDP/TCP 8189. Chat/Guide/presence and audio-only LiveKit voice remain separate failure domains.
- **Camera secrets:** Complete source URLs and separate credentials are encrypted with AES-256-GCM, random 96-bit IVs, and camera/record-version AAD. Only encrypted envelopes and keyed duplicate fingerprints persist. FFprobe and FFmpeg read private MediaMTX paths, so raw camera sources and credentials must not appear in their process arguments.

## Automated and integration negative tests

Retain automated tests where practical and run host/real-network cases as integration tests:

| Boundary | Required rejection or behavior |
| --- | --- |
| URL parser | HTTP(S), file, data, embedded URL credentials, malformed percent encoding, fragments, CR/LF/NUL, oversized URLs |
| Address policy | loopback, private, link-local, CGNAT, metadata, documentation, multicast, unspecified, NAT64/6to4 and IPv4-mapped IPv6 |
| DNS | timeout, empty answers, any non-global answer, and a changed/rebound answer at reconnect |
| Ports | every port except 554/8554 unless the operator explicitly changes the deployment allowlist; RTSPS default 322 is rejected until approved |
| RTSP transport | UDP selection, `rtspAnyPort`, and a library request to dial anything except the exact pinned TCP tuple |
| RTSP redirects | 301-305 to loopback, metadata, private address, another global IP, or another port; the target receives no connection and logs contain no `Location` value |
| RTSPS | untrusted chain, expired certificate, hostname mismatch, failed SNI, TLS below 1.2, and a certificate that changes between controller preflight and MediaMTX connect |
| Sites membership | authenticated identity absent from all three allowlists; empty Host list in production |
| Sites role | Member or Moderator probe, create, patch, retest, pause, or delete |
| Same origin | absent/mismatched `Origin`, non-`same-origin` `Sec-Fetch-Site`, wildcard WHEP CORS |
| Relay HMAC | unknown key, wrong signature, body/path/method tamper, more than 30-second skew, duplicate nonce, future-dated replay |
| Object access | cross-camera opaque ID, malformed ID, unsafe replacement, and actor ID omission/tamper |
| MediaMTX JWT | expired token, wrong issuer/audience/path/action, and publish/API attempt with a read token |
| WHEP grant | missing/expired token, second `POST` with the same token, wrong path, fourth active session for one viewer, oversized SDP, redirect, invalid upstream `Location` |
| WHEP resource | wrong token/resource pair, lease expiry, missing keepalive, duplicate cleanup, controller restart, browser reconnect, abandoned-session cleanup |
| Capacity | fifth warm source, ninth registered camera, third active CPU transcoder; no silent quality degradation |
| Media | unreachable/auth-failed source, stalled frames, malformed ffprobe JSON, probe timeout, bounded-output overflow, substream failure without main-stream loss |
| Secrets | API/log/error/audit/browser/build/process data contains no raw or encoded camera source, credential, relay HMAC, database key, or private-key fragment |

The committed relay suite covers AES-GCM AAD/tamper, keyed source fingerprints/redaction, persistent nonces, HMAC binding and future-dated replay, exact-path ES256 permissions, one-use/capped viewer grants, address classes, URL pinning, codec planning, and transcoder capacity. The custom MediaMTX image, redirect handling, RTSPS handshake, DNS reconnect, complete WHEP proxy lifecycle, Docker isolation, ICE, and real cameras remain integration gates on the selected host.

For redirect testing, operate a public test RTSP endpoint that returns each malicious `Location` while a second endpoint records connection attempts. The Lockard probe must fail generically, the second endpoint must record zero connections, and MediaMTX logs may say only that a redirect was rejected. Repeat with a legal first response that later tries to switch port/address. Do not use production camera credentials in this fixture.

## Fail-closed credential-leak audit

Run this on the Linux Docker host from the repository root **after** a production build and representative Direct, Transcoded, failure, reconnect, WHEP, and camera-management activity. It deliberately writes secret patterns, container logs, and process listings only to a mode-0700 temporary directory. Patterns never appear in scanner process arguments. The audit fails when it finds a filename and also fails on scanner, permissions, log, or process-inspection errors; do not append `|| true`.

```bash
set -euo pipefail
umask 077
LOCKARD_AUDIT_DIR=$(mktemp -d)
trap 'find "$LOCKARD_AUDIT_DIR" -type f -delete; rmdir "$LOCKARD_AUDIT_DIR"' EXIT
LOCKARD_AUDIT_PATTERNS="$LOCKARD_AUDIT_DIR/patterns"
LOCKARD_AUDIT_CAMERA_RAW="$LOCKARD_AUDIT_DIR/camera-raw"
: > "$LOCKARD_AUDIT_PATTERNS"
: > "$LOCKARD_AUDIT_CAMERA_RAW"

append_lockard_pattern() {
  local LOCKARD_LABEL=$1
  local LOCKARD_VALUE
  IFS= read -r -s -p "$LOCKARD_LABEL: " LOCKARD_VALUE
  printf '\n' >&2
  if [ -n "$LOCKARD_VALUE" ]; then
    printf '%s\n' "$LOCKARD_VALUE" >> "$LOCKARD_AUDIT_CAMERA_RAW"
  fi
  unset LOCKARD_VALUE
}

append_lockard_pattern 'Complete RTSP/RTSPS URL'
append_lockard_pattern 'Camera username'
append_lockard_pattern 'Camera password'
append_lockard_pattern 'Vendor path/query token (blank if none)'

node - "$LOCKARD_AUDIT_CAMERA_RAW" "$LOCKARD_AUDIT_PATTERNS" <<'NODE'
const fs = require('node:fs');
const cameraInput = process.argv[2];
const output = process.argv[3];
const add = (value) => {
  const text = String(value ?? '').trim();
  if (text) fs.appendFileSync(output, `${text}\n`, { mode: 0o600 });
};
for (const value of fs.readFileSync(cameraInput, 'utf8').split(/\r?\n/).filter(Boolean)) {
  const bytes = Buffer.from(value, 'utf8');
  add(value);
  add(encodeURIComponent(value));
  add(encodeURIComponent(value).replace(/%[0-9A-F]{2}/g, (match) => match.toLowerCase()));
  add(new URLSearchParams([['v', value]]).toString().slice(2));
  add(bytes.toString('base64'));
  add(bytes.toString('base64url'));
  add(bytes.toString('hex'));
  add(JSON.stringify(value).slice(1, -1));
}
const hmac = JSON.parse(fs.readFileSync('relay/secrets/relay_hmac_keys.json', 'utf8'));
for (const value of Object.values(hmac)) add(value);
add(fs.readFileSync('relay/secrets/db_master_key', 'utf8'));
for (const line of fs.readFileSync('relay/secrets/relay_jwt_private_key.pem', 'utf8').split(/\r?\n/)) {
  if (!line.startsWith('---') && line.length >= 16) add(line);
}
NODE

sort -u -o "$LOCKARD_AUDIT_PATTERNS" "$LOCKARD_AUDIT_PATTERNS"
[ -s "$LOCKARD_AUDIT_PATTERNS" ]

docker compose --env-file relay/.env -f relay/docker-compose.yml logs --no-color > "$LOCKARD_AUDIT_DIR/compose.log"
for LOCKARD_SERVICE in controller mediamtx caddy; do
  LOCKARD_CONTAINER_ID=$(docker compose --env-file relay/.env -f relay/docker-compose.yml ps -q "$LOCKARD_SERVICE")
  [ -n "$LOCKARD_CONTAINER_ID" ]
  docker top "$LOCKARD_CONTAINER_ID" -eo pid,user,comm,args >> "$LOCKARD_AUDIT_DIR/process-list.txt"
done

LOCKARD_AUDIT_TARGETS=(
  README.md app lib public docs .env.example
  relay/src relay/test relay/Caddyfile relay/Dockerfile relay/docker-compose.yml
  relay/mediamtx.yml relay/.env.example relay/package.json relay/package-lock.json
  relay/tsconfig.json relay/mediamtx
  "$LOCKARD_AUDIT_DIR/compose.log" "$LOCKARD_AUDIT_DIR/process-list.txt"
)
for LOCKARD_OPTIONAL_TARGET in build dist .vinext relay/dist; do
  if [ -e "$LOCKARD_OPTIONAL_TARGET" ]; then
    LOCKARD_AUDIT_TARGETS+=("$LOCKARD_OPTIONAL_TARGET")
  fi
done

set +e
rg -l -F -f "$LOCKARD_AUDIT_PATTERNS" "${LOCKARD_AUDIT_TARGETS[@]}"
LOCKARD_AUDIT_STATUS=$?
set -e
if [ "$LOCKARD_AUDIT_STATUS" -eq 0 ]; then
  printf '%s\n' 'FAIL: a protected value was found in one or more files above.' >&2
  exit 1
fi
if [ "$LOCKARD_AUDIT_STATUS" -ne 1 ]; then
  printf 'FAIL: credential scanner exited with status %s.\n' "$LOCKARD_AUDIT_STATUS" >&2
  exit "$LOCKARD_AUDIT_STATUS"
fi
printf '%s\n' 'PASS: no protected value found in the audited targets.'
```

Short/common usernames can produce legitimate filename matches; that is still a failed run until each match is inspected and the account is replaced with a unique read-only credential or the finding is otherwise resolved. Never suppress a match or scanner error to make the gate pass.

The source archive/deliverable must be built with `relay/secrets`, `relay/.env`, runtime databases, logs, packet dumps, `work`, browser profiles, and dependency caches excluded. Extract each final archive into a new mode-0700 temporary directory and run the same fixed-string scan on the extracted tree before release; do not assume scanning a compressed file is sufficient.

## Database, API, and browser inspection

Inspect SQLite metadata without selecting `encrypted_secret` or `source_fingerprint`:

```bash
docker compose --env-file relay/.env -f relay/docker-compose.yml exec -T controller \
  node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/var/lib/lockard/relay.sqlite',{readOnly:true});console.log(d.prepare('select id,name,state,relay_mode,input_codec,width,height,fps,bitrate_kbps,audio,last_frame_at,error_code,enabled from cameras').all())"
```

The output must contain no source host, IP, port, path, query, username, password, encrypted envelope, or reversible source identifier. Inspect sanitized actor audit rows as a separate query: actor ID, opaque camera ID, operation, result, timestamp, and safe error code only.

Using browser developer tools on Host, Moderator, and Member sessions, inspect Network, response bodies, Local Storage, Session Storage, IndexedDB, Cache Storage, service workers, console, and page source. Confirm:

- There is no `rtsp://`, `rtsps://`, camera host/address, source credential, encrypted envelope, HMAC value, database key, ES256 private key, or private MediaMTX origin.
- The browser receives only `CameraSummary`, telemetry, companion data, and the selected public WHEP URL/grant. The opaque output path may appear only where required for the public WHEP resource.
- Playback grants stay in memory and travel only in `Authorization` headers. They never appear in a query string, analytics, crash reports, service-worker cache, or persisted storage.
- Snapshots are created locally from the decoded frame, make no upload request, and revoke their object URL.

Container process listings may contain short-lived JWTs for private MediaMTX paths, but must never contain a camera source URL, camera address, username, password, or vendor token. Logs and errors must use opaque camera IDs and safe codes; the custom redirect warning must not log the rejected `Location`.

## Container and network checks

- Controller and MediaMTX run as numeric UID/GID 10001, with read-only root filesystems, all capabilities dropped, `no-new-privileges`, PID/memory/CPU limits, and no Docker socket.
- Do **not** claim the supplied Caddy container is non-root: the Compose file does not set a non-root user. It does run with a read-only root filesystem, `no-new-privileges`, all capabilities dropped except `NET_BIND_SERVICE`, and explicit PID/memory/CPU limits. Record that residual privilege in the deployment review, or separately redesign/test high internal ports before changing it.
- Only Caddy 80/TCP, 443/TCP+UDP, and MediaMTX 8189/TCP+UDP are host-published. Controller 8080 and MediaMTX 8554/8889/9997 are unreachable externally.
- The control network is internal. The controller has a separate camera-egress network for DNS/TLS validation; it has no Docker socket. MediaMTX source pulls are additionally restricted by the custom exact-tuple dial guard.
- MediaMTX uses JWT auth, has metrics/profiling/playback disabled, accepts only RTSP TCP, has `rtspAnyPort: no`, and keeps WHEP HTTP private.
- Test host firewall and an external port scan, not Compose YAML alone. Verify the relay cannot reach loopback, container/service networks, cloud metadata, private ranges, an unapproved port, or a redirect destination.
- Capture the exact custom MediaMTX image ID/digest. Rebuilds or upgrades do not inherit acceptance from an earlier artifact.

## Browser and WHEP behavior checks

- No viewer camera permission is requested anywhere.
- Microphone permission is requested only after explicit voice unmute or push-to-talk in a connected audio-only LiveKit room. No viewer video track is published or rendered.
- Video, Chat/Guide/presence, and LiveKit voice fail independently.
- A failed WHEP switch leaves the current reader and rendered frame intact. Successful switch crossfades only after the target's first frame; a failed target never substitutes footage.
- A grant older than five minutes cannot create a WHEP session. A second create with the same grant and a create for another path fail. The fourth active resource for the same viewer fails.
- An authenticated `HEAD` renews a valid resource's ten-minute lease. Wrong-token `HEAD`/`DELETE` do not reveal resource existence. Closing a reader sends `DELETE`; abandoned resources expire and are cleaned up.
- A controller restart does not turn stale in-memory ownership into authorization. Readers reconnect with new grants, per-viewer limits remain enforced, and orphaned MediaMTX sessions eventually disappear.
- Twelve-viewer cleanup returns reader counts and resource use to baseline after all readers close or leases expire.

## Backup and incident response

Follow the quiesced backup/restore procedure in [deployment-operations.md](deployment-operations.md): freeze camera changes, stop the controller database writer, snapshot the exact `relay_data` volume, coordinate repository/images/Sites version/database/master key as one rollback unit, and prove a restore before production access is widened.

If any protected value appears outside its allowed boundary, stop camera management and do not widen Sites access. Revoke the camera account, remove its relay paths, terminate related WHEP resources, and rotate the Sites HMAC and viewer JWT signing key as applicable. Preserve only sanitized audit metadata and investigate before restart. If `db_master_key` is suspected, treat every encrypted camera credential as compromised and rotate every camera account after recovering records in an isolated environment.

If the custom MediaMTX redirect/dial guard fails, stop all source activation, isolate the relay's egress, preserve the exact image ID and sanitized network evidence, and do not resume until a corrected image passes the full source-network suite.
