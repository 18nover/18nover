export type CameraState = "online" | "connecting" | "reconnecting" | "offline" | "error" | "capacity";
export type RelayMode = "direct" | "transcoded" | "unavailable";

export type CameraSecret = {
  url: string;
  username: string;
  password: string;
  substreamUrl?: string;
  transport: "tcp" | "udp";
  audio: boolean;
};

export type CameraProfile = {
  id: string;
  label: "Source" | "1080p" | "720p" | "480p";
  width: number | null;
  height: number | null;
  bitrateKbps: number | null;
  path: string;
  relayMode: "direct" | "transcoded";
};

export type ProbeResult = {
  inputCodec: string;
  profile: string | null;
  pixelFormat: string | null;
  hasBFrames: boolean;
  width: number;
  height: number;
  fps: number;
  bitrateKbps: number | null;
  audioCodec: string | null;
  latestFrameAt: string;
  relayMode: "direct" | "transcoded";
  profiles: CameraProfile[];
};

export type CameraRecord = {
  id: string;
  name: string;
  encryptedSecret: string;
  sourceFingerprint: string;
  state: CameraState;
  relayMode: RelayMode;
  inputCodec: string | null;
  profiles: CameraProfile[];
  width: number | null;
  height: number | null;
  fps: number | null;
  bitrateKbps: number | null;
  audio: boolean;
  lastFrameAt: string | null;
  errorCode: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CameraSummary = Omit<CameraRecord, "encryptedSecret" | "sourceFingerprint" | "enabled" | "createdAt" | "updatedAt" | "profiles"> & {
  profiles: Array<Omit<CameraProfile, "path" | "relayMode">>;
};
