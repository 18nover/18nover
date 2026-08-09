"use client";

import {
  FormEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Room } from "livekit-client";
import type {
  CameraInput,
  CameraSummary,
  PlaybackGrant,
  ProbeResult,
  SessionResponse,
  ViewerIdentity,
} from "../lib/contracts";
import { WhepReader } from "../lib/client/whep";

type SideTab = "chat" | "guide" | "members";
type Toast = { id: number; title: string; detail?: string; tone?: "danger" | "success" };
type VoiceState = "idle" | "connecting" | "listening" | "muted" | "speaking";
type ReconnectRequest = { cameraId: string; profileId: string; attempt: number };
type ColorTheme = "light" | "dark";

const DEV_PREVIEW = process.env.NODE_ENV !== "production";
const THEME_STORAGE_KEY = "18nover-theme";

const PREVIEW_CAMERAS: CameraSummary[] = [
  {
    id: "orbit",
    name: "Orbit",
    state: "offline",
    inputCodec: null,
    profiles: [],
    width: null,
    height: null,
    fps: null,
    bitrateKbps: null,
    audio: false,
    relayMode: "unavailable",
    lastFrameAt: null,
    errorCode: "AWAITING_RELAY",
  },
  {
    id: "explorer",
    name: "Explorer",
    state: "offline",
    inputCodec: null,
    profiles: [],
    width: null,
    height: null,
    fps: null,
    bitrateKbps: null,
    audio: false,
    relayMode: "unavailable",
    lastFrameAt: null,
    errorCode: "AWAITING_RELAY",
  },
];

const PREVIEW_VIEWER: ViewerIdentity = {
  id: "local-preview",
  displayName: DEV_PREVIEW ? "Local host preview" : "Signed-out viewer",
  role: DEV_PREVIEW ? "host" : "member",
};

const CHAT_MESSAGES = [
  { id: 1, kind: "system", text: "Jay started streaming", time: "18:40" },
  { id: 2, kind: "message", name: "Sarah", initials: "SH", text: "Orbit is looking clear tonight.", time: "18:41", badge: "Member", reaction: "♥ 3" },
  { id: 3, kind: "system", text: "Sarah joined", time: "18:42" },
  { id: 4, kind: "message", name: "Miles", initials: "MI", text: "I can hear the rain on Explorer.", time: "18:43", badge: "Moderator", reaction: "+ 2" },
  { id: 5, kind: "system", text: "Explorer camera connected", time: "18:44" },
] as const;

const GUIDE_EVENTS = [
  { time: "18:42:07", source: "Orbit", text: "Delivery van detected.", kind: "camera" },
  { time: "18:43:15", source: "Explorer", text: "Front door opened.", kind: "camera" },
  { time: "18:44:02", source: "User", text: "What’s outside?", kind: "user" },
  { time: "18:44:03", source: "Guide", text: "Only the driveway is currently visible.", kind: "guide" },
] as const;

const MEMBERS = [
  { name: "Jay Ellison", initials: "JE", role: "Host", status: "In voice", color: "violet", speaking: true },
  { name: "Mara Chen", initials: "MC", role: "Moderator", status: "Listening", color: "cyan", speaking: false },
  { name: "Sarah Hale", initials: "SH", role: "Member", status: "In voice", color: "rose", speaking: true },
  { name: "Miles Park", initials: "MP", role: "Member", status: "Online", color: "amber", speaking: false },
] as const;

const EMPTY_TELEMETRY = {
  viewers: 0,
  voiceMembers: 0,
  bitrateMbps: null,
  latencySeconds: null,
  fps: null,
  cpuPercent: null,
  network: "offline" as const,
  uptimeSeconds: 0,
};

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, "0")).join(":");
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "LL";
}

function safeNumber(value: number | null, suffix = "") {
  return value === null ? "—" : `${Number.isInteger(value) ? value : value.toFixed(2)}${suffix}`;
}

function cameraStateLabel(camera: CameraSummary) {
  if (camera.errorCode === "AWAITING_RELAY") return "Awaiting relay";
  if (camera.state === "capacity") return "Capacity unavailable";
  return camera.state[0].toUpperCase() + camera.state.slice(1);
}

function clearVoiceAudioElements() {
  document.querySelectorAll<HTMLMediaElement>("[data-nover-voice-audio]").forEach((element) => element.remove());
}

export default function Dashboard() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [sessionState, setSessionState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [cameras, setCameras] = useState<CameraSummary[]>(PREVIEW_CAMERAS);
  const [activeCameraId, setActiveCameraId] = useState("orbit");
  const [activeProfileId, setActiveProfileId] = useState("auto");
  const [activeSlot, setActiveSlot] = useState<0 | 1>(0);
  const [pendingCameraId, setPendingCameraId] = useState<string | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [sideTab, setSideTab] = useState<SideTab>("chat");
  const [sidebarWidth, setSidebarWidth] = useState(384);
  const [companionCollapsed, setCompanionCollapsed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingCamera, setEditingCamera] = useState<CameraSummary | null>(null);
  const [cameraMenuId, setCameraMenuId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CameraSummary | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [composer, setComposer] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [streamClock, setStreamClock] = useState<Date | null>(null);
  const [colorTheme, setColorTheme] = useState<ColorTheme>("light");
  const [liveMetrics, setLiveMetrics] = useState<{ latencySeconds: number | null; bitrateMbps: number | null }>({
    latencySeconds: null,
    bitrateMbps: null,
  });
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [activeSpeakers, setActiveSpeakers] = useState<string[]>([]);
  const [reconnectRequest, setReconnectRequest] = useState<ReconnectRequest | null>(null);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([null, null]);
  const readers = useRef<Array<WhepReader | null>>([null, null]);
  const disconnectTimers = useRef<Array<number | null>>([null, null]);
  const activeSlotRef = useRef<0 | 1>(0);
  const audioEnabledRef = useRef(false);
  const playbackAbort = useRef<AbortController | null>(null);
  const playbackIntent = useRef(0);
  const camerasRef = useRef(cameras);
  const pushToTalkHeld = useRef(false);
  const roomRef = useRef<Room | null>(null);
  const toastId = useRef(0);

  const viewer = session?.viewer ?? PREVIEW_VIEWER;
  const telemetry = session?.telemetry ?? EMPTY_TELEMETRY;
  const activeCamera = cameras.find((camera) => camera.id === activeCameraId) ?? cameras[0];
  const isLive = Boolean(readers.current[activeSlot]);
  const metrics = {
    ...telemetry,
    latencySeconds: liveMetrics.latencySeconds ?? telemetry.latencySeconds,
    bitrateMbps: liveMetrics.bitrateMbps ?? telemetry.bitrateMbps,
  };

  const showToast = useCallback((title: string, detail?: string, tone?: Toast["tone"]) => {
    const id = ++toastId.current;
    setToasts((current) => [...current.slice(-2), { id, title, detail, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4_000);
  }, []);

  const installGrant = useCallback(async (
    grant: PlaybackGrant,
    cameraId: string,
    profileId: string,
    intent: number,
    controller: AbortController,
  ): Promise<boolean> => {
    const currentSlot = activeSlotRef.current;
    const targetSlot = (currentSlot === 0 ? 1 : 0) as 0 | 1;
    const targetVideo = videoRefs.current[targetSlot];
    if (!targetVideo) throw new Error("The video stage is not ready.");

    const displacedReader = readers.current[targetSlot];
    await displacedReader?.close();
    if (readers.current[targetSlot] === displacedReader) readers.current[targetSlot] = null;
    if (intent !== playbackIntent.current || controller.signal.aborted) return false;

    const reader = new WhepReader(targetVideo, grant, {
      onConnectionState: (state) => {
        if (readers.current[targetSlot] !== reader) return;
        if (state === "connected") {
          if (disconnectTimers.current[targetSlot] !== null) window.clearTimeout(disconnectTimers.current[targetSlot]!);
          disconnectTimers.current[targetSlot] = null;
        }
        if (state === "failed" || state === "disconnected") {
          showToast("Camera connection interrupted", "Holding the last rendered frame while the relay reconnects.", "danger");
          if (targetSlot === activeSlotRef.current && disconnectTimers.current[targetSlot] === null) {
            disconnectTimers.current[targetSlot] = window.setTimeout(() => {
              disconnectTimers.current[targetSlot] = null;
              if (readers.current[targetSlot] !== reader) return;
              void reader.close();
              readers.current[targetSlot] = null;
              setCameras((current) => current.map((camera) => camera.id === cameraId ? { ...camera, state: "reconnecting", errorCode: "PLAYBACK_INTERRUPTED" } : camera));
              setLiveMetrics({ latencySeconds: null, bitrateMbps: null });
              setReconnectRequest({ cameraId, profileId, attempt: 1 });
            }, 2_500);
          }
        }
      },
      onMetrics: setLiveMetrics,
    });
    reader.setMuted(!audioEnabledRef.current);
    readers.current[targetSlot] = reader;

    try {
      await reader.connect(controller.signal);
      if (intent !== playbackIntent.current || controller.signal.aborted) {
        await reader.close();
        if (readers.current[targetSlot] === reader) readers.current[targetSlot] = null;
        return false;
      }
      const previousSlot = currentSlot;
      const previousReader = readers.current[previousSlot];
      setActiveCameraId(cameraId);
      const selectedCamera = camerasRef.current.find((camera) => camera.id === cameraId);
      setActiveProfileId(profileId === "auto" && (selectedCamera?.profiles.length ?? 0) > 1 ? "auto" : grant.profileId);
      activeSlotRef.current = targetSlot;
      setActiveSlot(targetSlot);
      setPendingCameraId(null);
      setReconnectRequest(null);
      window.setTimeout(() => {
        if (readers.current[previousSlot] !== previousReader) return;
        if (disconnectTimers.current[previousSlot] !== null) window.clearTimeout(disconnectTimers.current[previousSlot]!);
        disconnectTimers.current[previousSlot] = null;
        void previousReader?.close();
        readers.current[previousSlot] = null;
      }, 320);
      return true;
    } catch (error) {
      await reader.close();
      if (readers.current[targetSlot] === reader) readers.current[targetSlot] = null;
      if (intent === playbackIntent.current) setPendingCameraId(null);
      if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
      return false;
    }
  }, [showToast]);

  const requestPlayback = useCallback(async (cameraId: string, profileId = "auto", reconnect = false): Promise<boolean> => {
    const camera = camerasRef.current.find((entry) => entry.id === cameraId);
    if (!camera || (camera.state !== "online" && !(reconnect && camera.state === "reconnecting"))) {
      if (!reconnect) showToast(`${camera?.name ?? "Camera"} is unavailable`, "The current feed will keep playing.", "danger");
      return false;
    }

    if (!reconnect) setReconnectRequest(null);
    const intent = ++playbackIntent.current;
    playbackAbort.current?.abort();
    const controller = new AbortController();
    playbackAbort.current = controller;
    setPendingCameraId(cameraId);
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        cache: "no-store",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cameraId, profileId }),
      });
      if (!response.ok) throw new Error(response.status === 401 ? "Sign in to watch this camera." : "Playback credentials are unavailable.");
      const next = (await response.json()) as SessionResponse;
      if (intent !== playbackIntent.current || controller.signal.aborted) return false;
      setSession(next);
      setCameras(next.cameras);
      if (!next.playback) throw new Error("The relay did not return a playable rendition.");
      return await installGrant(next.playback, cameraId, profileId, intent, controller);
    } catch (error) {
      if (intent !== playbackIntent.current || (error instanceof DOMException && error.name === "AbortError")) return false;
      setPendingCameraId(null);
      if (!reconnect) showToast("Switch failed — current camera retained", error instanceof Error ? error.message : "Try again in a moment.", "danger");
      return false;
    }
  }, [installGrant, showToast]);

  useEffect(() => {
    let cancelled = false;
    const timers = disconnectTimers.current;
    const load = async () => {
      try {
        const response = await fetch("/api/session", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!response.ok) throw new Error("Session service unavailable");
        const next = (await response.json()) as SessionResponse;
        if (cancelled) return;
        setSession(next);
        camerasRef.current = next.cameras;
        setCameras(next.cameras.length ? next.cameras : PREVIEW_CAMERAS);
        setSessionState("ready");
        const firstOnline = next.cameras.find((camera) => camera.state === "online");
        if (firstOnline) {
          setActiveCameraId(firstOnline.id);
          if (next.playback?.cameraId === firstOnline.id) {
            const intent = ++playbackIntent.current;
            const controller = new AbortController();
            playbackAbort.current = controller;
            await installGrant(next.playback, firstOnline.id, next.playback.profileId, intent, controller);
          }
        }
      } catch {
        if (!cancelled) setSessionState("unavailable");
      }
    };
    void load();
    return () => {
      cancelled = true;
      playbackAbort.current?.abort();
      timers.forEach((timer) => { if (timer !== null) window.clearTimeout(timer); });
      void readers.current[0]?.close();
      void readers.current[1]?.close();
      roomRef.current?.disconnect();
      clearVoiceAudioElements();
    };
  }, [installGrant]);

  useEffect(() => {
    camerasRef.current = cameras;
  }, [cameras]);

  useEffect(() => {
    if (sessionState !== "ready") return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/session", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ statusOnly: true, ...(activeCameraId ? { cameraId: activeCameraId } : {}) }),
        });
        if (!response.ok) return;
        const next = (await response.json()) as SessionResponse;
        if (cancelled) return;
        setSession((current) => ({
          ...next,
          playback: current?.playback ?? null,
          realtime: next.realtime ?? current?.realtime ?? null,
          voice: next.voice ?? current?.voice ?? null,
        }));
        setCameras(next.cameras.length ? next.cameras : PREVIEW_CAMERAS);
      } catch {
        // Media, chat, Guide, and voice retain their independent connection states.
      }
    };
    const interval = window.setInterval(() => void refresh(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeCameraId, sessionState]);

  useEffect(() => {
    if (!reconnectRequest) return;
    const delay = Math.min(4_000, 1_000 * (2 ** (reconnectRequest.attempt - 1)));
    const timer = window.setTimeout(() => {
      void requestPlayback(reconnectRequest.cameraId, reconnectRequest.profileId, true).then((connected) => {
        if (connected) return;
        setReconnectRequest((current) => {
          if (!current || current.cameraId !== reconnectRequest.cameraId || current.attempt !== reconnectRequest.attempt) return current;
          if (current.attempt < 3) return { ...current, attempt: current.attempt + 1 };
          setPendingCameraId(null);
          setCameras((items) => items.map((camera) => camera.id === current.cameraId ? { ...camera, state: "offline", errorCode: "PLAYBACK_INTERRUPTED" } : camera));
          showToast("Camera unavailable", "The relay did not recover after three attempts. Retry when the source is reachable.", "danger");
          return null;
        });
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [reconnectRequest, requestPlayback, showToast]);

  useEffect(() => {
    const restoreTheme = window.setTimeout(() => {
      try {
        if (window.localStorage.getItem(THEME_STORAGE_KEY) === "dark") setColorTheme("dark");
      } catch {
        // A blocked storage API should not prevent the light-first dashboard from loading.
      }
    }, 0);
    return () => window.clearTimeout(restoreTheme);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = colorTheme;
    document.documentElement.style.colorScheme = colorTheme;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", colorTheme === "light" ? "#f4f6fb" : "#080a0f");
  }, [colorTheme]);

  useEffect(() => {
    const initial = window.setTimeout(() => setStreamClock(new Date()), 0);
    const interval = window.setInterval(() => setStreamClock(new Date()), 1_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    audioEnabledRef.current = audioEnabled;
    readers.current.forEach((reader) => reader?.setMuted(!audioEnabled));
  }, [audioEnabled]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement
        || event.target instanceof HTMLTextAreaElement
        || event.target instanceof HTMLSelectElement
        || (event.target instanceof HTMLElement && event.target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setNotificationsOpen(false);
        setProfileOpen(false);
        setSheetOpen(false);
        setEditingCamera(null);
        setCameraMenuId(null);
        setDeleteTarget(null);
      }
      if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "v" && voiceState === "muted" && !event.repeat) {
        event.preventDefault();
        pushToTalkHeld.current = true;
        void setVoiceMicrophone(true, true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "v" && pushToTalkHeld.current) {
        pushToTalkHeld.current = false;
        void setVoiceMicrophone(false, true);
      }
    };
    const releasePushToTalk = () => {
      if (!pushToTalkHeld.current) return;
      pushToTalkHeld.current = false;
      void setVoiceMicrophone(false, true);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") releasePushToTalk();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releasePushToTalk);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releasePushToTalk);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  });

  async function joinVoice() {
    if (!session?.voice) {
      showToast("Voice is not configured", "LiveKit credentials will appear here after the companion service is connected.");
      return;
    }
    try {
      setVoiceState("connecting");
      const { Room: LiveKitRoom, RoomEvent, Track } = await import("livekit-client");
      const room = new LiveKitRoom({ adaptiveStream: true, dynacast: true });
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => setActiveSpeakers(speakers.map((speaker) => speaker.identity)));
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        const element = track.attach();
        element.autoplay = true;
        element.dataset.noverVoiceAudio = "true";
        element.hidden = true;
        document.body.append(element);
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        track.detach().forEach((element) => element.remove());
      });
      room.on(RoomEvent.Disconnected, () => {
        pushToTalkHeld.current = false;
        clearVoiceAudioElements();
        roomRef.current = null;
        setVoiceState("idle");
        setActiveSpeakers([]);
      });
      await room.connect(session.voice.url, session.voice.token, { autoSubscribe: true });
      await room.startAudio();
      roomRef.current = room;
      setVoiceState("muted");
    } catch {
      setVoiceState("idle");
      showToast("Voice connection failed", "Video playback is unaffected.", "danger");
    }
  }

  async function setVoiceMicrophone(enabled: boolean, pushToTalk = false) {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.localParticipant.setMicrophoneEnabled(enabled);
      if (roomRef.current !== room) return;
      if (enabled && pushToTalk && !pushToTalkHeld.current) {
        await room.localParticipant.setMicrophoneEnabled(false);
        if (roomRef.current === room) setVoiceState("muted");
        return;
      }
      setVoiceState(enabled ? "speaking" : "muted");
      if (enabled && !pushToTalk) showToast("Microphone on", "Your voice is now live to the room.", "success");
    } catch {
      setVoiceState("muted");
      if (enabled) showToast("Microphone permission was not granted", "You can continue listening without a microphone.", "danger");
    }
  }

  function snapshot() {
    const video = videoRefs.current[activeSlot];
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) {
      showToast("No decoded frame yet", "Snapshots are created locally once the camera is playing.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const cameraName = (activeCamera?.name ?? "camera").replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
      link.href = url;
      link.download = `${cameraName}-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`;
      link.click();
      URL.revokeObjectURL(url);
      showToast("Snapshot saved locally", "Nothing was uploaded.", "success");
    }, "image/jpeg", 0.92);
  }

  function enterFullscreen() {
    const stage = document.querySelector<HTMLElement>(".video-stage");
    if (!stage) return;
    void (document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen());
  }

  function openAddCamera() {
    setEditingCamera(null);
    setSheetOpen(true);
  }

  async function retestCamera(camera: CameraSummary) {
    setCameraMenuId(null);
    try {
      const response = await fetch(`/api/cameras/${encodeURIComponent(camera.id)}/retest`, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await response.json() as { camera?: CameraSummary; error?: { message?: string } };
      if (!response.ok || !body.camera) throw new Error(body.error?.message ?? "The camera could not be retested.");
      setCameras((current) => current.map((entry) => entry.id === body.camera?.id ? body.camera : entry));
      showToast(`${camera.name} retested`, "The relay path was reprobed and restarted.", "success");
    } catch (error) {
      showToast("Retest failed", error instanceof Error ? error.message : "Try again shortly.", "danger");
    }
  }

  async function toggleCamera(camera: CameraSummary) {
    setCameraMenuId(null);
    const enabled = camera.state === "offline" || camera.state === "capacity" || camera.state === "error";
    try {
      const response = await fetch(`/api/cameras/${encodeURIComponent(camera.id)}`, { method: "PATCH", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
      const body = await response.json() as { camera?: CameraSummary; error?: { message?: string } };
      if (!response.ok || !body.camera) throw new Error(body.error?.message ?? "The relay state could not be changed.");
      setCameras((current) => current.map((entry) => entry.id === body.camera?.id ? body.camera : entry));
      showToast(enabled ? `${camera.name} is warming` : `${camera.name} paused`, enabled ? "The relay is waiting for a fresh frame." : "Viewer sessions will expire independently.", "success");
    } catch (error) {
      showToast("Camera state unchanged", error instanceof Error ? error.message : "Try again shortly.", "danger");
    }
  }

  async function deleteCamera(camera: CameraSummary) {
    try {
      const response = await fetch(`/api/cameras/${encodeURIComponent(camera.id)}`, { method: "DELETE", cache: "no-store", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "The camera could not be removed.");
      }
      setCameras((current) => current.filter((entry) => entry.id !== camera.id));
      if (activeCameraId === camera.id) {
        playbackIntent.current += 1;
        playbackAbort.current?.abort();
        disconnectTimers.current.forEach((timer, index) => {
          if (timer !== null) window.clearTimeout(timer);
          disconnectTimers.current[index] = null;
        });
        await Promise.all(readers.current.map((reader) => reader?.close()));
        readers.current = [null, null];
        setActiveCameraId(cameras.find((entry) => entry.id !== camera.id)?.id ?? "");
        setLiveMetrics({ latencySeconds: null, bitrateMbps: null });
      }
      setDeleteTarget(null);
      showToast(`${camera.name} removed`, "Its relay paths were deleted; encrypted database deletion is permanent.", "success");
    } catch (error) {
      showToast("Camera was not removed", error instanceof Error ? error.message : "Try again shortly.", "danger");
    }
  }

  function beginResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const onMove = (move: PointerEvent) => setSidebarWidth(Math.min(500, Math.max(320, startWidth + startX - move.clientX)));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const qualityOptions = useMemo(() => {
    if (!activeCamera) return [];
    const profiles = activeCamera.profiles.map((profile) => ({ value: profile.id, label: profile.label }));
    return profiles.length > 1 ? [{ value: "auto", label: "Auto" }, ...profiles] : profiles;
  }, [activeCamera]);

  const toggleColorTheme = () => {
    setColorTheme((current) => {
      const next = current === "light" ? "dark" : "light";
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // The in-memory preference still works when storage is unavailable.
      }
      return next;
    });
  };

  return (
    <main className="app-shell" data-theme={colorTheme} data-companion-collapsed={companionCollapsed} style={{ "--sidebar-width": `${companionCollapsed ? 0 : sidebarWidth}px` } as React.CSSProperties}>
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">18</span>
          <span className="wordmark">18nover</span>
          <span className="infra-pill">SELF-HOSTED</span>
        </div>

        <div className="broadcast-state" aria-live="polite">
          <span className={isLive ? "broadcast-badge live" : "broadcast-badge standby"}>
            <i aria-hidden="true" /> {isLive ? "LIVE" : "STANDBY"}
          </span>
          <span className="mono uptime">{formatDuration(metrics.uptimeSeconds)}</span>
          <span className="header-separator" />
          <span className="health-dot" data-state={metrics.network} />
          <span>{metrics.network === "healthy" ? "Stream healthy" : "Relay unavailable"}</span>
        </div>

        <div className="header-actions">
          <span className="viewer-chip"><span aria-hidden="true">◉</span> {metrics.viewers} viewers</span>
          <button className="command-trigger" onClick={() => setCommandOpen(true)} aria-label="Open command palette">
            <span>Search</span><kbd>⌘ K</kbd>
          </button>
          <button
            className="icon-button theme-toggle tooltip"
            data-tooltip={`Switch to ${colorTheme === "light" ? "dark" : "light"} mode`}
            onClick={toggleColorTheme}
            aria-label={`Switch to ${colorTheme === "light" ? "dark" : "light"} mode`}
            aria-pressed={colorTheme === "dark"}
          >
            <span aria-hidden="true">{colorTheme === "light" ? "☾" : "☀"}</span>
          </button>
          <div className="popover-wrap">
            <button className="icon-button tooltip" data-tooltip="Notifications" onClick={() => setNotificationsOpen((open) => !open)} aria-label="Notifications">♢<span className="notification-dot" /></button>
            {notificationsOpen && <NotificationPopover onClose={() => setNotificationsOpen(false)} />}
          </div>
          <div className="popover-wrap">
            <button className="profile-button" onClick={() => setProfileOpen((open) => !open)} aria-expanded={profileOpen}>
              <Avatar initials={initials(viewer.displayName)} tone="violet" online />
              <span className="profile-copy"><strong>{viewer.displayName}</strong><small>{viewer.role}</small></span>
              <span aria-hidden="true">⌄</span>
            </button>
            {profileOpen && <ProfilePopover viewer={viewer} />}
          </div>
        </div>
      </header>

      <section className="dashboard-grid">
        <aside className="side-panel" aria-label="Panel" />

        <section className="stage-column">
          <div className={`video-stage ${pendingCameraId ? "is-connecting" : ""}`}>
            <video ref={(node) => { videoRefs.current[0] = node; }} className={`stage-video ${activeSlot === 0 ? "visible" : ""}`} playsInline autoPlay muted={!audioEnabled} />
            <video ref={(node) => { videoRefs.current[1] = node; }} className={`stage-video ${activeSlot === 1 ? "visible" : ""}`} playsInline autoPlay muted={!audioEnabled} />
            {!isLive && (
              <div className="stage-empty" role="status">
                <div className="signal-orbit"><span /><i /><b /></div>
                <span className="eyebrow">SECURE MEDIA PATH</span>
                <h1>{reconnectRequest ? `Reconnecting ${activeCamera?.name ?? "camera"}…` : pendingCameraId ? `Connecting ${cameras.find((camera) => camera.id === pendingCameraId)?.name ?? "camera"}…` : "Awaiting a camera feed"}</h1>
                <p>{sessionState === "loading" ? "Checking the relay controller." : reconnectRequest ? `Fresh playback credential attempt ${reconnectRequest.attempt} of 3.` : "Add a public RTSP source from a Host account, then test it before going live."}</p>
                <div className="path-chip"><span>RTSP</span><i>→</i><span>MediaMTX</span><i>→</i><span>WHEP</span><i>→</i><span>Browser</span></div>
                {reconnectRequest && <button className="primary-button" onClick={() => { const retry = reconnectRequest; setReconnectRequest(null); void requestPlayback(retry.cameraId, retry.profileId); }}>Retry now</button>}
                {!reconnectRequest && viewer.role === "host" && <button className="primary-button" onClick={openAddCamera}>+ Add RTSP camera</button>}
              </div>
            )}
            <div className="video-vignette" />
            <div className="stage-top-overlay">
              <div className="overlay-group">
                <span className={isLive ? "video-live" : "video-standby"}>{isLive ? "LIVE" : "OFFLINE"}</span>
                <span className="camera-label">{activeCamera?.name ?? "No camera"}</span>
              </div>
              <div className="overlay-group mono">
                <span data-stream-clock="true">{streamClock ? streamClock.toLocaleTimeString([], { hour12: false }) : "--:--:--"}</span>
                {activeCamera?.relayMode !== "unavailable" && <span className="relay-mode">{activeCamera.relayMode}</span>}
              </div>
            </div>
            <div className="floating-controls" aria-label="Video controls">
              <div className="control-meta">
                <span className="control-camera-dot" data-state={activeCamera?.state ?? "offline"} />
                <div><strong>{activeCamera?.name ?? "No camera"}</strong><small>{isLive ? `${safeNumber(metrics.latencySeconds, "s")} WebRTC` : cameraStateLabel(activeCamera ?? PREVIEW_CAMERAS[0])}</small></div>
              </div>
              <div className="control-actions">
                <label className="quality-select tooltip" data-tooltip="Playback quality">
                  <span className="sr-only">Playback quality</span>
                  <select value={activeProfileId} disabled={!qualityOptions.length || pendingCameraId !== null} onChange={(event) => void requestPlayback(activeCamera.id, event.target.value)}>
                    {qualityOptions.length ? qualityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>) : <option value="auto">Source</option>}
                  </select>
                </label>
                <button className="player-button tooltip" data-tooltip={audioEnabled ? "Mute camera audio" : "Enable camera audio"} onClick={() => setAudioEnabled((enabled) => !enabled)} aria-label={audioEnabled ? "Mute camera audio" : "Enable camera audio"}>{audioEnabled ? "◖))" : "◖×"}</button>
                <button className="player-button tooltip" data-tooltip="Save local snapshot" onClick={snapshot} aria-label="Save local snapshot">◎</button>
                <button className="player-button tooltip" data-tooltip="Fullscreen" onClick={enterFullscreen} aria-label="Toggle fullscreen">⛶</button>
              </div>
            </div>
          </div>

          <div className="camera-section">
            <div className="section-heading">
              <div><span className="eyebrow">CAMERAS</span><h2>Choose a source</h2></div>
              <span className="warm-count">{cameras.filter((camera) => camera.state === "online").length}/4 warm</span>
            </div>
            <div className="camera-switcher">
              {cameras.map((camera) => (
                <article className={`camera-card ${camera.id === activeCameraId ? "active" : ""} ${viewer.role === "host" ? "" : "viewer"}`} key={camera.id}>
                  <button className="camera-select" onClick={() => void requestPlayback(camera.id)} disabled={pendingCameraId !== null}>
                    <span className="camera-preview"><i className="preview-grid" /><span className="camera-monogram">{camera.name.slice(0, 2).toUpperCase()}</span><span className="preview-state" data-state={camera.state}>{pendingCameraId === camera.id ? "CONNECTING" : cameraStateLabel(camera).toUpperCase()}</span></span>
                    <span className="camera-card-copy"><strong>{camera.name}</strong><small>{camera.width && camera.height ? `${camera.width}×${camera.height} · ${safeNumber(camera.fps, " fps")}` : "No frames received"}</small></span>
                  </button>
                  {viewer.role === "host" && <button className="card-overflow" aria-label={`Manage ${camera.name}`} onClick={() => setCameraMenuId((current) => current === camera.id ? null : camera.id)}>⋮</button>}
                  {viewer.role === "host" && cameraMenuId === camera.id && <div className="camera-context" role="menu">
                    <button role="menuitem" onClick={() => void retestCamera(camera)}>↻ <span>Retest & restart</span></button>
                    <button role="menuitem" onClick={() => void toggleCamera(camera)}>{camera.state === "offline" || camera.state === "capacity" || camera.state === "error" ? "▶" : "Ⅱ"} <span>{camera.state === "offline" || camera.state === "capacity" || camera.state === "error" ? "Enable relay" : "Pause relay"}</span></button>
                    <button role="menuitem" onClick={() => { setEditingCamera(camera); setSheetOpen(true); setCameraMenuId(null); }}>⌁ <span>Replace credentials</span></button>
                    <button role="menuitem" className="danger" onClick={() => { setDeleteTarget(camera); setCameraMenuId(null); }}>× <span>Remove camera</span></button>
                  </div>}
                </article>
              ))}
              <button className={`camera-card add-camera ${viewer.role !== "host" ? "locked" : ""}`} onClick={() => viewer.role === "host" ? openAddCamera() : showToast("Host access required", "Only Hosts can register camera sources.")}>
                <span className="add-icon">+</span>
                <span className="camera-card-copy"><strong>Add camera</strong><small>{viewer.role === "host" ? `${cameras.length}/8 registered` : "Host only"}</small></span>
                {viewer.role !== "host" && <span aria-hidden="true">⌑</span>}
              </button>
            </div>
          </div>
        </section>

        <aside className="companion-sidebar">
          <button className="resize-handle" onPointerDown={beginResize} aria-label="Resize companion sidebar" />
          <button
            className="panel-collapse-toggle"
            onClick={() => setCompanionCollapsed((collapsed) => !collapsed)}
            aria-label={companionCollapsed ? "Show companion panel" : "Hide companion panel"}
            aria-pressed={companionCollapsed}
          >
            <span aria-hidden="true">{companionCollapsed ? "‹" : "›"}</span>
          </button>
          <div className="companion-card">
            <div className="sidebar-tabs" role="tablist" aria-label="Stream companions">
              {(["chat", "guide", "members"] as SideTab[]).map((tab) => <button key={tab} role="tab" aria-selected={sideTab === tab} onClick={() => setSideTab(tab)}>{tab[0].toUpperCase() + tab.slice(1)}{tab === "members" && <span>{metrics.voiceMembers || "—"}</span>}</button>)}
            </div>
            {sideTab === "chat" && (
              <ChatPanel
                composer={composer}
                setComposer={setComposer}
                realtimeAvailable={Boolean(session?.realtime)}
                showToast={showToast}
                voiceState={voiceState}
                onJoinVoice={() => void joinVoice()}
                onVoiceMic={() => void setVoiceMicrophone(voiceState !== "speaking")}
                onLeaveVoice={() => { pushToTalkHeld.current = false; roomRef.current?.disconnect(); roomRef.current = null; clearVoiceAudioElements(); setVoiceState("idle"); }}
              />
            )}
            {sideTab === "guide" && <GuidePanel realtimeAvailable={Boolean(session?.realtime)} />}
            {sideTab === "members" && <MembersPanel activeSpeakers={activeSpeakers} voiceMembers={metrics.voiceMembers} realtimeAvailable={Boolean(session?.realtime)} />}
          </div>
        </aside>
      </section>

      {sheetOpen && <AddCameraSheet camera={editingCamera} onClose={() => { setSheetOpen(false); setEditingCamera(null); }} onSaved={(camera) => { setCameras((current) => [...current.filter((entry) => entry.id !== camera.id), camera]); setSheetOpen(false); setEditingCamera(null); showToast(editingCamera ? `${camera.name} updated` : `${camera.name} added`, "The relay is preparing its browser rendition.", "success"); }} showToast={showToast} />}
      {deleteTarget && <ConfirmDelete camera={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={() => deleteCamera(deleteTarget)} />}
      {commandOpen && <CommandPalette cameras={cameras} onClose={() => setCommandOpen(false)} onCamera={(id) => { setCommandOpen(false); void requestPlayback(id); }} onAdd={() => { setCommandOpen(false); if (viewer.role === "host") openAddCamera(); else showToast("Host access required"); }} />}
      <div className="toast-stack" aria-live="polite">{toasts.map((toast) => <div className={`toast ${toast.tone ?? ""}`} key={toast.id}><span>{toast.tone === "success" ? "✓" : toast.tone === "danger" ? "!" : "i"}</span><div><strong>{toast.title}</strong>{toast.detail && <p>{toast.detail}</p>}</div><button onClick={() => setToasts((current) => current.filter((entry) => entry.id !== toast.id))} aria-label="Dismiss">×</button></div>)}</div>
    </main>
  );
}

function Avatar({ initials: value, tone, online = false, speaking = false }: { initials: string; tone: string; online?: boolean; speaking?: boolean }) {
  return <span className={`avatar ${tone} ${speaking ? "speaking" : ""}`}><span>{value}</span>{online && <i className="presence-dot" />}</span>;
}

function ChatPanel({ composer, setComposer, realtimeAvailable, showToast, voiceState, onJoinVoice, onVoiceMic, onLeaveVoice }: { composer: string; setComposer: (value: string) => void; realtimeAvailable: boolean; showToast: (title: string, detail?: string) => void; voiceState: VoiceState; onJoinVoice: () => void; onVoiceMic: () => void; onLeaveVoice: () => void }) {
  function send(event: FormEvent) {
    event.preventDefault();
    if (!composer.trim()) return;
    if (!realtimeAvailable) showToast("Chat is not connected", "The authenticated realtime service can be connected independently of video.");
    setComposer("");
  }
  return <div className="panel-body chat-panel">
    <div className="panel-status"><span className={realtimeAvailable ? "service-dot online" : "service-dot"} />{realtimeAvailable ? "Realtime credentials ready" : "Realtime service unavailable"}<button aria-label="Chat menu">⋮</button></div>
    <VoiceShell state={voiceState} onJoin={onJoinVoice} onMic={onVoiceMic} onLeave={onLeaveVoice} />
    <div className="message-list">
      <div className="timeline-label"><span />RECENT ACTIVITY<span /></div>
      {DEV_PREVIEW && CHAT_MESSAGES.map((message) => message.kind === "system" ? <div className="system-message" key={message.id}><span className="system-icon">↗</span><p>{message.text}<small>{message.time}</small></p></div> : <article className="chat-message" key={message.id}><Avatar initials={message.initials} tone={message.name === "Sarah" ? "rose" : "amber"} online /><div><header><strong>{message.name}</strong><span className={`member-badge ${message.badge === "Moderator" ? "moderator" : ""}`}>{message.badge}</span><time>{message.time}</time></header><p>{message.text}</p>{message.reaction && <button className="reaction">{message.reaction}</button>}</div><button className="message-more" aria-label={`More actions for ${message.name}`}>⋮</button></article>)}
      {DEV_PREVIEW && realtimeAvailable && <div className="typing-indicator"><span><i /><i /><i /></span> Mara is typing</div>}
      {!DEV_PREVIEW && <div className="empty-state"><span>⌁</span><strong>No live messages yet</strong><p>Only authenticated realtime events are rendered in production.</p></div>}
      {DEV_PREVIEW && <p className="panel-footnote">Preview data only. Production messages arrive exclusively from the authenticated realtime service.</p>}
    </div>
    <form className="composer" onSubmit={send}><button type="button" aria-label="Add attachment" disabled={!realtimeAvailable}>+</button><input value={composer} onChange={(event) => setComposer(event.target.value)} placeholder={realtimeAvailable ? "Message the stream…" : "Chat unavailable"} aria-label="Chat message" disabled={!realtimeAvailable} /><button type="button" aria-label="Choose emoji" disabled={!realtimeAvailable}>☺</button><button className="send-button" aria-label="Send message" disabled={!realtimeAvailable}>↑</button></form>
  </div>;
}

function GuidePanel({ realtimeAvailable }: { realtimeAvailable: boolean }) {
  return <div className="panel-body guide-panel">
    <div className="guide-intro"><div className="guide-mark">G</div><div><strong>Operations Guide</strong><p>AI narration stays separate from camera playback.</p></div><span className={realtimeAvailable ? "service-pill online" : "service-pill"}>{realtimeAvailable ? "CONNECTED" : "OFFLINE"}</span></div>
    <div className="guide-filter"><button className="active">All events</button><button>Orbit</button><button>Explorer</button></div>
    <div className="guide-log">{DEV_PREVIEW ? GUIDE_EVENTS.map((event, index) => <article className={`guide-event ${event.kind}`} key={`${event.time}-${event.source}`}><div className="log-rail"><span>{index + 1}</span><i /></div><div><header><time>{event.time}</time><strong>{event.source}</strong>{event.kind === "guide" && <span>AI</span>}</header><p>{event.text}</p></div></article>) : <div className="empty-state"><span>G</span><strong>No operations events</strong><p>Detected events and AI narration will appear when the authenticated Guide feed publishes them.</p></div>}</div>
    <form className="guide-composer" onSubmit={(event) => event.preventDefault()}><input placeholder={realtimeAvailable ? "Ask what the cameras can see…" : "Guide unavailable"} aria-label="Ask Guide" disabled={!realtimeAvailable} /><kbd>↵</kbd></form>
    {DEV_PREVIEW && <p className="panel-footnote">Preview data only. Production events arrive exclusively from the authenticated Guide service.</p>}
  </div>;
}

function MembersPanel({ activeSpeakers, voiceMembers, realtimeAvailable }: { activeSpeakers: string[]; voiceMembers: number; realtimeAvailable: boolean }) {
  const speakerTones = ["violet", "rose", "cyan", "amber"];
  return <div className="panel-body members-panel">
    <div className="member-summary"><div className="avatar-stack">{(DEV_PREVIEW ? MEMBERS.slice(0, 4).map((member) => ({ name: member.name, initials: member.initials, tone: member.color })) : activeSpeakers.slice(0, 4).map((name, index) => ({ name, initials: initials(name), tone: speakerTones[index % speakerTones.length]! }))).map((member) => <Avatar key={member.name} initials={member.initials} tone={member.tone} speaking={activeSpeakers.includes(member.name)} />)}</div><div><strong>{realtimeAvailable ? `${voiceMembers} voice member${voiceMembers === 1 ? "" : "s"}` : "Presence unavailable"}</strong><p>{activeSpeakers.length ? `${activeSpeakers.length} speaking now` : "No active speakers"}</p></div></div>
    {DEV_PREVIEW ? (["IN VOICE — 3", "ONLINE — 4"] as const).map((group) => <section className="member-group" key={group}><h3>{group}</h3>{MEMBERS.filter((member) => group.startsWith("IN VOICE") ? member.status === "In voice" || member.status === "Listening" : member.status === "Online").map((member) => <article className="member-row" key={member.name}><Avatar initials={member.initials} tone={member.color} online speaking={realtimeAvailable && (member.speaking || activeSpeakers.includes(member.name))} /><div><strong>{member.name}</strong><span>{member.status}</span></div><span className={`role-badge ${member.role.toLowerCase()}`}>{member.role}</span><button aria-label={`More actions for ${member.name}`}>⋮</button></article>)}</section>) : activeSpeakers.length ? <section className="member-group"><h3>SPEAKING — {activeSpeakers.length}</h3>{activeSpeakers.map((name, index) => <article className="member-row" key={name}><Avatar initials={initials(name)} tone={speakerTones[index % speakerTones.length]!} online speaking /><div><strong>{name}</strong><span>In voice</span></div><span className="role-badge member">Member</span></article>)}</section> : <div className="empty-state"><span>◌</span><strong>No presence events</strong><p>Authenticated presence and voice activity will appear here.</p></div>}
    <div className="empty-state"><span>◌</span><strong>Listener-only by default</strong><p>Viewers never publish a camera track.</p></div>
    {DEV_PREVIEW && <p className="panel-footnote">Preview data only. Production presence comes exclusively from authenticated realtime and voice services.</p>}
  </div>;
}

function VoiceShell({ state, onJoin, onMic, onLeave }: { state: VoiceState; onJoin: () => void; onMic: () => void; onLeave: () => void }) {
  const connected = state !== "idle" && state !== "connecting";
  return <div className="voice-shell">
    <span className="voice-wave"><i /><i /><i /><i /></span>
    <div className="voice-shell-copy">
      <strong>Voice</strong>
      <small>{state === "idle" ? "Not connected" : state === "connecting" ? "Connecting securely…" : state === "speaking" ? "You are speaking" : "Connected · microphone muted"}</small>
    </div>
    <div className="voice-shell-actions">
      {!connected
        ? <button className="voice-join" onClick={onJoin} disabled={state === "connecting"}>{state === "connecting" ? "Connecting…" : "Join voice"}</button>
        : <>
          <button className={`voice-mic ${state === "speaking" ? "active" : ""}`} onClick={onMic}>{state === "speaking" ? "Mic on" : "Muted"}</button>
          <button className="voice-leave" onClick={onLeave} aria-label="Leave voice">×</button>
        </>}
    </div>
  </div>;
}

function AddCameraSheet({ camera, onClose, onSaved, showToast }: { camera: CameraSummary | null; onClose: () => void; onSaved: (camera: CameraSummary) => void; showToast: (title: string, detail?: string, tone?: Toast["tone"]) => void }) {
  const [form, setForm] = useState<CameraInput>({ name: camera?.name ?? "", url: "", username: "", password: "", substreamUrl: "", transport: "tcp", audio: camera?.audio ?? true });
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [busy, setBusy] = useState<"probe" | "save" | null>(null);

  function update<K extends keyof CameraInput>(key: K, value: CameraInput[K]) { setForm((current) => ({ ...current, [key]: value })); setProbe(null); }

  async function callCameraApi(mode: "probe" | "save") {
    setBusy(mode);
    try {
      const endpoint = mode === "probe"
        ? "/api/cameras/probe"
        : camera
          ? `/api/cameras/${encodeURIComponent(camera.id)}`
          : "/api/cameras";
      const response = await fetch(endpoint, { method: mode === "save" && camera ? "PATCH" : "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const body = await response.json().catch(() => ({})) as { result?: ProbeResult; camera?: CameraSummary; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The relay could not complete this request.");
      if (mode === "probe" && body.result) { setProbe(body.result); showToast("Connection test passed", `${body.result.inputCodec.toUpperCase()} will be ${body.result.relayMode}.`, "success"); }
      if (mode === "save" && body.camera) onSaved(body.camera);
    } catch (error) {
      showToast(mode === "probe" ? "Connection test failed" : "Camera was not saved", error instanceof Error ? error.message : "Check the source and try again.", "danger");
    } finally { setBusy(null); }
  }

  return <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="camera-sheet" role="dialog" aria-modal="true" aria-labelledby="add-camera-title"><header><div><span className="eyebrow">HOST CONTROL</span><h2 id="add-camera-title">{camera ? `Replace ${camera.name}` : "Add RTSP camera"}</h2><p>{camera ? "Re-enter the complete network source and credentials. Stored secrets are never sent back to this browser." : "Open a network stream through the private relay—like VLC, without exposing the source to viewers."}</p></div><button onClick={onClose} aria-label="Close camera sheet">×</button></header><div className="sheet-scroll">
    <div className="security-callout"><span>⌁</span><div><strong>Write-only source</strong><p>The complete URL and credentials are encrypted by the relay and never returned to this browser after save.</p></div></div>
    <div className="form-grid"><label className="full"><span>Camera name</span><input autoFocus value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="e.g. North driveway" maxLength={64} /></label><label className="full"><span>RTSP network URL</span><input value={form.url} onChange={(event) => update("url", event.target.value)} placeholder="rtsp://camera.example.com:554/stream" autoComplete="off" spellCheck={false} /></label><label><span>Username</span><input value={form.username} onChange={(event) => update("username", event.target.value)} autoComplete="off" /></label><label><span>Password</span><input type="password" value={form.password} onChange={(event) => update("password", event.target.value)} autoComplete="new-password" /></label><label className="full optional"><span>Low-bandwidth / substream URL <em>Optional</em></span><input value={form.substreamUrl} onChange={(event) => update("substreamUrl", event.target.value)} placeholder="rtsps://camera.example.com:8554/substream" autoComplete="off" spellCheck={false} /></label><label><span>Transport</span><select value={form.transport} onChange={(event) => update("transport", event.target.value as "tcp" | "udp")}><option value="tcp">TCP (secure default)</option><option value="udp" disabled>UDP (operator policy disabled)</option></select></label><label className="toggle-label"><span><strong>Camera audio</strong><small>Relay an audio track when present</small></span><button type="button" className={`toggle ${form.audio ? "on" : ""}`} onClick={() => update("audio", !form.audio)} aria-pressed={form.audio}><i /></button></label></div>
    {probe && <div className="probe-result"><header><span>✓</span><div><strong>Connection verified</strong><p>Latest frame {new Date(probe.latestFrameAt).toLocaleTimeString()}</p></div><b>{probe.relayMode.toUpperCase()}</b></header><dl><div><dt>Video</dt><dd>{probe.inputCodec.toUpperCase()} · {probe.profile ?? "unknown"}</dd></div><div><dt>Frame</dt><dd>{probe.width}×{probe.height} · {probe.fps} fps</dd></div><div><dt>B-frames</dt><dd>{probe.hasBFrames ? "Detected" : "None"}</dd></div><div><dt>Bitrate</dt><dd>{probe.bitrateKbps ? `${(probe.bitrateKbps / 1000).toFixed(1)} Mbps` : "Unknown"}</dd></div><div><dt>Audio</dt><dd>{probe.audioCodec?.toUpperCase() ?? "None"}</dd></div><div><dt>Outputs</dt><dd>{probe.profiles.map((profile) => profile.label).join(" · ") || "Source"}</dd></div></dl></div>}
  </div><footer><button className="secondary-button" onClick={onClose}>Cancel</button><button className="test-button" disabled={busy !== null || !form.name || !form.url} onClick={() => void callCameraApi("probe")}>{busy === "probe" ? "Testing…" : "Test connection"}</button><button className="primary-button" disabled={busy !== null || !probe} onClick={() => void callCameraApi("save")}>{busy === "save" ? "Saving…" : camera ? "Save replacement" : "Save & activate"}</button></footer></section></div>;
}

function ConfirmDelete({ camera, onCancel, onConfirm }: { camera: CameraSummary; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  }

  return <div className="command-backdrop confirm-backdrop" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onCancel(); }}><section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="remove-camera-title" aria-describedby="remove-camera-detail"><span className="confirm-icon">×</span><div><span className="eyebrow">PERMANENT ACTION</span><h2 id="remove-camera-title">Remove {camera.name}?</h2><p id="remove-camera-detail">This deletes its relay paths and encrypted source record. Active viewer sessions will end, and the credentials cannot be recovered.</p></div><footer><button className="secondary-button" onClick={onCancel} disabled={busy}>Cancel</button><button className="danger-button" onClick={() => void remove()} disabled={busy}>{busy ? "Removing…" : "Remove camera"}</button></footer></section></div>;
}

function NotificationPopover({ onClose }: { onClose: () => void }) {
  return <div className="header-popover notifications"><header><strong>Notifications</strong><button onClick={onClose}>Done</button></header><article><span className="notif-icon violet">⌁</span><div><strong>Relay integration required</strong><p>Connect the Docker host before publishing.</p><time>Now</time></div></article><article><span className="notif-icon cyan">G</span><div><strong>Guide is isolated</strong><p>AI events can reconnect without interrupting video.</p><time>Setup</time></div></article></div>;
}

function ProfilePopover({ viewer }: { viewer: ViewerIdentity }) {
  return <div className="header-popover profile-popover"><div className="profile-popover-head"><Avatar initials={initials(viewer.displayName)} tone="violet" online /><div><strong>{viewer.displayName}</strong><span>{viewer.role}</span></div></div><button>Account settings <span>›</span></button><button>Keyboard shortcuts <kbd>?</kbd></button><div className="popover-separator" /><a href="/signout-with-chatgpt?return_to=%2F">Sign out</a></div>;
}

function CommandPalette({ cameras, onClose, onCamera, onAdd }: { cameras: CameraSummary[]; onClose: () => void; onCamera: (id: string) => void; onAdd: () => void }) {
  const [query, setQuery] = useState("");
  const matches = cameras.filter((camera) => camera.name.toLowerCase().includes(query.toLowerCase()));
  return <div className="command-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette"><label><span>⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search cameras and actions…" /><kbd>ESC</kbd></label><div className="command-results"><h3>CAMERAS</h3>{matches.map((camera) => <button key={camera.id} onClick={() => onCamera(camera.id)}><span className="command-camera">{camera.name.slice(0, 2).toUpperCase()}</span><span><strong>Open {camera.name}</strong><small>{cameraStateLabel(camera)}</small></span><kbd>↵</kbd></button>)}<h3>ACTIONS</h3><button onClick={onAdd}><span className="command-action">+</span><span><strong>Add RTSP camera</strong><small>Host control</small></span></button></div><footer><span><kbd>↑↓</kbd> Navigate</span><span><kbd>↵</kbd> Select</span><span>Sources are never searchable by URL</span></footer></section></div>;
}
