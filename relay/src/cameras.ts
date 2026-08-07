import type { Authenticator } from "./auth.js";
import type { RelayConfig } from "./config.js";
import { decryptCameraSecret, encryptCameraSecret, endpointFingerprint } from "./crypto.js";
import { RelayDatabase, toSummary } from "./db.js";
import type { MediaMtxClient } from "./mediamtx.js";
import { validateAndPinRtsp, type ValidatedSource } from "./network.js";
import { CameraProber, cameraError } from "./probe.js";
import type { TranscoderSupervisor } from "./supervisor.js";
import type { CameraProfile, CameraRecord, CameraSecret, CameraSummary, ProbeResult } from "./types.js";

export type CameraInput = CameraSecret & { name: string };

export class CameraService {
  private readonly pathSamples = new Map<string, { bytes: number; changedAt: number }>();
  private readonly onlineSince = new Map<string, number>();
  private readonly healing = new Set<string>();
  private readonly activationGeneration = new Map<string, number>();
  private readonly availableProfiles = new Map<string, Set<string>>();
  private refreshPromise: Promise<void> | null = null;

  constructor(
    private readonly config: RelayConfig,
    private readonly db: RelayDatabase,
    private readonly media: MediaMtxClient,
    private readonly prober: CameraProber,
    private readonly supervisor: TranscoderSupervisor,
    private readonly auth: Authenticator,
  ) {}

  list(): CameraSummary[] {
    return this.db.list().map((record) => {
      const summary = toSummary(record);
      const available = this.availableProfiles.get(record.id);
      return available ? { ...summary, profiles: summary.profiles.filter((profile) => available.has(profile.id)) } : summary;
    });
  }

  audit(actorId: string, cameraId: string | null, operation: "create" | "patch" | "retest" | "delete", result: "success" | "failure", errorCode: string | null = null) {
    const safeActor = actorId.length <= 256 && !/[\r\n\0]/.test(actorId) ? actorId : "invalid-actor";
    const safeCamera = cameraId && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(cameraId) ? cameraId : null;
    const safeCode = errorCode && /^[A-Z0-9_]{1,64}$/.test(errorCode) ? errorCode : errorCode ? "INTERNAL_ERROR" : null;
    this.db.recordAudit(safeActor, safeCamera, operation, result, safeCode);
  }

  uptime(id: string) {
    const since = this.onlineSince.get(id);
    return since ? Math.max(0, Math.floor((Date.now() - since) / 1000)) : 0;
  }

  refreshStatuses() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.runStatusRefresh().finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  private async runStatusRefresh() {
    await Promise.all(this.db.list().map(async (listed) => {
      if (!listed.enabled) return;
      const record = this.db.get(listed.id);
      if (!record) return;
      try {
        const stats = await Promise.all(record.profiles.map((profile) => this.media.pathStats(profile.path)));
        const now = Date.now();
        const stalledProfiles = new Set<string>();
        const freshProfiles = new Set<string>();
        stats.forEach((stat, index) => {
          const profile = record.profiles[index]!;
          const path = profile.path;
          const previous = this.pathSamples.get(path);
          if (!previous || stat.inboundBytes !== previous.bytes) {
            this.pathSamples.set(path, { bytes: stat.inboundBytes, changedAt: now });
            if (stat.inboundBytes > 0) freshProfiles.add(profile.id);
          } else {
            if (stat.online && now - previous.changedAt > 20_000) stalledProfiles.add(profile.id);
          }
        });
        const available = new Set(record.profiles.filter((profile, index) => stats[index]?.online && !stalledProfiles.has(profile.id)).map((profile) => profile.id));
        this.availableProfiles.set(record.id, available);
        const mainIndex = Math.max(0, record.profiles.findIndex((profile) => profile.id === "main"));
        const mainProfile = record.profiles[mainIndex];
        const mainOnline = Boolean(mainProfile && stats[mainIndex]?.online && !stalledProfiles.has(mainProfile.id));
        const onlineTime = stats.map((stat) => stat.onlineTime ? Date.parse(stat.onlineTime) : NaN).filter(Number.isFinite).sort((a, b) => a - b)[0];
        if (mainOnline) {
          record.state = "online";
          record.errorCode = available.size === record.profiles.length ? null : "SUBSTREAM_UNAVAILABLE";
          if (mainProfile && freshProfiles.has(mainProfile.id)) record.lastFrameAt = new Date(now).toISOString();
          if (onlineTime) this.onlineSince.set(record.id, onlineTime);
          else if (!this.onlineSince.has(record.id)) this.onlineSince.set(record.id, now);
          record.updatedAt = new Date(now).toISOString();
          this.db.update(record);
        } else {
          record.state = "reconnecting";
          record.errorCode = mainProfile && stalledProfiles.has(mainProfile.id) ? "STALLED_FRAMES" : "SOURCE_DISCONNECTED";
          record.updatedAt = new Date(now).toISOString();
          this.db.update(record);
          this.onlineSince.delete(record.id);
          this.scheduleHeal(record.id);
        }
      } catch {
        this.updateState(record.id, "error", "STATUS_CHECK_FAILED");
        this.scheduleHeal(record.id);
      }
    }));
  }

  async probeUnsaved(input: CameraInput) {
    const prepared = await this.prepare(input);
    return combinedProbe(prepared.mainProbe, prepared.subProbe);
  }

  async create(input: CameraInput) {
    if (this.db.count() >= this.config.maxCameras) throw cameraError("CAMERA_LIMIT");
    const secret: CameraSecret = { url: input.url, username: input.username, password: input.password, ...(input.substreamUrl ? { substreamUrl: input.substreamUrl } : {}), transport: input.transport, audio: input.audio };
    const prepared = await this.prepare(secret);
    const fingerprint = endpointFingerprint(this.config.masterKey, `${prepared.main.normalized}\0${prepared.sub?.normalized ?? ""}`);
    if (this.db.getByFingerprint(fingerprint)) throw cameraError("CAMERA_DUPLICATE");
    const id = createCameraId(input.name);
    const now = new Date().toISOString();
    const profiles = profilesFor(id, prepared.mainProbe, prepared.subProbe);
    const canWarm = this.db.countEnabled() < this.config.maxWarmCameras;
    const transcodersNeeded = profiles.filter((profile) => profile.relayMode === "transcoded").length;
    const canTranscode = this.supervisor.activeCount + transcodersNeeded <= this.config.maxTranscoders;
    const enabled = canWarm && canTranscode;
    const record: CameraRecord = {
      id,
      name: input.name,
      encryptedSecret: encryptCameraSecret(this.config.masterKey, id, secret),
      sourceFingerprint: fingerprint,
      state: enabled ? "connecting" : "capacity",
      relayMode: prepared.mainProbe.relayMode,
      inputCodec: prepared.mainProbe.inputCodec,
      profiles,
      width: prepared.mainProbe.width,
      height: prepared.mainProbe.height,
      fps: prepared.mainProbe.relayMode === "transcoded" ? Math.min(30, prepared.mainProbe.fps) : prepared.mainProbe.fps,
      bitrateKbps: prepared.mainProbe.relayMode === "transcoded" ? 5_400 : prepared.mainProbe.bitrateKbps,
      audio: Boolean(prepared.mainProbe.audioCodec),
      lastFrameAt: prepared.mainProbe.latestFrameAt,
      errorCode: enabled ? null : canWarm ? "TRANSCODER_CAPACITY" : "WARM_CAMERA_CAPACITY",
      enabled,
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(record);
    if (enabled) {
      try {
        await this.activate(record, prepared.main, prepared.sub, secret.transport);
      } catch {
        await this.deactivate(record);
        this.updateState(id, "error", "ACTIVATION_FAILED");
      }
    }
    return toSummary(this.db.get(id) ?? record);
  }

  async patch(id: string, input: Record<string, unknown>) {
    const current = this.requireRecord(id);
    let record = { ...current, updatedAt: new Date().toISOString() };
    if (typeof input.name === "string") record.name = validateName(input.name);
    const replacingSecret = ["url", "username", "password", "substreamUrl", "transport", "audio"].some((key) => key in input);
    if (replacingSecret) {
      if (typeof input.url !== "string" || typeof input.username !== "string" || typeof input.password !== "string") throw cameraError("COMPLETE_CREDENTIALS_REQUIRED");
      const secret: CameraSecret = {
        url: input.url,
        username: input.username,
        password: input.password,
        ...(typeof input.substreamUrl === "string" && input.substreamUrl ? { substreamUrl: input.substreamUrl } : {}),
        transport: input.transport === "udp" ? "udp" : "tcp",
        audio: typeof input.audio === "boolean" ? input.audio : true,
      };
      const prepared = await this.prepare(secret);
      const fingerprint = endpointFingerprint(this.config.masterKey, `${prepared.main.normalized}\0${prepared.sub?.normalized ?? ""}`);
      const duplicate = this.db.getByFingerprint(fingerprint);
      if (duplicate && duplicate.id !== id) throw cameraError("CAMERA_DUPLICATE");
      const nextProfiles = profilesFor(id, prepared.mainProbe, prepared.subProbe);
      const nextEnabled = typeof input.enabled === "boolean" ? input.enabled : current.enabled;
      const otherEnabled = this.db.countEnabled() - (current.enabled ? 1 : 0);
      if (nextEnabled && otherEnabled >= this.config.maxWarmCameras) throw cameraError("WARM_CAMERA_CAPACITY");
      const currentWorkers = current.enabled ? transcoderCount(current.profiles) : 0;
      const nextWorkers = nextEnabled ? transcoderCount(nextProfiles) : 0;
      if (this.supervisor.activeCount - currentWorkers + nextWorkers > this.config.maxTranscoders) throw cameraError("TRANSCODER_CAPACITY");
      record = {
        ...record,
        encryptedSecret: encryptCameraSecret(this.config.masterKey, id, secret),
        sourceFingerprint: fingerprint,
        relayMode: prepared.mainProbe.relayMode,
        inputCodec: prepared.mainProbe.inputCodec,
        profiles: nextProfiles,
        width: prepared.mainProbe.width,
        height: prepared.mainProbe.height,
        fps: prepared.mainProbe.relayMode === "transcoded" ? Math.min(30, prepared.mainProbe.fps) : prepared.mainProbe.fps,
        bitrateKbps: prepared.mainProbe.relayMode === "transcoded" ? 5_400 : prepared.mainProbe.bitrateKbps,
        audio: Boolean(prepared.mainProbe.audioCodec),
        lastFrameAt: prepared.mainProbe.latestFrameAt,
        errorCode: null,
        enabled: nextEnabled,
        state: nextEnabled ? "connecting" : "offline",
      };
      await this.deactivate(current);
      this.db.update(record);
      try {
        record.profiles.forEach((profile) => this.supervisor.resetCircuit(`${record.id}:${profile.id}`));
        if (record.enabled) await this.activate(record, prepared.main, prepared.sub, secret.transport);
      } catch (error) {
        await this.deactivate(record);
        this.db.update(current);
        if (current.enabled) {
          try {
            const previousSecret = decryptCameraSecret(this.config.masterKey, id, current.encryptedSecret);
            const previous = await this.prepare(previousSecret, false);
            await this.activate(current, previous.main, previous.sub, previousSecret.transport);
          } catch {
            this.updateState(id, "error", "ROLLBACK_FAILED");
          }
        }
        throw error;
      }
    }
    if (!replacingSecret && typeof input.enabled === "boolean" && input.enabled !== record.enabled) {
      if (input.enabled && this.db.countEnabled() >= this.config.maxWarmCameras) throw cameraError("WARM_CAMERA_CAPACITY");
      if (input.enabled && this.supervisor.activeCount + transcoderCount(record.profiles) > this.config.maxTranscoders) throw cameraError("TRANSCODER_CAPACITY");
      record.enabled = input.enabled;
      record.state = input.enabled ? "connecting" : "offline";
      record.errorCode = null;
      this.db.update(record);
      if (input.enabled) {
        const secret = decryptCameraSecret(this.config.masterKey, id, record.encryptedSecret);
        const prepared = await this.prepare(secret, false);
        await this.activate(record, prepared.main, prepared.sub, secret.transport);
      } else await this.deactivate(record);
    } else if (!replacingSecret) {
      this.db.update(record);
    }
    return toSummary(this.requireRecord(id));
  }

  async retest(id: string) {
    const record = this.requireRecord(id);
    const secret = decryptCameraSecret(this.config.masterKey, id, record.encryptedSecret);
    const prepared = await this.prepare(secret);
    const result = combinedProbe(prepared.mainProbe, prepared.subProbe);
    const nextProfiles = profilesFor(id, prepared.mainProbe, prepared.subProbe);
    const currentWorkers = record.enabled ? transcoderCount(record.profiles) : 0;
    const nextWorkers = record.enabled ? transcoderCount(nextProfiles) : 0;
    if (this.supervisor.activeCount - currentWorkers + nextWorkers > this.config.maxTranscoders) throw cameraError("TRANSCODER_CAPACITY");
    record.relayMode = prepared.mainProbe.relayMode;
    record.inputCodec = prepared.mainProbe.inputCodec;
    record.profiles = nextProfiles;
    record.width = prepared.mainProbe.width;
    record.height = prepared.mainProbe.height;
    record.fps = prepared.mainProbe.relayMode === "transcoded" ? Math.min(30, prepared.mainProbe.fps) : prepared.mainProbe.fps;
    record.bitrateKbps = prepared.mainProbe.relayMode === "transcoded" ? 5_400 : prepared.mainProbe.bitrateKbps;
    record.audio = Boolean(prepared.mainProbe.audioCodec);
    record.lastFrameAt = prepared.mainProbe.latestFrameAt;
    record.errorCode = null;
    record.state = record.enabled ? "connecting" : "offline";
    record.updatedAt = new Date().toISOString();
    this.db.update(record);
    await this.deactivate(record);
    record.profiles.forEach((profile) => this.supervisor.resetCircuit(`${record.id}:${profile.id}`));
    if (record.enabled) await this.activate(record, prepared.main, prepared.sub, secret.transport);
    return { camera: toSummary(this.requireRecord(id)), result: publicProbe(result) };
  }

  async remove(id: string) {
    const record = this.requireRecord(id);
    await this.deactivate(record);
    if (!this.db.remove(id)) throw cameraError("CAMERA_NOT_FOUND");
    this.onlineSince.delete(id);
  }

  async reconcile() {
    for (const record of this.db.list()) {
      if (!record.enabled) continue;
      try {
        const secret = decryptCameraSecret(this.config.masterKey, record.id, record.encryptedSecret);
        const prepared = await this.prepare(secret, false);
        await this.activate(record, prepared.main, prepared.sub, secret.transport);
      } catch {
        this.updateState(record.id, "error", "REHYDRATION_FAILED");
      }
    }
  }

  async playback(id: string, profileId: string, viewerId: string) {
    const record = this.requireRecord(id);
    if (record.state !== "online") throw cameraError("CAMERA_UNAVAILABLE");
    const profile = profileId === "auto" ? record.profiles[0] : record.profiles.find((entry) => entry.id === profileId);
    if (!profile) throw cameraError("PROFILE_NOT_FOUND");
    const available = this.availableProfiles.get(id);
    if (available && !available.has(profile.id)) throw cameraError("PROFILE_UNAVAILABLE");
    const token = await this.auth.issueViewerToken(viewerId, profile.path, 300);
    return {
      cameraId: id,
      profileId: profile.id,
      state: "online" as const,
      whepUrl: `${this.config.publicOrigin}/whep/${encodeURIComponent(profile.path)}/whep`,
      accessToken: token,
      tokenType: "Bearer" as const,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
  }

  updateState(id: string, state: "starting" | "online" | "error", errorCode?: string) {
    const record = this.db.get(id);
    if (!record) return;
    record.state = state === "starting" ? "connecting" : state;
    record.errorCode = errorCode ?? (state === "error" ? "TRANSCODER_FAILED" : null);
    if (state === "online") {
      if (!this.onlineSince.has(id)) this.onlineSince.set(id, Date.now());
      record.lastFrameAt = new Date().toISOString();
    } else if (state === "error") this.onlineSince.delete(id);
    record.updatedAt = new Date().toISOString();
    this.db.update(record);
  }

  private async activate(record: CameraRecord, mainSource: ValidatedSource, substreamSource?: ValidatedSource, transport: "tcp" | "udp" = "tcp") {
    if (!record.profiles.length) throw cameraError("PROFILE_NOT_FOUND");
    const generation = (this.activationGeneration.get(record.id) ?? 0) + 1;
    this.activationGeneration.set(record.id, generation);
    record.state = "connecting";
    record.errorCode = null;
    record.updatedAt = new Date().toISOString();
    this.db.update(record);
    for (const profile of record.profiles) {
      const source = profile.id === "substream" ? substreamSource : mainSource;
      if (!source) throw cameraError("SUBSTREAM_UNAVAILABLE");
      if (profile.relayMode === "direct") {
        await this.media.ensurePullPath(profile.path, source.pinned, transport, source.fingerprint);
      } else {
        const sourcePath = `${profile.path}-source`;
        await this.media.ensurePullPath(sourcePath, source.pinned, transport, source.fingerprint);
        await this.media.ensurePublisherPath(profile.path);
        const started = await this.supervisor.start(
          `${record.id}:${profile.id}`,
          sourcePath,
          profile.path,
          record.audio,
          profile.width ?? Math.min(record.width ?? 1920, 1920),
          profile.height ?? Math.min(record.height ?? 1080, 1080),
        );
        if (!started) throw cameraError("TRANSCODER_UNAVAILABLE");
      }
    }
    void Promise.all(record.profiles.map((profile) => this.media.waitReady(profile.path, 12_000))).then((ready) => {
      const current = this.db.get(record.id);
      if (this.activationGeneration.get(record.id) !== generation || !current?.enabled) return;
      const available = new Set(current.profiles.filter((_profile, index) => ready[index]).map((profile) => profile.id));
      this.availableProfiles.set(record.id, available);
      const mainIndex = Math.max(0, current.profiles.findIndex((profile) => profile.id === "main"));
      const mainReady = Boolean(ready[mainIndex]);
      current.state = mainReady ? "online" : "error";
      current.errorCode = mainReady ? (available.size === current.profiles.length ? null : "SUBSTREAM_UNAVAILABLE") : "NO_FRAMES";
      current.updatedAt = new Date().toISOString();
      if (mainReady) {
        current.lastFrameAt = new Date().toISOString();
        if (!this.onlineSince.has(current.id)) this.onlineSince.set(current.id, Date.now());
      } else this.onlineSince.delete(current.id);
      this.db.update(current);
    });
  }

  private async deactivate(record: CameraRecord) {
    this.activationGeneration.set(record.id, (this.activationGeneration.get(record.id) ?? 0) + 1);
    await Promise.all(record.profiles.map((profile) => this.supervisor.stop(`${record.id}:${profile.id}`)));
    await Promise.allSettled(record.profiles.flatMap((profile) => [this.media.deletePath(profile.path), this.media.deletePath(`${profile.path}-source`)]));
    record.profiles.forEach((profile) => {
      this.pathSamples.delete(profile.path);
      this.pathSamples.delete(`${profile.path}-source`);
    });
    this.onlineSince.delete(record.id);
    this.availableProfiles.delete(record.id);
  }

  private scheduleHeal(id: string) {
    if (this.healing.has(id)) return;
    this.healing.add(id);
    void (async () => {
      try {
        const record = this.requireRecord(id);
        if (!record.enabled) return;
        if (record.profiles.some((profile) => profile.relayMode === "transcoded" && this.supervisor.isCircuitOpen(`${record.id}:${profile.id}`))) {
          this.updateState(id, "error", "TRANSCODER_CIRCUIT_OPEN");
          return;
        }
        const secret = decryptCameraSecret(this.config.masterKey, id, record.encryptedSecret);
        const prepared = await this.prepare(secret, false);
        const current = this.db.get(id);
        if (!current?.enabled || current.encryptedSecret !== record.encryptedSecret) return;
        await this.deactivate(record);
        if (!this.db.get(id)?.enabled) return;
        await this.activate(record, prepared.main, prepared.sub, secret.transport);
      } catch {
        this.updateState(id, "error", "RECONNECT_FAILED");
      } finally {
        this.healing.delete(id);
      }
    })();
  }

  private async prepare(secret: CameraSecret, probe = true) {
    const main = await validateAndPinRtsp(secret.url, secret.username, secret.password, this.config.allowedPorts);
    const sub = secret.substreamUrl ? await validateAndPinRtsp(secret.substreamUrl, secret.username, secret.password, this.config.allowedPorts) : undefined;
    const mainProbe = probe ? await this.prober.probePinnedSource(main.pinned, secret.audio, secret.transport, main.fingerprint) : null;
    const subProbe = probe && sub ? await this.prober.probePinnedSource(sub.pinned, secret.audio, secret.transport, sub.fingerprint) : undefined;
    return { main, sub, mainProbe: mainProbe!, subProbe };
  }

  private requireRecord(id: string) { const record = this.db.get(id); if (!record) throw cameraError("CAMERA_NOT_FOUND"); return record; }
}

function profilesFor(id: string, probe: ProbeResult, subProbe?: ProbeResult): CameraProfile[] {
  const main = { ...probe.profiles[0]!, id: "main", path: `camera-${id}` };
  if (!subProbe?.profiles[0]) return [main];
  const height = subProbe.profiles[0].height ?? subProbe.height;
  const label: CameraProfile["label"] = height >= 1000 ? "1080p" : height >= 700 ? "720p" : "480p";
  return [main, { ...subProbe.profiles[0], id: "substream", label, path: `camera-${id}-sub` }];
}
function combinedProbe(main: ProbeResult, sub?: ProbeResult): ProbeResult {
  if (!sub?.profiles[0]) return { ...main, profiles: profilesFor("probe", main).map((profile) => ({ ...profile, path: "" })) };
  return { ...main, profiles: profilesFor("probe", main, sub).map((profile) => ({ ...profile, path: "" })) };
}
function publicProbe(result: ProbeResult) { return { ...result, profiles: result.profiles.map(({ path: _path, relayMode: _relayMode, ...profile }) => profile) }; }
function transcoderCount(profiles: CameraProfile[]) { return profiles.filter((profile) => profile.relayMode === "transcoded").length; }
function validateName(value: string) { const name = value.trim(); if (name.length < 2 || name.length > 64 || /[\r\n\0]/.test(name)) throw cameraError("INVALID_CAMERA_NAME"); return name; }
function createCameraId(name: string) { const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 38) || "camera"; return `${base}-${crypto.randomUUID().slice(0, 8)}`; }
