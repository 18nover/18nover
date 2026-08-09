# 18nover relay deployment and operations

18nover does not embed VLC. It reproduces VLC's **Open Network Stream** workflow while keeping the media source and credentials server-side:

`Public RTSP/RTSPS camera -> redirect-guarded MediaMTX/FFmpeg -> controller WHEP gateway -> WebRTC browser`

Release is deliberately two-stage. First deploy a Sites candidate whose access policy and 18nover identity allowlists contain only named integration operators. Run every real-camera, capacity, security, backup, and rollback gate from that exact origin. Only then may an operator widen the private Sites audience. If an access-restricted candidate cannot be created, stop; do not substitute a broadly accessible preview.

## Supported bring-up baseline

Use an x86-64 Linux Docker host with at least 8 vCPU, 16 GiB RAM, 40 GiB of SSD space, 1 GbE networking, accurate NTP, Docker Engine 27 or later, and Docker Compose v2.30 or later. This is a bring-up baseline for two CPU-transcoded 1080p30 feeds, not a capacity guarantee. Production approval requires the measured workload below.

The host needs:

- A stable public IPv4 address. Add IPv6 only after the complete ICE and firewall path is tested.
- A public DNS name such as `stream.example.com` resolving to the Docker host.
- TCP 80 and 443 for ACME and WHEP signaling.
- UDP 443 for HTTP/3 (optional, but enabled by the supplied Caddy service).
- UDP and TCP 8189 for WebRTC media/ICE.
- Outbound DNS, HTTPS/ACME, and TCP RTSP/RTSPS access to approved camera endpoints.

Never publish MediaMTX ports 8554, 8889, or 9997, or controller port 8080. MediaMTX RTSP, WHEP HTTP, and Control API plus the controller API are private Compose listeners. Caddy sends `/whep/*` to the controller gateway; browsers do not signal directly to MediaMTX.

## Source network policy

The hardened source path is TCP-only. The Sites sheet may display transport choice, but UDP is disabled by policy and both the controller and MediaMTX force RTSP-over-TCP. Only `rtsp` and `rtsps` are accepted.

- The default approved camera ports are 554 and 8554. Standard RTSPS port 322 or any other port must be added to `RELAY_ALLOWED_CAMERA_PORTS` through an explicit operator change and retested.
- Every DNS answer must be globally routable. The controller chooses one validated address, rewrites the source to that address, fixes the port, and repeats resolution/validation when reconnecting.
- For RTSPS, the controller performs a trusted TLS handshake to the pinned address using the original DNS name for SNI/certificate validation, computes the peer certificate's SHA-256 fingerprint, and gives that fingerprint to MediaMTX.
- `rtspAnyPort` remains disabled.
- The supplied `18nover-mediamtx:1.19.3-redirect-guard` image is built from exact upstream commit `5ccc80ad7b1609330a4c397c51a7e701f963d74f`. Its local patch removes RTSP redirect locations before they can be followed and refuses a source TCP dial unless its destination is the exact validated IP-and-port tuple.

Treat that MediaMTX image as a maintained security fork. A future MediaMTX upgrade requires a patch review, a successful patch application against the new exact commit, redirect/dial-target negative tests, and a newly approved image ID or registry digest. A version tag alone is not sufficient evidence.

## Linux Docker host: create configuration and secrets

Copy `relay/.env.example` to `relay/.env` and replace both hostnames. `SITES_ORIGIN` must exactly match the access-restricted candidate origin during integration.

Run from the repository root on the Linux Docker host. The containing directory stays mode-0700 (host-user-only), but the secret files themselves must end mode-0644: Compose's non-Swarm file secrets bind-mount the host file's own owner and permission bits straight into the container rather than remapping them, and the controller/MediaMTX containers run as their own fixed non-root uid `10001`, which will never match the host user that generates these files. A mode-0600 secret is therefore unreadable by the container that needs it, on any host:

```bash
install -d -m 700 relay/secrets
umask 022
openssl rand -base64 32 > relay/secrets/db_master_key
node -e "const fs=require('node:fs'),c=require('node:crypto');fs.writeFileSync('relay/secrets/relay_hmac_keys.json',JSON.stringify({'sites-v1':c.randomBytes(32).toString('base64')}),{mode:0o644})"
openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out relay/secrets/relay_jwt_private_key.pem
chmod 644 relay/secrets/*
```

Copy the `sites-v1` HMAC value to the Sites secret environment variable through the Sites environment UI/API. Do not paste it into shell history, repository files, issues, chat, or deployment logs. The database master key and ES256 private key stay only on the Docker host.

## Build and start the private relay

The custom MediaMTX image is part of the build, not an interchangeable public image:

```bash
docker compose --env-file relay/.env -f relay/docker-compose.yml config --quiet
docker compose --env-file relay/.env -f relay/docker-compose.yml build --pull controller mediamtx
docker image inspect 18nover-mediamtx:1.19.3-redirect-guard --format '{{.Id}}'
docker compose --env-file relay/.env -f relay/docker-compose.yml up -d
docker compose --env-file relay/.env -f relay/docker-compose.yml ps
curl --fail --silent --show-error https://stream.example.com/healthz
curl --fail --silent --show-error https://stream.example.com/readyz
```

Record the inspected custom MediaMTX image ID, controller image ID, repository revision, Compose config, and Sites candidate version in the release evidence.

Expected public behavior:

- `/healthz` returns `{"status":"ok"}`.
- `/readyz` returns HTTP 200 only after the controller can authenticate to the private MediaMTX API.
- `/.well-known/jwks.json` exposes only the ES256 public JWK.
- `/whep/<opaque-path>/whep` rejects a missing, expired, reused, wrong-path, or wrong-origin grant.
- Public requests to ports 8554, 8889, 9997, and 8080 fail at the network boundary.

## Deploy the access-restricted Sites candidate

Create a saved Sites candidate version restricted by the Sites access policy to named integration operators. Configure these server-side values; do not add them to `.openai/hosting.json` and never prefix them with `NEXT_PUBLIC_`:

| Name | Visibility | Value |
| --- | --- | --- |
| `SITES_ORIGIN` | normal | Exact access-restricted candidate HTTPS origin |
| `NOVER_RELAY_ORIGIN` | normal | Exact relay HTTPS origin |
| `NOVER_RELAY_HMAC_KEY_ID` | normal | `sites-v1` |
| `NOVER_RELAY_HMAC_SECRET_BASE64` | secret | Matching value from the relay HMAC JSON file |
| `NOVER_HOST_USER_IDS` | normal | Comma-separated stable Sites IDs allowed to manage cameras; at least one is required in production |
| `NOVER_MODERATOR_USER_IDS` | normal | Comma-separated stable Sites IDs that may view and use companion features but cannot manage cameras |
| `NOVER_MEMBER_USER_IDS` | normal | Comma-separated stable Sites IDs that may view and use companion features but cannot manage cameras |
| `NOVER_RELAY_TIMEOUT_MS` | normal | `10000` unless an operator approves another bounded value |

The application allowlists are an additional boundary, not a replacement for the Sites access policy. An authenticated Sites identity absent from all three lists must receive HTTP 403. If an ID appears in multiple lists, Host takes precedence, then Moderator, then Member. Only a Host can probe, create, edit, retest, pause, or delete cameras.

Do not configure any `NOVER_DEV_*` value in a hosted candidate or production. A Sites environment revision takes effect only after a new saved version is deployed. Because Caddy and the WHEP gateway enforce one exact `SITES_ORIGIN`, update the relay environment and retest CORS if the origin changes; do not temporarily allow `*`.

## WHEP authorization and lifecycle gate

The session route returns a five-minute ES256 viewer grant with one MediaMTX `read` permission for one exact output path. The controller stores only its hash and enforces the browser lifecycle:

1. A grant may create exactly one WHEP resource. Replaying it, changing its path, or using it after expiry is rejected.
2. One Sites viewer ID may have at most three active WHEP resources. A fourth is rejected rather than consuming unbounded MediaMTX readers.
3. A successful WHEP `POST` starts a ten-minute controller lease. Authenticated `HEAD` renews that lease; authenticated `DELETE` releases it and asks MediaMTX to close the resource.
4. An expired lease is removed and cleanup is attempted on the next WHEP request. MediaMTX/ICE expiry is the final fallback.
5. SDP request and response bodies are capped at 256,000 bytes, redirects are errors, and the upstream `Location` must identify the expected private MediaMTX origin, exact camera path, and a safe resource ID.

Test single use, wrong path, expired token, the per-viewer cap, `HEAD` renewal, `DELETE`, abandoned-resource expiry, controller restart, and browser reconnect. After a controller restart, its in-memory grant/resource ownership is gone; readers must reconnect and orphaned upstream sessions must expire without blocking new playback.

## Real-camera integration gate

Use a read-only camera account. The selected design accepts only public, globally routable sources. Loopback, RFC1918/private, link-local, carrier-grade NAT, documentation, multicast, metadata, and IPv4-mapped IPv6 destinations are rejected. If cameras later move to a private LAN, deploy an outbound edge connector instead of weakening this SSRF boundary.

For every approved camera:

1. Sign in to the access-restricted candidate as a named user in `NOVER_HOST_USER_IDS`.
2. Open **Add RTSP camera** and enter the URL plus the separate read-only username and password. Confirm only TCP is selectable.
3. Select **Test connection**. Confirm codec, B-frame status, dimensions, FPS, bitrate, audio codec, most recent frame, and Direct/Transcoded decision against an independent operator `ffprobe` run that does not expose its command line or output to viewers.
4. Save the camera. Confirm the browser receives only `CameraSummary`; responses contain no source host, path, query, username, password, encrypted envelope, or source fingerprint.
5. Start playback through the public stream domain. Confirm the displayed quality label corresponds to the path actually playing and only real output profiles appear.
6. Switch from Orbit to Explorer. The old frame stays visible until the target's first rendered frame, followed by a 300 ms crossfade. Break the target and repeat: the old camera must remain playing.
7. Disconnect and restore a source. Confirm bounded reconnect gets a fresh playback grant, the last frame is held only briefly, and the UI eventually reports an explicit unavailable state rather than simulated footage.
8. Toggle camera audio only after a click. Save a snapshot and confirm no upload or other network request occurs.
9. Exercise Moderator, Member, and non-member identities. Moderator/Member can view; all camera management calls fail. A non-member cannot obtain session or WHEP credentials.

For an RTSPS source, also rotate or replace its server certificate. A trusted replacement is accepted only after a fresh controller preflight produces a new fingerprint; an untrusted or hostname-mismatched certificate fails. Separately prove that MediaMTX rejects a certificate that differs between that preflight and its immediately following source connection.

## Codec, resource, and capacity acceptance

Use dedicated read-only test cameras and retain sanitized evidence under `work/capacity/<UTC-run-id>/`. Do not capture RTSP URLs, credentials, environment dumps, command arguments, SDP, bearer tokens, or private keys.

### 1. Isolated direct path

Run one browser reader against a browser-compatible H.264 source for ten minutes. Confirm the reported mode is Direct and the controller container has zero FFmpeg workers for the whole interval. Video must remain playable and output labels must describe only paths that exist.

### 2. Isolated transcode path

Run one browser reader against an H.265, MJPEG, H.264-with-B-frames/high-profile, or AAC-audio source for ten minutes. Confirm exactly one FFmpeg worker and output H.264 baseline, `yuv420p`, no B-frames, at most 30 FPS, zero-latency tuning, and Opus when camera audio is enabled. The baseline transcode bitrate shown by the relay is 5.4 Mbps.

Count workers by executable name only; never collect process arguments:

```bash
NOVER_CONTROLLER_ID=$(docker compose --env-file relay/.env -f relay/docker-compose.yml ps -q controller)
docker top "$NOVER_CONTROLLER_ID" -eo comm | awk '$1 == "ffmpeg" { count++ } END { print count + 0 }'
```

### 3. Two cameras and 12 viewers for 30 minutes

Keep one Direct and one Transcoded camera warm. Connect 12 authenticated Member/Moderator viewers, split six per camera, from at least two independent external network paths. Use distinct viewer IDs, or never exceed three active readers for any one ID. Exercise camera switching throughout the run.

Capture a resource sample every minute. This example stores container state and worker names without command arguments:

```bash
set -euo pipefail
NOVER_RUN_ID=$(date -u +%Y%m%dT%H%M%SZ)
NOVER_CAPACITY_DIR="work/capacity/$NOVER_RUN_ID"
install -d -m 700 "$NOVER_CAPACITY_DIR"
NOVER_COMPOSE=(docker compose --env-file relay/.env -f relay/docker-compose.yml)
NOVER_CONTAINER_IDS=("$("${NOVER_COMPOSE[@]}" ps -q controller)" "$("${NOVER_COMPOSE[@]}" ps -q mediamtx)" "$("${NOVER_COMPOSE[@]}" ps -q caddy)")

for NOVER_SAMPLE in $(seq 0 30); do
  date -u +%Y-%m-%dT%H:%M:%SZ >> "$NOVER_CAPACITY_DIR/timeline.txt"
  docker stats --no-stream --format '{{json .}}' "${NOVER_CONTAINER_IDS[@]}" >> "$NOVER_CAPACITY_DIR/docker-stats.jsonl"
  for NOVER_CONTAINER_ID in "${NOVER_CONTAINER_IDS[@]}"; do
    docker inspect --format '{{json .State}}' "$NOVER_CONTAINER_ID" >> "$NOVER_CAPACITY_DIR/container-state.jsonl"
  done
  docker top "${NOVER_CONTAINER_IDS[0]}" -eo comm >> "$NOVER_CAPACITY_DIR/controller-process-names.txt"
  if [ "$NOVER_SAMPLE" -lt 30 ]; then sleep 60; fi
done
```

Record WHEP `POST` start and the first rendered-frame event in a test harness or browser trace, then calculate p95 first-frame time. Do not treat the signaling HTTP 201 as a rendered frame.

Default acceptance budget:

- All 12 readers remain playable; there are no simulated frames, blank switches, unintended audio starts, session-cap bypasses, container restarts, health/readiness failures, or OOM events.
- p95 first rendered frame is at most 3 seconds from WHEP create start on each tested external path.
- Controller cgroup CPU p95 is below 320% in Docker's convention (3.2 cores) and MediaMTX cgroup CPU p95 is below 160% (1.6 cores); each container remains below 80% of its configured memory limit.
- Sustained relay egress remains below 70% of the measured host uplink. ICE uses only approved public candidates and TCP fallback is tested separately from UDP.
- The mixed Direct/Transcoded run shows exactly one FFmpeg worker. Reader counts return to baseline after all 12 browsers close and leases/ICE cleanup complete.

These are default release thresholds for the supplied 4-CPU controller and 2-CPU MediaMTX limits. Tighten them for the selected host or SLO; do not loosen them without a recorded operator decision and a repeated test.

### 4. Hard capacity boundaries

- Keep two incompatible cameras active so both FFmpeg slots are occupied, then enable a third incompatible source. It must report `TRANSCODER_CAPACITY`; it must not start a third worker or silently lower quality.
- Register eight cameras and confirm a ninth is rejected with `CAMERA_LIMIT`.
- Keep four sources warm and confirm a fifth reports `WARM_CAMERA_CAPACITY` instead of starting another pull.
- Restart the controller and MediaMTX. Encrypted records rehydrate, DNS and RTSPS validation repeat, valid paths recover, stale WHEP sessions clean up, and a stopped transcoder does not enter an unbounded restart loop.

## Quiesced backup, rollback, and restore

Coordinate one rollback unit: repository revision, controller image, custom MediaMTX image ID/digest, Compose config, Sites saved version/environment, `relay_data` snapshot, and the matching `db_master_key`. Never roll back only the database schema and never restore an encrypted database with a different master key.

Freeze Host camera management before a snapshot. Resolve the exact Compose-managed volume, stop the sole database writer, copy it, then resume:

```bash
set -euo pipefail
NOVER_COMPOSE=(docker compose --env-file relay/.env -f relay/docker-compose.yml)
mapfile -t NOVER_RELAY_VOLUMES < <(docker volume ls -q \
  --filter label=com.docker.compose.project=18nover-relay \
  --filter label=com.docker.compose.volume=relay_data)
[ "${#NOVER_RELAY_VOLUMES[@]}" -eq 1 ]
NOVER_RELAY_VOLUME=${NOVER_RELAY_VOLUMES[0]}
install -d -m 700 backups
NOVER_BACKUP_DIR=$(realpath backups)
NOVER_BACKUP_FILE="relay-data-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"

"${NOVER_COMPOSE[@]}" stop controller
docker run --rm \
  --mount "type=volume,src=$NOVER_RELAY_VOLUME,dst=/source,readonly" \
  --mount "type=bind,src=$NOVER_BACKUP_DIR,dst=/backup" \
  --env NOVER_BACKUP_FILE \
  alpine:3.23.3 sh -ec 'cd /source && tar -czf "/backup/$NOVER_BACKUP_FILE" .'
(cd "$NOVER_BACKUP_DIR" && sha256sum "$NOVER_BACKUP_FILE" > "$NOVER_BACKUP_FILE.sha256")
"${NOVER_COMPOSE[@]}" up -d controller
curl --fail --silent --show-error https://stream.example.com/readyz
```

Back up `db_master_key` through the operator's separate encrypted secret-backup process; do not put it in the database archive. Verify the archive and a restore rehearsal before approving it.

To restore, first deploy the matching code/images and Sites version, stop camera management, make a new pre-restore snapshot, and stop the controller. Validate the intended archive checksum. Then clear only the previously resolved `relay_data` volume and extract the archive:

```bash
set -euo pipefail
NOVER_COMPOSE=(docker compose --env-file relay/.env -f relay/docker-compose.yml)
mapfile -t NOVER_RELAY_VOLUMES < <(docker volume ls -q \
  --filter label=com.docker.compose.project=18nover-relay \
  --filter label=com.docker.compose.volume=relay_data)
[ "${#NOVER_RELAY_VOLUMES[@]}" -eq 1 ]
NOVER_RELAY_VOLUME=${NOVER_RELAY_VOLUMES[0]}
NOVER_BACKUP_DIR=$(realpath backups)
NOVER_RESTORE_FILE=relay-data-YYYYMMDDTHHMMSSZ.tar.gz
cd "$NOVER_BACKUP_DIR"
sha256sum --check "$NOVER_RESTORE_FILE.sha256"
cd - >/dev/null
"${NOVER_COMPOSE[@]}" stop controller
docker run --rm \
  --mount "type=volume,src=$NOVER_RELAY_VOLUME,dst=/restore" \
  --mount "type=bind,src=$NOVER_BACKUP_DIR,dst=/backup,readonly" \
  --env NOVER_RESTORE_FILE \
  alpine:3.23.3 sh -ec 'find /restore -mindepth 1 -depth -delete; tar -xzf "/backup/$NOVER_RESTORE_FILE" -C /restore; chown -R 10001:10001 /restore'
"${NOVER_COMPOSE[@]}" up -d controller
curl --fail --silent --show-error https://stream.example.com/readyz
```

Reprobe each enabled camera, verify path/output summaries, test playback and WHEP cleanup, and rerun the credential audit before unfreezing Host controls. Keep the failed version and pre-restore snapshot available until acceptance completes.

To rotate the Sites-to-relay HMAC key, add a second key ID to `relay_hmac_keys.json`, restart the controller, deploy a Sites environment revision using the new key ID, then remove the old key after the maximum replay and deployment overlap window. Rotate ES256 by replacing the PKCS8 secret, restarting the controller so JWKS changes, and then restarting MediaMTX against the reachable new JWKS. Camera encryption-key rotation requires an explicit decrypt/re-encrypt migration; never replace `db_master_key` in place.

## Production audience gate

Do not widen the candidate's Sites access policy or membership allowlists until all evidence is recorded as passing:

- Local Sites production build and relay unit/type checks.
- Custom MediaMTX patch build, exact image ID/digest, redirect/dial-target negative tests, Compose config, container health, and controller readiness.
- DNS, ACME/TLS, TCP 443, UDP/TCP 8189, WebRTC ICE, and TCP fallback from external networks.
- At least one real RTSP and, when available, one RTSPS source; Direct and Transcoded paths; correct output labels.
- WHEP single-use/path/cap/lease/cleanup behavior, 12-viewer workload, first-frame budget, crossfade, failed-switch retention, reconnect, audio, and local snapshot.
- Transcoder, warm-source, registration, restart, backup, restore, rollback, and key-rotation rehearsals.
- Every item and the fail-closed credential-leak audit in [security-acceptance.md](security-acceptance.md).

After the gate, widen access only to the intended private audience whose stable IDs are present in the correct Host/Moderator/Member list. Re-run a viewer session, camera switch, voice action, and WHEP cleanup under the production access policy. Until that passes, treat the candidate as integration infrastructure, not the production release.
