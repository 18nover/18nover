export type ViewerRole = "member" | "moderator" | "host";

export type CameraState =
  | "online"
  | "connecting"
  | "reconnecting"
  | "offline"
  | "error"
  | "capacity";

export type RelayMode = "direct" | "transcoded" | "unavailable";

export type CameraProfile = {
  id: string;
  label: "Source" | "1080p" | "720p" | "480p";
  width: number | null;
  height: number | null;
  bitrateKbps: number | null;
};

export type CameraSummary = {
  id: string;
  name: string;
  state: CameraState;
  inputCodec: string | null;
  profiles: CameraProfile[];
  width: number | null;
  height: number | null;
  fps: number | null;
  bitrateKbps: number | null;
  audio: boolean;
  relayMode: RelayMode;
  lastFrameAt: string | null;
  errorCode?: string | null;
};

export type ViewerIdentity = {
  id: string;
  displayName: string;
  role: ViewerRole;
};

export type PlaybackGrant = {
  cameraId: string;
  profileId: string;
  state: "online" | "degraded";
  whepUrl: string;
  accessToken: string;
  tokenType: "Bearer";
  expiresAt: string;
};

export type RelayTelemetry = {
  viewers: number;
  voiceMembers: number;
  bitrateMbps: number | null;
  latencySeconds: number | null;
  fps: number | null;
  cpuPercent: number | null;
  network: "healthy" | "degraded" | "offline";
  uptimeSeconds: number;
};

export type RealtimeCredentials = {
  url: string;
  token: string;
  expiresAt: string;
} | null;

export type VoiceCredentials = {
  url: string;
  token: string;
  expiresAt: string;
} | null;

export type SessionResponse = {
  viewer: ViewerIdentity;
  cameras: CameraSummary[];
  playback: PlaybackGrant | null;
  telemetry: RelayTelemetry;
  realtime: RealtimeCredentials;
  voice: VoiceCredentials;
  generatedAt: string;
};

export type ProbeResult = {
  inputCodec: string;
  profile: string | null;
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

export type CameraInput = {
  name: string;
  url: string;
  username: string;
  password: string;
  substreamUrl?: string;
  transport: "tcp" | "udp";
  audio: boolean;
};
