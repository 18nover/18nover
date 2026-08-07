import { DatabaseSync } from "node:sqlite";
import type { CameraRecord, CameraSummary } from "./types.js";

type CameraRow = {
  id: string;
  name: string;
  encrypted_secret: string;
  source_fingerprint: string;
  state: CameraRecord["state"];
  relay_mode: CameraRecord["relayMode"];
  input_codec: string | null;
  profiles_json: string;
  width: number | null;
  height: number | null;
  fps: number | null;
  bitrate_kbps: number | null;
  audio: number;
  last_frame_at: string | null;
  error_code: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
};

export class RelayDatabase {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cameras (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        encrypted_secret TEXT NOT NULL,
        source_fingerprint TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL CHECK (state IN ('online','connecting','reconnecting','offline','error','capacity')),
        relay_mode TEXT NOT NULL CHECK (relay_mode IN ('direct','transcoded','unavailable')),
        input_codec TEXT,
        profiles_json TEXT NOT NULL DEFAULT '[]',
        width INTEGER,
        height INTEGER,
        fps REAL,
        bitrate_kbps INTEGER,
        audio INTEGER NOT NULL CHECK (audio IN (0,1)),
        last_frame_at TEXT,
        error_code TEXT,
        enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS hmac_nonces (
        key_id TEXT NOT NULL,
        nonce TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (key_id, nonce)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS hmac_nonces_expiry ON hmac_nonces(expires_at);
      CREATE TABLE IF NOT EXISTS camera_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        camera_id TEXT,
        operation TEXT NOT NULL CHECK (operation IN ('create','patch','retest','delete')),
        result TEXT NOT NULL CHECK (result IN ('success','failure')),
        error_code TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS camera_audit_time ON camera_audit(occurred_at);
    `);
  }

  close() { this.db.close(); }

  reserveNonce(keyId: string, nonce: string, expiresAt: number) {
    try {
      this.db.exec("BEGIN IMMEDIATE");
      this.db.prepare("DELETE FROM hmac_nonces WHERE expires_at < ?").run(Math.floor(Date.now() / 1000));
      this.db.prepare("INSERT INTO hmac_nonces (key_id, nonce, expires_at) VALUES (?, ?, ?)").run(keyId, nonce, expiresAt);
      this.db.exec("COMMIT");
      return true;
    } catch {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      return false;
    }
  }

  count() { return Number((this.db.prepare("SELECT COUNT(*) AS count FROM cameras").get() as { count: number }).count); }
  countEnabled() { return Number((this.db.prepare("SELECT COUNT(*) AS count FROM cameras WHERE enabled = 1").get() as { count: number }).count); }
  countTranscoded() { return Number((this.db.prepare("SELECT COUNT(*) AS count FROM cameras WHERE enabled = 1 AND relay_mode = 'transcoded'").get() as { count: number }).count); }

  list(): CameraRecord[] {
    return (this.db.prepare("SELECT * FROM cameras ORDER BY created_at ASC").all() as unknown as CameraRow[]).map(fromRow);
  }

  get(id: string): CameraRecord | null {
    const row = this.db.prepare("SELECT * FROM cameras WHERE id = ?").get(id) as CameraRow | undefined;
    return row ? fromRow(row) : null;
  }

  getByFingerprint(fingerprint: string): CameraRecord | null {
    const row = this.db.prepare("SELECT * FROM cameras WHERE source_fingerprint = ?").get(fingerprint) as CameraRow | undefined;
    return row ? fromRow(row) : null;
  }

  insert(record: CameraRecord) {
    this.db.prepare(`INSERT INTO cameras (
      id,name,encrypted_secret,source_fingerprint,state,relay_mode,input_codec,profiles_json,width,height,fps,bitrate_kbps,audio,last_frame_at,error_code,enabled,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      record.id, record.name, record.encryptedSecret, record.sourceFingerprint, record.state, record.relayMode, record.inputCodec,
      JSON.stringify(record.profiles), record.width, record.height, record.fps, record.bitrateKbps, record.audio ? 1 : 0,
      record.lastFrameAt, record.errorCode, record.enabled ? 1 : 0, record.createdAt, record.updatedAt,
    );
  }

  update(record: CameraRecord) {
    this.db.prepare(`UPDATE cameras SET
      name=?, encrypted_secret=?, source_fingerprint=?, state=?, relay_mode=?, input_codec=?, profiles_json=?, width=?, height=?, fps=?, bitrate_kbps=?, audio=?, last_frame_at=?, error_code=?, enabled=?, updated_at=?
      WHERE id=?`).run(
      record.name, record.encryptedSecret, record.sourceFingerprint, record.state, record.relayMode, record.inputCodec,
      JSON.stringify(record.profiles), record.width, record.height, record.fps, record.bitrateKbps, record.audio ? 1 : 0,
      record.lastFrameAt, record.errorCode, record.enabled ? 1 : 0, record.updatedAt, record.id,
    );
  }

  remove(id: string) { return this.db.prepare("DELETE FROM cameras WHERE id = ?").run(id).changes > 0; }

  recordAudit(actorId: string, cameraId: string | null, operation: "create" | "patch" | "retest" | "delete", result: "success" | "failure", errorCode: string | null) {
    this.db.prepare("INSERT INTO camera_audit (occurred_at,actor_id,camera_id,operation,result,error_code) VALUES (?,?,?,?,?,?)")
      .run(new Date().toISOString(), actorId, cameraId, operation, result, errorCode);
  }
}

export function toSummary(record: CameraRecord): CameraSummary {
  return {
    id: record.id,
    name: record.name,
    state: record.state,
    relayMode: record.relayMode,
    inputCodec: record.inputCodec,
    profiles: record.profiles.map(({ path: _path, relayMode: _relayMode, ...profile }) => profile),
    width: record.width,
    height: record.height,
    fps: record.fps,
    bitrateKbps: record.bitrateKbps,
    audio: record.audio,
    lastFrameAt: record.lastFrameAt,
    errorCode: record.errorCode,
  };
}

function fromRow(row: CameraRow): CameraRecord {
  return {
    id: row.id,
    name: row.name,
    encryptedSecret: row.encrypted_secret,
    sourceFingerprint: row.source_fingerprint,
    state: row.state,
    relayMode: row.relay_mode,
    inputCodec: row.input_codec,
    profiles: JSON.parse(row.profiles_json) as CameraRecord["profiles"],
    width: row.width,
    height: row.height,
    fps: row.fps,
    bitrateKbps: row.bitrate_kbps,
    audio: Boolean(row.audio),
    lastFrameAt: row.last_frame_at,
    errorCode: row.error_code,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
