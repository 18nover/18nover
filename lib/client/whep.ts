import type { PlaybackGrant } from "../contracts";

type WhepCallbacks = {
  onConnectionState?: (state: RTCPeerConnectionState) => void;
  onMetrics?: (metrics: { latencySeconds: number | null; bitrateMbps: number | null }) => void;
};

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
};

export class WhepReader {
  private readonly video: VideoWithFrameCallback;
  private readonly grant: PlaybackGrant;
  private readonly callbacks: WhepCallbacks;
  private readonly peer: RTCPeerConnection;
  private resourceUrl: string | null = null;
  private metricsTimer: number | null = null;
  private leaseTimer: number | null = null;
  private lastBytes: { value: number; at: number } | null = null;
  private closed = false;

  constructor(video: HTMLVideoElement, grant: PlaybackGrant, callbacks: WhepCallbacks = {}) {
    this.video = video;
    this.grant = grant;
    this.callbacks = callbacks;
    this.peer = new RTCPeerConnection({ bundlePolicy: "max-bundle" });
    this.peer.addTransceiver("video", { direction: "recvonly" });
    this.peer.addTransceiver("audio", { direction: "recvonly" });
  }

  async connect(signal?: AbortSignal): Promise<void> {
    const grantUrl = validateGrantUrl(this.grant.whepUrl);
    this.peer.onconnectionstatechange = () => {
      this.callbacks.onConnectionState?.(this.peer.connectionState);
    };

    const stream = new MediaStream();
    this.video.srcObject = stream;
    this.peer.ontrack = (event) => {
      stream.addTrack(event.track);
    };

    const offer = await this.peer.createOffer();
    await this.peer.setLocalDescription(offer);
    await waitForIceGathering(this.peer, signal);

    if (!this.peer.localDescription?.sdp) {
      throw new Error("The browser could not prepare a WebRTC offer.");
    }

    const response = await fetch(this.grant.whepUrl, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal,
      headers: {
        Authorization: `${this.grant.tokenType} ${this.grant.accessToken}`,
        "Content-Type": "application/sdp",
      },
      body: this.peer.localDescription.sdp,
    });

    if (!response.ok || response.status !== 201) {
      throw new Error(`Playback negotiation failed (${response.status}).`);
    }

    const answer = await response.text();
    if (!answer || answer.length > 256_000) {
      throw new Error("The media relay returned an invalid WebRTC answer.");
    }

    const location = response.headers.get("Location");
    if (!location) throw new Error("The media relay did not return a WHEP resource location.");
    const resourceUrl = new URL(location, grantUrl);
    const resourcePrefix = `${grantUrl.pathname}/`;
    const resourceId = resourceUrl.pathname.startsWith(resourcePrefix) ? resourceUrl.pathname.slice(resourcePrefix.length) : "";
    if (
      resourceUrl.origin !== grantUrl.origin
      || resourceUrl.username
      || resourceUrl.password
      || resourceUrl.search
      || resourceUrl.hash
      || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(resourceId)
    ) throw new Error("The media relay returned an invalid WHEP resource location.");
    this.resourceUrl = resourceUrl.toString();
    await this.peer.setRemoteDescription({ type: "answer", sdp: answer });
    await waitForFirstFrame(this.video, signal);
    this.leaseTimer = window.setInterval(() => void this.keepLeaseAlive(), 120_000);
    this.startMetrics();
  }

  setMuted(muted: boolean) {
    this.video.muted = muted;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.metricsTimer !== null) window.clearInterval(this.metricsTimer);
    if (this.leaseTimer !== null) window.clearInterval(this.leaseTimer);
    this.peer.ontrack = null;
    this.peer.onconnectionstatechange = null;
    this.peer.close();
    this.video.pause();
    this.video.srcObject = null;

    if (this.resourceUrl) {
      try {
        await fetch(this.resourceUrl, {
          method: "DELETE",
          redirect: "error",
          keepalive: true,
          headers: { Authorization: `${this.grant.tokenType} ${this.grant.accessToken}` },
        });
      } catch {
        // The peer is already closed locally; server-side WHEP expiry is the fallback cleanup.
      }
    }
  }

  private startMetrics() {
    const sample = async () => {
      const report = await this.peer.getStats();
      let latencySeconds: number | null = null;
      let bytes = 0;

      report.forEach((stat) => {
        if (stat.type === "candidate-pair" && stat.state === "succeeded" && stat.currentRoundTripTime) {
          latencySeconds = Number(stat.currentRoundTripTime);
        }
        if (stat.type === "inbound-rtp" && stat.kind === "video" && !stat.isRemote) {
          bytes += Number(stat.bytesReceived ?? 0);
        }
      });

      const now = performance.now();
      let bitrateMbps: number | null = null;
      if (this.lastBytes && now > this.lastBytes.at && bytes >= this.lastBytes.value) {
        bitrateMbps = ((bytes - this.lastBytes.value) * 8) / ((now - this.lastBytes.at) * 1000);
      }
      this.lastBytes = { value: bytes, at: now };
      this.callbacks.onMetrics?.({ latencySeconds, bitrateMbps });
    };

    void sample();
    this.metricsTimer = window.setInterval(() => void sample(), 2_000);
  }

  private async keepLeaseAlive() {
    if (!this.resourceUrl || this.closed) return;
    try {
      await fetch(this.resourceUrl, {
        method: "HEAD",
        redirect: "error",
        cache: "no-store",
        headers: { Authorization: `${this.grant.tokenType} ${this.grant.accessToken}` },
      });
    } catch {
      // The peer connection remains authoritative; a later disconnect obtains a fresh grant.
    }
  }
}

function validateGrantUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.search
    || url.hash
    || !/^\/whep\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/whep$/.test(url.pathname)
  ) throw new Error("The playback endpoint is invalid.");
  return url;
}

function waitForIceGathering(peer: RTCPeerConnection, signal?: AbortSignal): Promise<void> {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error("WebRTC ICE gathering timed out.")), 8_000);
    const onChange = () => {
      if (peer.iceGatheringState === "complete") finish();
    };
    const onAbort = () => finish(new DOMException("Aborted", "AbortError"));
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      peer.removeEventListener("icegatheringstatechange", onChange);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    peer.addEventListener("icegatheringstatechange", onChange);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function waitForFirstFrame(video: VideoWithFrameCallback, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error("The camera connected but no frame arrived.")), 12_000);
    const onAbort = () => finish(new DOMException("Aborted", "AbortError"));
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const ready = () => {
      void video.play().then(() => {
        if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => finish());
        else if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) finish();
        else video.addEventListener("loadeddata", () => finish(), { once: true });
      }, finish);
    };
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) ready();
    else video.addEventListener("loadedmetadata", ready, { once: true });
  });
}
