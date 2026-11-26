/**
 * The room's side of the StreamLine Media Player tab
 * (public/media-player.html), which plays YouTube videos for lib/mediaVideo.ts.
 *
 * A YouTube embed can't be captured from inside the room page (cross-origin
 * iframe), and capturing the room tab would also capture the guests' voices.
 * So YouTube plays in its own tab and the room captures that one tab
 * (getDisplayMedia, picture + that tab's audio only), once per show:
 *
 *   open()     – click 1: opens the player tab; the host clicks "Start the
 *                player" there (the activation YouTube needs to play sound)
 *   capture()  – click 2, back in the room: the host picks the player tab in
 *                the browser's share picker. A capture handle confirms the
 *                right tab was picked.
 *
 * After that, load()/play()/pause()/seek()/stop() drive the player over a
 * BroadcastChannel and the captured tracks stay live until the tab closes
 * or the host stops sharing it.
 */

export type PlayerLinkStatus = "none" | "opening" | "ready" | "connected";

type RoomMessage =
  | { to: "room"; type: "ready" }
  | { to: "room"; type: "playing"; req: number; title?: string; d?: number }
  | { to: "room"; type: "state"; state: "playing" | "paused" | "ended"; t?: number; d?: number }
  | { to: "room"; type: "time"; t?: number; d?: number }
  | { to: "room"; type: "error"; req: number | null; code?: unknown }
  | { to: "room"; type: "closed" };

/** Average RGB of a captured picture (for the color check in capture()). */
export type ColorSampler = { sample(): Promise<[number, number, number] | null>; close(): void };

export interface ChannelLike {
  postMessage(m: unknown): void;
  close(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export type PlayerLinkDeps = {
  openWindow?: (url: string) => Window | null;
  createChannel?: (name: string) => ChannelLike;
  getDisplayMedia?: (options: Record<string, unknown>) => Promise<MediaStream>;
  playerUrl?: string;
  randomId?: () => string;
  loadTimeoutMs?: number;
  /** Reads frames of a captured track (default: <video> + canvas). */
  createSampler?: (track: MediaStreamTrack) => ColorSampler;
  /** How long the color check waits for the player tab's color (ms). */
  verifyTimeoutMs?: number;
};

export type PlayerEvents = {
  onStatus?: (s: PlayerLinkStatus) => void;
  onState?: (state: "playing" | "paused" | "ended") => void;
  onTime?: (t: number, d: number) => void;
  /** The capture ended (tab closed / sharing stopped). */
  onDisconnected?: () => void;
};

/** Human-readable reason for a YouTube player error code. */
export function youTubeErrorMessage(code: unknown): string {
  if (code === 101 || code === 150) return "The video's owner doesn't allow it to be played in other apps.";
  if (code === 100) return "This video was removed or is private.";
  if (code === 2) return "That isn't a valid YouTube video.";
  if (code === 5) return "YouTube couldn't play this video in the player.";
  if (code === "api") return "The player tab couldn't load YouTube.";
  if (code === "timeout") return "The player tab didn't start the video. Click inside the player tab once, then try again.";
  return "YouTube couldn't play this video.";
}

function defaultRandomId(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => (b % 36).toString(36)).join("");
}

/** Distinct, saturated colors survive video compression well. */
const CHECK_COLORS: Array<[number, number, number]> = [
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 0],
  [0, 255, 0],
  [255, 128, 0],
];

function colorClose(a: [number, number, number], b: [number, number, number]): boolean {
  return a.every((v, i) => Math.abs(v - b[i]) <= 60);
}

function defaultSampler(track: MediaStreamTrack): ColorSampler {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([track]);
  void video.play().catch(() => {});
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 18;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  return {
    async sample() {
      if (!g || video.readyState < 2) return null;
      g.drawImage(video, 0, 0, 32, 18);
      // Middle of the picture: away from any browser-drawn borders.
      const d = g.getImageData(8, 4, 16, 10).data;
      let r = 0, gr = 0, b = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        gr += d[i + 1];
        b += d[i + 2];
      }
      return [r / n, gr / n, b / n];
    },
    close() {
      video.srcObject = null;
    },
  };
}

function defaultPlayerUrl(): string {
  const base = (import.meta.env?.BASE_URL as string | undefined) || "/";
  return new URL(`${base.replace(/\/?$/, "/")}media-player.html`, window.location.origin).href;
}

export class YouTubePlayerLink {
  status: PlayerLinkStatus = "none";
  videoTrack: MediaStreamTrack | null = null;
  audioTrack: MediaStreamTrack | null = null;

  private ch: string;
  private channel: ChannelLike | null = null;
  private reqSeq = 0;
  private pendingLoad: { req: number; resolve: (title: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private deps: Required<PlayerLinkDeps>;
  private events: PlayerEvents = {};

  constructor(deps: PlayerLinkDeps = {}) {
    this.deps = {
      openWindow: deps.openWindow ?? ((url) => window.open(url, "_blank")),
      createChannel: deps.createChannel ?? ((name) => new BroadcastChannel(name) as unknown as ChannelLike),
      getDisplayMedia:
        deps.getDisplayMedia ??
        ((o) => navigator.mediaDevices.getDisplayMedia(o as DisplayMediaStreamOptions)),
      playerUrl: deps.playerUrl ?? "",
      randomId: deps.randomId ?? defaultRandomId,
      loadTimeoutMs: deps.loadTimeoutMs ?? 20000,
      createSampler: deps.createSampler ?? defaultSampler,
      verifyTimeoutMs: deps.verifyTimeoutMs ?? 3000,
    };
    this.ch = this.deps.randomId();
  }

  setEvents(e: PlayerEvents): void {
    this.events = e;
  }

  private setStatus(s: PlayerLinkStatus) {
    this.status = s;
    this.events.onStatus?.(s);
  }

  private ensureChannel(): ChannelLike {
    if (!this.channel) {
      this.channel = this.deps.createChannel(`sl-media-player:${this.ch}`);
      this.channel.onmessage = (ev) => this.onMessage(ev.data as RoomMessage);
    }
    return this.channel;
  }

  private send(m: Record<string, unknown>) {
    this.ensureChannel().postMessage({ ...m, to: "player" });
  }

  /** Click 1: opens (or re-finds) the player tab. Must run inside a click handler. */
  open(): boolean {
    this.ensureChannel();
    const url = new URL(this.deps.playerUrl || defaultPlayerUrl());
    url.searchParams.set("ch", this.ch);
    const win = this.deps.openWindow(url.href);
    if (!win) return false; // popup blocked
    if (this.status === "none") this.setStatus("opening");
    // An already-open, already-started player answers right away.
    this.send({ type: "ping" });
    return true;
  }

  /**
   * Click 2: captures the player tab. Throws with a readable message when
   * the host cancels, picks another tab, or doesn't share the tab's audio.
   */
  async capture(): Promise<void> {
    const controller =
      typeof (globalThis as { CaptureController?: unknown }).CaptureController === "function"
        ? new (globalThis as unknown as { CaptureController: new () => { setFocusBehavior?: (b: string) => void } }).CaptureController()
        : undefined;
    let stream: MediaStream;
    try {
      stream = await this.deps.getDisplayMedia({
        video: { displaySurface: "browser", frameRate: { ideal: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        // The host hears it through the mixer (like any screen-share audio), not twice.
        audio: { suppressLocalAudioPlayback: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        preferCurrentTab: false,
        selfBrowserSurface: "exclude",
        surfaceSwitching: "exclude",
        systemAudio: "exclude",
        monitorTypeSurfaces: "exclude",
        ...(controller ? { controller } : {}),
      });
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === "NotAllowedError") throw new Error("Capture was cancelled. Pick the “StreamLine Media Player” tab to continue.");
      throw new Error("Couldn't capture the player tab. Use Chrome or Edge on a computer.");
    }
    // Keep the host on the room tab instead of jumping to the captured tab.
    try {
      controller?.setFocusBehavior?.("no-focus-change");
    } catch {
      // too late / unsupported
    }
    const video = stream.getVideoTracks()[0] || null;
    const audio = stream.getAudioTracks()[0] || null;
    const wrongTab = () => {
      stream.getTracks().forEach((t) => t.stop());
      return new Error("That's not the player tab. Click “Capture player tab” again and pick “StreamLine Media Player”.");
    };
    if (!video) throw wrongTab();
    // Confirm the host picked THIS player tab: its capture handle when the
    // browser exposes one, otherwise a color the player tab shows on request.
    const handle = (video as unknown as { getCaptureHandle?: () => { handle?: string } | null }).getCaptureHandle?.();
    if (handle) {
      if (handle.handle !== `sl-media-player:${this.ch}`) throw wrongTab();
    } else if (!(await this.showsCheckColor(video))) {
      throw wrongTab();
    }
    if (!audio) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("The tab's sound wasn't shared. Capture again and keep “Also share tab audio” on.");
    }
    this.disconnectTracks();
    this.videoTrack = video;
    this.audioTrack = audio;
    video.addEventListener("ended", () => {
      if (this.videoTrack === video) this.disconnect();
    });
    this.setStatus("connected");
  }

  /** Asks the player tab to show a color and looks for it in the captured picture. */
  private async showsCheckColor(video: MediaStreamTrack): Promise<boolean> {
    const color = CHECK_COLORS[Math.floor(Math.random() * CHECK_COLORS.length)];
    const sampler = this.deps.createSampler(video);
    try {
      this.send({ type: "check", color: `rgb(${color.join(",")})` });
      const deadline = Date.now() + this.deps.verifyTimeoutMs;
      while (Date.now() < deadline) {
        const seen = await sampler.sample();
        if (seen && colorClose(seen, color)) return true;
        await new Promise((r) => setTimeout(r, 150));
      }
      return false;
    } finally {
      sampler.close();
      this.send({ type: "check-done" });
    }
  }

  /** Loads a video and resolves with its title once it's actually playing. */
  load(videoId: string, loop: boolean): Promise<string> {
    if (this.status !== "connected") return Promise.reject(new Error("The YouTube player isn't connected."));
    this.cancelPendingLoad("replaced");
    const req = ++this.reqSeq;
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingLoad?.req !== req) return;
        this.pendingLoad = null;
        reject(new Error(youTubeErrorMessage("timeout")));
      }, this.deps.loadTimeoutMs);
      this.pendingLoad = { req, resolve, reject, timer };
      this.send({ type: "load", req, videoId, loop });
    });
  }

  play(): void {
    this.send({ type: "play" });
  }
  pause(): void {
    this.send({ type: "pause" });
  }
  seek(t: number): void {
    this.send({ type: "seek", t });
  }
  setLoop(on: boolean): void {
    this.send({ type: "loop", on });
  }
  stop(): void {
    this.cancelPendingLoad("stopped");
    if (this.channel) this.send({ type: "stop" });
  }

  /** Forget the captured tab (tracks stop); the player tab itself stays open. */
  disconnect(): void {
    const wasConnected = this.status === "connected";
    this.cancelPendingLoad("disconnected");
    this.disconnectTracks();
    this.setStatus(this.channel ? "ready" : "none");
    if (wasConnected) this.events.onDisconnected?.();
  }

  private disconnectTracks() {
    this.videoTrack?.stop();
    this.audioTrack?.stop();
    this.videoTrack = null;
    this.audioTrack = null;
  }

  private cancelPendingLoad(reason: string) {
    const p = this.pendingLoad;
    if (!p) return;
    this.pendingLoad = null;
    clearTimeout(p.timer);
    p.reject(new Error(reason));
  }

  private onMessage(m: RoomMessage) {
    if (!m || m.to !== "room") return;
    switch (m.type) {
      case "ready":
        if (this.status === "none" || this.status === "opening") this.setStatus("ready");
        break;
      case "playing": {
        const p = this.pendingLoad;
        if (p && p.req === m.req) {
          this.pendingLoad = null;
          clearTimeout(p.timer);
          p.resolve(typeof m.title === "string" ? m.title : "");
        }
        if (typeof m.d === "number") this.events.onTime?.(0, m.d);
        break;
      }
      case "state":
        this.events.onState?.(m.state);
        if (typeof m.t === "number") this.events.onTime?.(m.t, m.d || 0);
        break;
      case "time":
        this.events.onTime?.(m.t || 0, m.d || 0);
        break;
      case "error": {
        const p = this.pendingLoad;
        if (p && (m.req === null || m.req === p.req)) {
          this.pendingLoad = null;
          clearTimeout(p.timer);
          p.reject(new Error(youTubeErrorMessage(m.code)));
        } else if (!p) {
          // Error mid-playback: treat like the video ending.
          this.events.onState?.("ended");
        }
        break;
      }
      case "closed":
        this.disconnect();
        this.setStatus("none");
        break;
    }
  }
}
