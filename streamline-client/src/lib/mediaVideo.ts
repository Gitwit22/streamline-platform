/**
 * Stage videos for the in-room Media panel: the host picks a video and it
 * plays "on stage" for guests and every output.
 *
 * How it reaches the stream: the video plays in a hidden <video> element in
 * the host's tab. Its picture (element captureStream) and its sound (Web
 * Audio, through a per-video volume) are published into the LiveKit room as
 * the host's screen share (Track.Source.ScreenShare / ScreenShareAudio,
 * via MediaVideoBridge). Everything that already handles a screen share then
 * handles the video: the in-room program stage, layouts, the program
 * compositor (RTMP destinations, HLS, recordings) and guests. The host hears
 * it through the mixer's Screen share channel (MixerBridge), like any
 * screen-share audio.
 *
 * One stage video at a time, and not while the host shares their screen.
 * The deck lives for the whole tab (like lib/audioDeck.ts), so playback
 * survives closing the panel; leaving the room takes the video off stage.
 *
 * Persistence: added files are uploaded to the content library and the list
 * (order, names, volumes, loop) is saved per account (server:
 * routes/mediaVideos.ts). An item that couldn't be uploaded stays playable
 * this session and is marked "not saved".
 */

import type { AudioMixer } from "./audioMixer";
import type { DeckSaveState } from "./audioDeck";

export type VideoItem = {
  id: string;
  name: string;
  /** 0–1, applied to the video's sound. */
  volume: number;
  assetId: string | null;
  /** Playable URL (blob: for local files, signed URL for library files). */
  url: string | null;
  saveState: DeckSaveState;
  saveError?: string;
  uploadPct?: number;
};

/** off: nothing on stage · starting: loading/publishing · live: on stage. */
export type StageStatus = "off" | "starting" | "live";

export type VideoDeckState = {
  loaded: boolean;
  /** List couldn't be loaded: changes aren't saved this session. */
  persistError: string | null;
  videos: VideoItem[];
  /** The video on stage (or starting). */
  currentId: string | null;
  stage: StageStatus;
  playing: boolean;
  position: number;
  duration: number;
  loop: boolean;
  error: string | null;
  /** The picture being published (for the panel's preview); null when off stage. */
  preview: MediaStream | null;
  /** A LiveKit room is attached (MediaVideoBridge is mounted). */
  canPublish: boolean;
};

export type SavedVideos = {
  videos: Array<{ assetId: string; name: string; volume: number }>;
  loop: boolean;
};

export interface VideoPersistence {
  load(): Promise<{ layout: SavedVideos; assets: Record<string, { url: string }>; missing: string[] }>;
  save(layout: SavedVideos): Promise<void>;
  upload(file: File, onProgress: (pct: number) => void): Promise<{ assetId: string; url: string }>;
  /** Fresh playable URL (signed URLs expire), or null when gone. */
  resolveUrl(assetId: string): Promise<string | null>;
}

/** Tracks one stage video published into the room. */
export interface StageHandle {
  /** Removes exactly these tracks from the room (idempotent). */
  unpublish(): Promise<void>;
}

/** Puts tracks on stage in the LiveKit room (implemented by MediaVideoBridge). */
export interface StagePublisher {
  /** True while the local participant shares their screen. */
  isScreenSharing(): boolean;
  /**
   * Publishes the picture as the screen share and the sound as screen-share
   * audio. `onStopped` runs if something else removes them (e.g. the control
   * bar's "Stop sharing", or host controls forbidding screen share).
   */
  publish(video: MediaStreamTrack, audio: MediaStreamTrack | null, onStopped: () => void): Promise<StageHandle>;
}

type MixerLike = Pick<AudioMixer, "init" | "resume" | "getAudioContext">;

export const VIDEO_LIMITS = { videos: 20 } as const;

const VIDEO_EXT = /\.(mp4|m4v|webm|mov|ogv|mkv)$/i;

/** Video files only (by MIME type, or extension when the browser gives none). */
export function isVideoFile(f: { type: string; name: string }): boolean {
  if (f.type) return f.type.startsWith("video/");
  return VIDEO_EXT.test(f.name);
}

/** Display name from a file name ("01 - Intro.mp4" -> "01 - Intro"). */
export function videoNameFromFile(name: string): string {
  const base = name.replace(/\.[^/.]+$/, "").trim();
  return (base || "Video").slice(0, 80);
}

/** The element's picture as a track (captureStream; Firefox: mozCaptureStream). Null when unsupported. */
function captureStreamOf(el: HTMLVideoElement): MediaStream | null {
  const anyEl = el as HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream };
  const fn = anyEl.captureStream || anyEl.mozCaptureStream;
  if (typeof fn !== "function") return null;
  try {
    return fn.call(el);
  } catch {
    return null;
  }
}

/** Resolves with the stream's first video track, waiting briefly for it to appear. */
function waitForVideoTrack(stream: MediaStream, timeoutMs: number): Promise<MediaStreamTrack | null> {
  const now = stream.getVideoTracks()[0];
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = (t: MediaStreamTrack | null) => {
      clearTimeout(timer);
      stream.removeEventListener("addtrack", onAdd);
      resolve(t);
    };
    const onAdd = () => {
      const t = stream.getVideoTracks()[0];
      if (t) done(t);
    };
    const timer = setTimeout(() => done(stream.getVideoTracks()[0] || null), timeoutMs);
    stream.addEventListener("addtrack", onAdd);
  });
}

function mountHidden(el: HTMLVideoElement): void {
  // In the document and inside the viewport: some browsers stop decoding
  // detached or off-screen video. Invisible and click-through.
  el.setAttribute("aria-hidden", "true");
  el.dataset.slStageVideo = "true";
  Object.assign(el.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "2px",
    height: "2px",
    opacity: "0",
    pointerEvents: "none",
    zIndex: "-1",
  });
  document.body.appendChild(el);
}

let seq = 0;
function newId(): string {
  seq += 1;
  return `vid_${Date.now().toString(36)}_${seq}`;
}

const SAVE_DEBOUNCE_MS = 400;
const TRACK_WAIT_MS = 2000;

export type VideoDeckDeps = {
  createVideo?: () => HTMLVideoElement;
  mountElement?: (el: HTMLVideoElement) => void;
  captureStream?: (el: HTMLVideoElement) => MediaStream | null;
  createObjectUrl?: (f: File) => string;
  revokeObjectUrl?: (u: string) => void;
};

export class VideoDeck {
  private state: VideoDeckState = {
    loaded: false,
    persistError: null,
    videos: [],
    currentId: null,
    stage: "off",
    playing: false,
    position: 0,
    duration: 0,
    loop: false,
    error: null,
    preview: null,
    canPublish: false,
  };
  private listeners = new Set<(s: VideoDeckState) => void>();

  private publisher: StagePublisher | null = null;
  private handle: StageHandle | null = null;
  /** Bumped on every start/stop so a slow start can tell it was superseded. */
  private session = 0;

  private el: HTMLVideoElement | null = null;
  private elCtx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;

  private files = new Map<string, File>();
  private blobUrls = new Map<string, string>();
  private loadPromise: Promise<void> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  private createVideo: () => HTMLVideoElement;
  private mountElement: (el: HTMLVideoElement) => void;
  private captureStream: (el: HTMLVideoElement) => MediaStream | null;
  private createObjectUrl: (f: File) => string;
  private revokeObjectUrl: (u: string) => void;

  constructor(
    private mixer: MixerLike,
    private persistence: VideoPersistence,
    deps: VideoDeckDeps = {},
  ) {
    this.createVideo = deps.createVideo ?? (() => document.createElement("video"));
    this.mountElement = deps.mountElement ?? mountHidden;
    this.captureStream = deps.captureStream ?? captureStreamOf;
    this.createObjectUrl = deps.createObjectUrl ?? ((f) => URL.createObjectURL(f));
    this.revokeObjectUrl = deps.revokeObjectUrl ?? ((u) => URL.revokeObjectURL(u));
  }

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  getState(): VideoDeckState {
    return this.state;
  }

  subscribe(fn: (s: VideoDeckState) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private set(patch: Partial<VideoDeckState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  private updateItem(id: string, patch: Partial<VideoItem>) {
    this.set({ videos: this.state.videos.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  }

  private find(id: string): VideoItem | null {
    return this.state.videos.find((x) => x.id === id) || null;
  }

  clearError(): void {
    this.set({ error: null });
  }

  // -------------------------------------------------------------------------
  // Room attachment (MediaVideoBridge)
  // -------------------------------------------------------------------------

  attachPublisher(p: StagePublisher): void {
    this.publisher = p;
    this.set({ canPublish: true });
  }

  /** Leaving the room: take the video off stage and forget the room. */
  detachPublisher(p: StagePublisher): void {
    if (this.publisher !== p) return;
    void this.stop();
    this.publisher = null;
    this.set({ canPublish: false });
  }

  // -------------------------------------------------------------------------
  // Persistence (same rules as the audio deck)
  // -------------------------------------------------------------------------

  /** Loads the saved list once per tab. Safe to call repeatedly. */
  ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          const { layout, assets, missing } = await this.persistence.load();
          const missingSet = new Set(missing);
          const saved: VideoItem[] = layout.videos.map((x) => ({
            id: newId(),
            name: x.name,
            volume: x.volume,
            assetId: x.assetId,
            url: assets[x.assetId]?.url || null,
            saveState: missingSet.has(x.assetId) || !assets[x.assetId]?.url ? "missing" : "saved",
          }));
          // Anything added before the load finished stays, after the saved items.
          const addedEarly = this.state.videos.length > 0;
          this.set({ loaded: true, persistError: null, videos: [...saved, ...this.state.videos], loop: layout.loop });
          if (addedEarly) this.scheduleSave();
        } catch {
          this.set({ loaded: true, persistError: "Couldn't load your saved videos. Changes in this session won't be saved." });
        }
      })();
    }
    return this.loadPromise;
  }

  private layout(): SavedVideos {
    // "missing" items stay saved: a lookup can fail transiently. Only remove() drops them.
    return {
      videos: this.state.videos
        .filter((it) => !!it.assetId && (it.saveState === "saved" || it.saveState === "missing"))
        .map((it) => ({ assetId: it.assetId!, name: it.name, volume: it.volume })),
      loop: this.state.loop,
    };
  }

  private scheduleSave() {
    // Never save before the saved list was loaded: that would overwrite it.
    if (!this.state.loaded || this.state.persistError) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persistence.save(this.layout()).catch(() => {
        this.set({ error: "Couldn't save your video list. Your last change may not be kept." });
      });
    }, SAVE_DEBOUNCE_MS);
  }

  /** Flushes a pending save now (tests / before unload). */
  async flushSave(): Promise<void> {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.state.loaded || this.state.persistError) return;
    await this.persistence.save(this.layout());
  }

  // -------------------------------------------------------------------------
  // Adding / removing
  // -------------------------------------------------------------------------

  /** Adds video files (others are skipped); each uploads to the library. Returns how many were added. */
  addFiles(files: File[]): number {
    const room = VIDEO_LIMITS.videos - this.state.videos.length;
    const videos = files.filter(isVideoFile).slice(0, Math.max(0, room));
    const added: VideoItem[] = videos.map((f) => {
      const id = newId();
      const url = this.createObjectUrl(f);
      this.files.set(id, f);
      this.blobUrls.set(id, url);
      return { id, name: videoNameFromFile(f.name), volume: 1, assetId: null, url, saveState: "saving", uploadPct: 0 };
    });
    if (added.length === 0) return 0;
    this.set({ videos: [...this.state.videos, ...added] });
    for (const it of added) void this.upload(it.id);
    return added.length;
  }

  private async upload(id: string) {
    const file = this.files.get(id);
    if (!file) return;
    this.updateItem(id, { saveState: "saving", saveError: undefined, uploadPct: 0 });
    try {
      const { assetId } = await this.persistence.upload(file, (pct) => this.updateItem(id, { uploadPct: pct }));
      if (!this.find(id)) return; // removed while uploading
      this.files.delete(id);
      // Keep playing from the local copy this session; the library copy is used next time.
      this.updateItem(id, { assetId, saveState: "saved", uploadPct: undefined });
      this.scheduleSave();
    } catch (e) {
      if (!this.find(id)) return;
      this.updateItem(id, {
        saveState: "failed",
        uploadPct: undefined,
        saveError: e instanceof Error && e.message ? e.message : "Upload failed",
      });
    }
  }

  retrySave(id: string): void {
    const item = this.find(id);
    if (item && item.saveState === "failed") void this.upload(id);
  }

  /** Adds an existing content-library video. */
  addFromLibrary(asset: { id: string; name: string; url: string }): boolean {
    if (this.state.videos.length >= VIDEO_LIMITS.videos) return false;
    const item: VideoItem = {
      id: newId(),
      name: (asset.name || "Video").slice(0, 80),
      volume: 1,
      assetId: asset.id,
      url: asset.url,
      saveState: "saved",
    };
    this.set({ videos: [...this.state.videos, item] });
    this.scheduleSave();
    return true;
  }

  /** Removes from the list only; the library file is kept. */
  remove(id: string): void {
    const item = this.find(id);
    if (!item) return;
    if (this.state.currentId === id) void this.stop();
    const blob = this.blobUrls.get(id);
    if (blob) this.revokeObjectUrl(blob);
    this.blobUrls.delete(id);
    this.files.delete(id);
    this.set({ videos: this.state.videos.filter((x) => x.id !== id) });
    if (item.assetId) this.scheduleSave();
  }

  move(id: string, delta: -1 | 1): void {
    const items = [...this.state.videos];
    const i = items.findIndex((x) => x.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    this.set({ videos: items });
    this.scheduleSave();
  }

  setVolume(id: string, volume: number): void {
    if (!this.find(id)) return;
    const v = Math.max(0, Math.min(1, Math.round(volume * 100) / 100));
    this.updateItem(id, { volume: v });
    if (this.state.currentId === id && this.gain) this.gain.gain.value = v;
    this.scheduleSave();
  }

  setLoop(loop: boolean): void {
    this.set({ loop });
    if (this.el) this.el.loop = loop;
    this.scheduleSave();
  }

  // -------------------------------------------------------------------------
  // Stage playback
  // -------------------------------------------------------------------------

  /** The hidden player, its sound wired through a volume node (needs a user gesture first time). */
  private ensureElement(): HTMLVideoElement | null {
    this.mixer.init();
    void this.mixer.resume();
    const ctx = this.mixer.getAudioContext();
    if (!ctx) return null;
    if (this.el && this.elCtx === ctx) return this.el;

    // An element can only be wired into one AudioContext: replace it if the context changed.
    if (this.el) {
      this.el.pause();
      this.el.remove();
    }
    const el = this.createVideo();
    el.crossOrigin = "anonymous";
    el.preload = "auto";
    el.playsInline = true;
    el.addEventListener("timeupdate", () => {
      if (this.state.stage !== "off") this.set({ position: el.currentTime || 0 });
    });
    el.addEventListener("durationchange", () => {
      if (this.state.stage !== "off") this.set({ duration: Number.isFinite(el.duration) ? el.duration : 0 });
    });
    el.addEventListener("ended", () => this.onEnded());
    el.addEventListener("error", () => this.onElementError());
    this.mountElement(el);

    const source = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    source.connect(gain);
    this.el = el;
    this.elCtx = ctx;
    this.gain = gain;
    this.dest = null;
    return el;
  }

  /** Starts playing `id` and puts it on stage (replacing whatever is on stage). */
  async playOnStage(id: string): Promise<void> {
    const item = this.find(id);
    if (!item) return;
    if (!item.url) {
      this.set({ error: `“${item.name}” isn't available. It may have been deleted from your library.` });
      return;
    }
    const publisher = this.publisher;
    if (!publisher) {
      this.set({ error: "Join the room to play videos on stage." });
      return;
    }
    if (this.state.stage !== "off") await this.stop();
    if (publisher.isScreenSharing()) {
      this.set({ error: "Stop your screen share first: a stage video plays in its place." });
      return;
    }
    const el = this.ensureElement();
    const ctx = this.elCtx;
    if (!el || !ctx || !this.gain) {
      this.set({ error: "Audio isn't ready yet. Try again." });
      return;
    }

    const token = ++this.session;
    const stale = () => token !== this.session;
    this.set({ currentId: id, stage: "starting", playing: false, position: 0, duration: 0, error: null, preview: null });
    this.gain.gain.value = item.volume;
    el.loop = this.state.loop;

    // 1) Start playback (one retry with a fresh URL: signed library URLs expire).
    let started = await this.tryPlay(el, item.url);
    if (stale()) return;
    if (started === "failed" && item.assetId && !this.blobUrls.has(id)) {
      const fresh = await this.persistence.resolveUrl(item.assetId).catch(() => null);
      if (stale()) return;
      if (fresh) {
        this.updateItem(id, { url: fresh });
        started = await this.tryPlay(el, fresh);
        if (stale()) return;
      }
    }
    if (started !== "ok") {
      this.resetStage(
        started === "blocked"
          ? "Your browser blocked playback. Click play again to start the video."
          : `Couldn't play “${item.name}”. The file may be unsupported or unavailable.`,
      );
      return;
    }

    // 2) Capture the picture and the sound.
    const captured = this.captureStream(el);
    const video = captured ? await waitForVideoTrack(captured, TRACK_WAIT_MS) : null;
    if (stale()) {
      video?.stop();
      return;
    }
    if (!video) {
      el.pause();
      this.resetStage(
        captured
          ? `“${item.name}” has no picture to show.`
          : "This browser can't put a video on stage. Use Chrome, Edge or Firefox.",
      );
      return;
    }
    try {
      video.contentHint = "motion";
    } catch {
      // read-only in some browsers
    }
    if (this.dest) {
      try {
        this.gain.disconnect(this.dest);
      } catch {
        // already disconnected
      }
    }
    this.dest = ctx.createMediaStreamDestination();
    this.gain.connect(this.dest);
    const audio = this.dest.stream.getAudioTracks()[0] || null;

    // 3) Publish.
    let handle: StageHandle;
    try {
      handle = await publisher.publish(video, audio, () => this.onStoppedElsewhere(token));
    } catch (e) {
      video.stop();
      if (stale()) return;
      el.pause();
      const msg = e instanceof Error && e.message ? e.message : "unknown error";
      this.resetStage(`Couldn't put the video on stage (${msg}).`);
      return;
    }
    if (stale()) {
      void handle.unpublish();
      return;
    }
    this.handle = handle;
    const preview = typeof MediaStream !== "undefined" ? new MediaStream([video]) : null;
    this.set({ stage: "live", playing: !el.paused, preview });
  }

  private async tryPlay(el: HTMLVideoElement, url: string): Promise<"ok" | "blocked" | "failed"> {
    el.src = url;
    try {
      el.currentTime = 0;
    } catch {
      // no source yet
    }
    try {
      await el.play();
      return "ok";
    } catch (e) {
      // NotAllowedError = autoplay blocked until the user interacts.
      if (e instanceof DOMException && e.name === "NotAllowedError") return "blocked";
      return "failed";
    }
  }

  private resetStage(error: string | null) {
    this.set({ stage: "off", playing: false, currentId: null, position: 0, duration: 0, preview: null, error });
  }

  /** Pause / resume the video on stage (the picture holds its last frame while paused). */
  togglePause(): void {
    const el = this.el;
    if (!el || this.state.stage !== "live") return;
    if (el.paused) {
      void this.mixer.resume();
      el.play().then(
        () => this.set({ playing: true, error: null }),
        () => this.set({ playing: false, error: "Couldn't resume the video." }),
      );
    } else {
      el.pause();
      this.set({ playing: false });
    }
  }

  seek(seconds: number): void {
    if (!this.el || this.state.stage === "off") return;
    const max = this.state.duration || seconds;
    const t = Math.max(0, Math.min(max, seconds));
    this.el.currentTime = t;
    this.set({ position: t });
  }

  /** Takes the video off stage and stops playback. */
  async stop(): Promise<void> {
    this.session += 1;
    const handle = this.handle;
    this.handle = null;
    if (this.el) {
      this.el.pause();
      // Release the file so the browser stops buffering it.
      this.el.removeAttribute("src");
      try {
        this.el.load();
      } catch {
        // ignore
      }
    }
    this.resetStage(this.state.error);
    if (handle) {
      try {
        await handle.unpublish();
      } catch {
        // the room may already be gone
      }
    }
  }

  private onEnded() {
    // Only fires without loop: the video is done, so the stage goes back to the cameras.
    if (this.state.stage === "live") void this.stop();
  }

  private onElementError() {
    // Load failures while starting are handled by playOnStage (play() rejects).
    if (this.state.stage !== "live") return;
    const item = this.state.currentId ? this.find(this.state.currentId) : null;
    void this.stop().then(() => this.set({ error: item ? `“${item.name}” stopped: the file couldn't be played.` : "The video stopped." }));
  }

  /** Our tracks were removed by something else (control bar, host controls, disconnect). */
  private onStoppedElsewhere(token: number) {
    if (token !== this.session) return;
    this.handle = null; // already unpublished
    void this.stop();
  }
}
