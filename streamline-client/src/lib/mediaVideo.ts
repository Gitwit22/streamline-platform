/**
 * Video playlist for the in-room Media panel: uploaded / library videos and
 * YouTube links, played either in the host's own video box (replacing their
 * camera picture) or on stage (as their screen share).
 *
 * How a video reaches the room:
 *  - File videos play in a hidden <video> in this tab. The picture is the
 *    element's captureStream(); two elements alternate so the next video is
 *    ready before the current one stops (a playlist never drops the picture).
 *  - YouTube videos play in the StreamLine Media Player tab, captured once
 *    per show (lib/youtubePlayerLink.ts); each play publishes a clone of that
 *    capture.
 *  - Sound goes through Web Audio (per-video volume) into one track for the
 *    whole session.
 *  - lib/mediaOutputs.ts (via MediaVideoBridge) publishes picture + sound to
 *    the box or the stage, and restores the camera / name tile afterwards.
 *
 * Play modes: once · loop (repeat the video) · next (continue down the
 * playlist) · nextLoop (continue, then start over).
 *
 * Play/stop run one at a time (`exclusive`), so quick clicks can't publish
 * twice; a newer request makes an older start give up at its next step.
 *
 * Persistence: uploaded files go to the content library and the playlist
 * (order, names, volumes, play mode, YouTube ids) is saved per account
 * (server: routes/mediaVideos.ts). The deck lives for the whole tab; leaving
 * the room ends playback.
 */

import type { AudioMixer } from "./audioMixer";
import type { DeckSaveState } from "./audioDeck";
import type { OutputHandle, PlayTarget, PublishCapabilities } from "./mediaOutputs";
import type { PlayerEvents, PlayerLinkStatus } from "./youtubePlayerLink";
import { YouTubePlayerLink } from "./youtubePlayerLink";
import { fetchYouTubeTitle, parseYouTubeId } from "./youtube";

export type { PlayTarget, PublishCapabilities } from "./mediaOutputs";

export type VideoKind = "file" | "youtube";

export type VideoItem = {
  id: string;
  kind: VideoKind;
  name: string;
  /** 0–1, applied to the video's sound. */
  volume: number;
  assetId: string | null;
  youtubeId: string | null;
  /** Playable URL for files (blob: for local files, signed URL for library files). */
  url: string | null;
  saveState: DeckSaveState;
  saveError?: string;
  uploadPct?: number;
};

export type PlayMode = "once" | "loop" | "next" | "nextLoop";
export const PLAY_MODES: readonly PlayMode[] = ["once", "loop", "next", "nextLoop"];

/** off: nothing playing · starting: loading/publishing · live: playing in the box or on stage. */
export type PlayStatus = "off" | "starting" | "live";

export type VideoDeckState = {
  loaded: boolean;
  /** List couldn't be loaded: changes aren't saved this session. */
  persistError: string | null;
  videos: VideoItem[];
  currentId: string | null;
  target: PlayTarget | null;
  status: PlayStatus;
  playing: boolean;
  position: number;
  duration: number;
  playMode: PlayMode;
  error: string | null;
  /** Non-error information for the host (e.g. sound not allowed). */
  notice: string | null;
  /** The picture being sent (panel preview); null when off. */
  preview: MediaStream | null;
  /** A LiveKit room is attached (MediaVideoBridge is mounted). */
  attached: boolean;
  caps: PublishCapabilities;
  player: PlayerLinkStatus;
};

export type SavedVideoItem = { assetId?: string; youtubeId?: string; name: string; volume: number };
export type SavedVideos = { videos: SavedVideoItem[]; playMode: PlayMode };

export interface VideoPersistence {
  load(): Promise<{ layout: SavedVideos; assets: Record<string, { url: string }>; missing: string[] }>;
  save(layout: SavedVideos): Promise<void>;
  upload(file: File, onProgress: (pct: number) => void): Promise<{ assetId: string; url: string }>;
  /** Fresh playable URL (signed URLs expire), or null when gone. */
  resolveUrl(assetId: string): Promise<string | null>;
}

/** Puts tracks into the room (implemented by MediaVideoBridge with lib/mediaOutputs.ts). */
export interface StagePublisher {
  capabilities(): PublishCapabilities;
  /** True while the local participant shares their screen. */
  isScreenSharing(): boolean;
  publish(target: PlayTarget, video: MediaStreamTrack, audio: MediaStreamTrack | null, onStopped: () => void): Promise<OutputHandle>;
}

/** The parts of YouTubePlayerLink the deck uses (a fake in tests). */
export type PlayerLinkLike = Pick<
  YouTubePlayerLink,
  "status" | "videoTrack" | "audioTrack" | "setEvents" | "open" | "capture" | "load" | "play" | "pause" | "seek" | "setLoop" | "stop" | "disconnect"
>;

type MixerLike = Pick<AudioMixer, "init" | "resume" | "getAudioContext">;

export const VIDEO_LIMITS = { videos: 30 } as const;
const NO_CAPS: PublishCapabilities = { stage: false, box: false, sound: false };
const DEFAULT_YOUTUBE_NAME = "YouTube video";

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

/**
 * The item to play after `currentId` in a playlist mode; null to stop.
 * Skips items that can't play (files without a URL).
 */
export function nextVideo(videos: VideoItem[], currentId: string, wrap: boolean): VideoItem | null {
  const playable = (v: VideoItem) => (v.kind === "youtube" ? !!v.youtubeId : !!v.url);
  const i = videos.findIndex((v) => v.id === currentId);
  if (i < 0) return null;
  const n = videos.length;
  for (let step = 1; step <= n; step++) {
    const j = i + step;
    if (j >= n && !wrap) return null;
    const v = videos[j % n];
    if (playable(v)) return v;
  }
  return null;
}

/** The element's picture as a stream (captureStream; Firefox: mozCaptureStream). Null when unsupported. */
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

function setMotionHint(t: MediaStreamTrack) {
  try {
    t.contentHint = "motion";
  } catch {
    // read-only in some browsers
  }
}

function errMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

let seq = 0;
function newId(): string {
  seq += 1;
  return `vid_${Date.now().toString(36)}_${seq}`;
}

const SAVE_DEBOUNCE_MS = 400;
const TRACK_WAIT_MS = 2000;

type Slot = { el: HTMLVideoElement; gain: GainNode };
type Graph = { ctx: AudioContext; slots: [Slot, Slot]; yt: { track: MediaStreamTrack; gain: GainNode } | null };
type Source =
  | { kind: "file"; itemId: string; slot: Slot; video: MediaStreamTrack }
  | { kind: "youtube"; itemId: string; video: MediaStreamTrack };
/** src on success; otherwise error (null = gave up quietly because a newer request took over). */
type Started = { src: Source | null; error: string | null };

export type VideoDeckDeps = {
  createVideo?: () => HTMLVideoElement;
  mountElement?: (el: HTMLVideoElement) => void;
  captureStream?: (el: HTMLVideoElement) => MediaStream | null;
  createObjectUrl?: (f: File) => string;
  revokeObjectUrl?: (u: string) => void;
  player?: PlayerLinkLike;
  fetchTitle?: (youtubeId: string) => Promise<string | null>;
};

export class VideoDeck {
  private state: VideoDeckState = {
    loaded: false,
    persistError: null,
    videos: [],
    currentId: null,
    target: null,
    status: "off",
    playing: false,
    position: 0,
    duration: 0,
    playMode: "once",
    error: null,
    notice: null,
    preview: null,
    attached: false,
    caps: NO_CAPS,
    player: "none",
  };
  private listeners = new Set<(s: VideoDeckState) => void>();

  private publisher: StagePublisher | null = null;
  private handle: OutputHandle | null = null;
  private sessionTarget: PlayTarget | null = null;
  private sessionSeq = 0;
  private sessionId = 0;
  private active: Source | null = null;
  /** Bumped by every play/stop request; an older start gives up when it changes. */
  private op = 0;
  private chain: Promise<unknown> = Promise.resolve();

  private graph: Graph | null = null;
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
  private fetchTitle: (youtubeId: string) => Promise<string | null>;
  readonly player: PlayerLinkLike;

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
    this.fetchTitle = deps.fetchTitle ?? ((id) => fetchYouTubeTitle(id));
    this.player = deps.player ?? new YouTubePlayerLink();
    const events: PlayerEvents = {
      onStatus: (s) => this.set({ player: s }),
      onState: (s) => this.onPlayerState(s),
      onTime: (t, d) => {
        if (this.active?.kind === "youtube") this.set({ position: t, duration: d || this.state.duration });
      },
      onDisconnected: () => {
        if (this.active?.kind === "youtube" || this.state.status === "starting") {
          void this.stop().then(() => this.set({ error: "The YouTube player tab was closed or stopped sharing." }));
        }
      },
    };
    this.player.setEvents(events);
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
    this.set({ attached: true, caps: p.capabilities() });
  }

  /** Permissions changed (promoted, demoted, host controls). */
  refreshCapabilities(): void {
    if (this.publisher) this.set({ caps: this.publisher.capabilities() });
  }

  /** Leaving the room: end playback and forget the room. */
  detachPublisher(p: StagePublisher): void {
    if (this.publisher !== p) return;
    void this.stop();
    this.publisher = null;
    this.set({ attached: false, caps: NO_CAPS });
  }

  // -------------------------------------------------------------------------
  // YouTube player tab
  // -------------------------------------------------------------------------

  /** Click 1: open the player tab. */
  openPlayer(): void {
    if (!this.player.open()) {
      this.set({ error: "Your browser blocked the player tab. Allow pop-ups for this site, then try again." });
    } else {
      this.set({ error: null });
    }
  }

  /** Click 2: capture the player tab. */
  async capturePlayer(): Promise<void> {
    try {
      await this.player.capture();
      this.set({ error: null });
    } catch (e) {
      this.set({ error: errMessage(e, "Couldn't capture the player tab.") });
    }
  }

  disconnectPlayer(): void {
    this.player.disconnect();
  }

  // -------------------------------------------------------------------------
  // Persistence (same rules as the audio deck)
  // -------------------------------------------------------------------------

  /** Loads the saved playlist once per tab. Safe to call repeatedly. */
  ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          const { layout, assets, missing } = await this.persistence.load();
          const missingSet = new Set(missing);
          const saved: VideoItem[] = layout.videos.map((x) =>
            x.youtubeId
              ? {
                  id: newId(),
                  kind: "youtube",
                  name: x.name,
                  volume: x.volume,
                  assetId: null,
                  youtubeId: x.youtubeId,
                  url: null,
                  saveState: "saved",
                }
              : {
                  id: newId(),
                  kind: "file",
                  name: x.name,
                  volume: x.volume,
                  assetId: x.assetId || null,
                  youtubeId: null,
                  url: (x.assetId && assets[x.assetId]?.url) || null,
                  saveState: !x.assetId || missingSet.has(x.assetId) || !assets[x.assetId]?.url ? "missing" : "saved",
                },
          );
          // Anything added before the load finished stays, after the saved items.
          const addedEarly = this.state.videos.length > 0;
          this.set({ loaded: true, persistError: null, videos: [...saved, ...this.state.videos], playMode: layout.playMode });
          if (addedEarly) this.scheduleSave();
        } catch {
          this.set({ loaded: true, persistError: "Couldn't load your saved videos. Changes in this session won't be saved." });
        }
      })();
    }
    return this.loadPromise;
  }

  private layout(): SavedVideos {
    // "missing" files stay saved: a lookup can fail transiently. Only remove() drops them.
    const videos: SavedVideoItem[] = [];
    for (const it of this.state.videos) {
      if (it.kind === "youtube" && it.youtubeId) {
        videos.push({ youtubeId: it.youtubeId, name: it.name, volume: it.volume });
      } else if (it.assetId && (it.saveState === "saved" || it.saveState === "missing")) {
        videos.push({ assetId: it.assetId, name: it.name, volume: it.volume });
      }
    }
    return { videos, playMode: this.state.playMode };
  }

  private scheduleSave() {
    // Never save before the saved list was loaded: that would overwrite it.
    if (!this.state.loaded || this.state.persistError) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persistence.save(this.layout()).catch(() => {
        this.set({ error: "Couldn't save your video playlist. Your last change may not be kept." });
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
      return {
        id,
        kind: "file",
        name: videoNameFromFile(f.name),
        volume: 1,
        assetId: null,
        youtubeId: null,
        url,
        saveState: "saving",
        uploadPct: 0,
      };
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
      this.updateItem(id, { saveState: "failed", uploadPct: undefined, saveError: errMessage(e, "Upload failed") });
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
      kind: "file",
      name: (asset.name || "Video").slice(0, 80),
      volume: 1,
      assetId: asset.id,
      youtubeId: null,
      url: asset.url,
      saveState: "saved",
    };
    this.set({ videos: [...this.state.videos, item] });
    this.scheduleSave();
    return true;
  }

  /** Adds a YouTube link (or id). Returns an error message, or null when added. */
  addYouTube(input: string): string | null {
    const youtubeId = parseYouTubeId(input);
    if (!youtubeId) return "That isn't a YouTube video link.";
    if (this.state.videos.length >= VIDEO_LIMITS.videos) return "The playlist is full.";
    const id = newId();
    this.set({
      videos: [
        ...this.state.videos,
        { id, kind: "youtube", name: DEFAULT_YOUTUBE_NAME, volume: 1, assetId: null, youtubeId, url: null, saveState: "saved" },
      ],
    });
    this.scheduleSave();
    void this.fetchTitle(youtubeId).then((title) => {
      const it = this.find(id);
      if (title && it && it.name === DEFAULT_YOUTUBE_NAME) {
        this.updateItem(id, { name: title });
        this.scheduleSave();
      }
    });
    return null;
  }

  /** Removes from the playlist only; library files are kept. */
  remove(id: string): void {
    const item = this.find(id);
    if (!item) return;
    if (this.active?.itemId === id || (this.state.currentId === id && this.state.status !== "off")) void this.stop();
    const blob = this.blobUrls.get(id);
    if (blob) this.revokeObjectUrl(blob);
    this.blobUrls.delete(id);
    this.files.delete(id);
    this.set({ videos: this.state.videos.filter((x) => x.id !== id) });
    if (item.assetId || item.youtubeId) this.scheduleSave();
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
    if (this.active?.itemId === id) this.applyVolume(this.active, v);
    this.scheduleSave();
  }

  setPlayMode(mode: PlayMode): void {
    if (!PLAY_MODES.includes(mode)) return;
    this.set({ playMode: mode });
    const loop = mode === "loop";
    if (this.active?.kind === "file") this.active.slot.el.loop = loop;
    if (this.active?.kind === "youtube") this.player.setLoop(loop);
    this.scheduleSave();
  }

  // -------------------------------------------------------------------------
  // Audio graph
  // -------------------------------------------------------------------------

  /** Two hidden players + their volume nodes, in the mixer's AudioContext (needs a user gesture first time). */
  private ensureGraph(): Graph | null {
    this.mixer.init();
    void this.mixer.resume();
    const ctx = this.mixer.getAudioContext();
    if (!ctx) return null;
    if (this.graph && this.graph.ctx === ctx) return this.graph;
    // An element can only be wired into one AudioContext: rebuild if the context changed.
    if (this.graph) {
      for (const s of this.graph.slots) {
        s.el.pause();
        s.el.remove();
      }
    }
    const slot = (): Slot => {
      const el = this.createVideo();
      el.crossOrigin = "anonymous";
      el.preload = "auto";
      el.playsInline = true;
      this.mountElement(el);
      const gain = ctx.createGain();
      ctx.createMediaElementSource(el).connect(gain);
      const s: Slot = { el, gain };
      el.addEventListener("timeupdate", () => {
        if (this.isActiveSlot(s)) this.set({ position: el.currentTime || 0 });
      });
      el.addEventListener("durationchange", () => {
        if (this.isActiveSlot(s)) this.set({ duration: Number.isFinite(el.duration) ? el.duration : 0 });
      });
      el.addEventListener("ended", () => {
        if (this.isActiveSlot(s)) this.onSourceEnded(null);
      });
      el.addEventListener("error", () => {
        if (!this.isActiveSlot(s)) return; // load failures while starting are handled by play()
        const item = this.find(this.active!.itemId);
        this.onSourceEnded(item ? `“${item.name}” stopped: the file couldn't be played.` : "The video stopped.");
      });
      el.addEventListener("pause", () => {
        if (this.isActiveSlot(s) && this.state.status === "live") this.set({ playing: false });
      });
      el.addEventListener("play", () => {
        if (this.isActiveSlot(s) && this.state.status === "live") this.set({ playing: true });
      });
      return s;
    };
    this.graph = { ctx, slots: [slot(), slot()], yt: null };
    this.dest = null;
    return this.graph;
  }

  private isActiveSlot(s: Slot): boolean {
    return this.active?.kind === "file" && this.active.slot === s;
  }

  /** The player tab's sound, wired through its own volume node. */
  private ensureYouTubeAudio(graph: Graph): GainNode | null {
    const track = this.player.audioTrack;
    if (!track) return null;
    if (graph.yt && graph.yt.track === track) return graph.yt.gain;
    try {
      graph.yt?.gain.disconnect();
    } catch {
      // not connected
    }
    const gain = graph.ctx.createGain();
    graph.ctx.createMediaStreamSource(new MediaStream([track])).connect(gain);
    graph.yt = { track, gain };
    if (this.dest) gain.connect(this.dest);
    return gain;
  }

  /** One sound track for the whole session (all sources feed it). */
  private ensureDest(graph: Graph): MediaStreamAudioDestinationNode {
    if (this.dest) return this.dest;
    const dest = graph.ctx.createMediaStreamDestination();
    for (const s of graph.slots) s.gain.connect(dest);
    graph.yt?.gain.connect(dest);
    this.dest = dest;
    return dest;
  }

  private dropDest() {
    const dest = this.dest;
    if (!dest || !this.graph) return;
    for (const node of [...this.graph.slots.map((s) => s.gain), this.graph.yt?.gain]) {
      try {
        node?.disconnect(dest);
      } catch {
        // not connected
      }
    }
    dest.stream.getTracks().forEach((t) => t.stop());
    this.dest = null;
  }

  private applyVolume(src: Source, v: number) {
    if (src.kind === "file") src.slot.gain.gain.value = v;
    else if (this.graph?.yt) this.graph.yt.gain.gain.value = v;
  }

  // -------------------------------------------------------------------------
  // Playback
  // -------------------------------------------------------------------------

  /** Runs play/stop one at a time. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Plays `id` in the host's video box or on stage (switching from whatever is playing). */
  play(id: string, target: PlayTarget): Promise<void> {
    const op = ++this.op;
    return this.exclusive(() => this.playNow(id, target, op));
  }

  /** Ends playback: the box goes back to the camera / name tile, the stage share is removed. */
  stop(): Promise<void> {
    ++this.op;
    // Make a start in progress give up now instead of after its timeout.
    if (this.state.status === "starting") this.player.stop();
    for (const s of this.graph?.slots ?? []) {
      if (!this.isActiveSlot(s)) s.el.pause();
    }
    return this.exclusive(() => this.endSession(this.state.error));
  }

  private fail(error: string) {
    this.set({ error });
  }

  private async playNow(id: string, target: PlayTarget, op: number): Promise<void> {
    const stale = () => op !== this.op;
    if (stale()) return;
    const item = this.find(id);
    if (!item) return;
    const pub = this.publisher;
    if (!pub) return this.fail("Join the room to play videos.");
    const caps = pub.capabilities();
    this.set({ caps });
    if (!caps.stage && !caps.box) {
      return this.fail("You can't send video from this room (invisible hosts and audience members can't publish).");
    }
    if (target === "stage" && !caps.stage) return this.fail("Your role can't put videos on stage. Play it in your video box instead.");
    if (target === "box" && !caps.box) return this.fail("Your role can't send video.");
    if (item.kind === "file" && !item.url) {
      return this.fail(`“${item.name}” isn't available. It may have been deleted from your library.`);
    }
    if (item.kind === "youtube" && this.player.status !== "connected") {
      return this.fail("Connect the YouTube player first (Open player tab, then Capture player tab).");
    }

    // Switching between box and stage: end the current session first.
    if (this.handle && this.sessionTarget !== target) {
      await this.endSession(null);
      if (stale()) return;
    }
    if (!this.handle && target === "stage" && pub.isScreenSharing()) {
      return this.fail("Stop your screen share first, or play the video in your video box.");
    }
    const graph = this.ensureGraph();
    if (!graph) return this.fail("Audio isn't ready yet. Try again.");

    const switching = !!this.handle;
    this.set({
      currentId: id,
      target,
      status: "starting",
      error: null,
      position: 0,
      duration: 0,
      ...(switching ? {} : { preview: null, notice: null, playing: false }),
    });

    const started = await this.startSource(item, graph, stale);
    if (stale()) {
      if (started.src) this.disposeSource(started.src, this.active);
      return;
    }
    if (!started.src) {
      const prev = this.active;
      // Keep the video that was already playing, unless it was a YouTube
      // video and this one was too: the player tab has already left it.
      if (this.handle && prev && !(prev.kind === "youtube" && item.kind === "youtube")) {
        this.set({ status: "live", currentId: prev.itemId, error: started.error });
      } else {
        await this.endSession(started.error);
      }
      return;
    }
    const src = started.src;

    if (this.handle) {
      // Playlist / switch: swap the picture without leaving the box or stage.
      try {
        await this.handle.replaceVideo(src.video);
      } catch (e) {
        this.disposeSource(src, this.active);
        await this.endSession(errMessage(e, "Couldn't switch videos."));
        return;
      }
      const prev = this.active;
      this.active = src;
      this.disposeSource(prev, src);
    } else {
      const dest = this.ensureDest(graph);
      const sessionId = ++this.sessionSeq;
      let handle: OutputHandle;
      try {
        handle = await pub.publish(target, src.video, dest.stream.getAudioTracks()[0] || null, () => this.onStoppedElsewhere(sessionId));
      } catch (e) {
        this.disposeSource(src, null);
        await this.endSession(`Couldn't play the video (${errMessage(e, "unknown error")}).`);
        return;
      }
      this.handle = handle;
      this.sessionTarget = target;
      this.sessionId = sessionId;
      this.active = src;
    }
    if (stale()) return; // a newer request is queued and takes over from here
    const preview = typeof MediaStream !== "undefined" ? new MediaStream([src.video]) : null;
    this.set({ status: "live", currentId: id, playing: true, preview, notice: this.handle?.notice ?? null, error: null });
  }

  private async startSource(item: VideoItem, graph: Graph, stale: () => boolean): Promise<Started> {
    const loop = this.state.playMode === "loop";
    if (item.kind === "youtube") {
      const gain = this.ensureYouTubeAudio(graph);
      if (gain) gain.gain.value = item.volume;
      let title = "";
      try {
        title = await this.player.load(item.youtubeId!, loop);
      } catch (e) {
        return { src: null, error: stale() ? null : errMessage(e, "YouTube couldn't play this video.") };
      }
      const base = this.player.videoTrack;
      if (!base || base.readyState !== "live") return { src: null, error: "The YouTube player was disconnected." };
      if (title && item.name === DEFAULT_YOUTUBE_NAME) {
        this.updateItem(item.id, { name: title.slice(0, 80) });
        this.scheduleSave();
      }
      // A clone: ending this session must not end the captured tab.
      const video = base.clone();
      setMotionHint(video);
      return { error: null, src: { kind: "youtube", itemId: item.id, video } };
    }

    // File: use the element that isn't on air, so the current picture stays until the swap.
    const slot = graph.slots.find((s) => !this.isActiveSlot(s)) ?? graph.slots[0];
    slot.gain.gain.value = item.volume;
    slot.el.loop = loop;
    let result = await this.tryPlay(slot.el, item.url!);
    if (stale()) return { src: null, error: null };
    if (result === "failed" && item.assetId && !this.blobUrls.has(item.id)) {
      const fresh = await this.persistence.resolveUrl(item.assetId).catch(() => null);
      if (stale()) return { src: null, error: null };
      if (fresh) {
        this.updateItem(item.id, { url: fresh });
        result = await this.tryPlay(slot.el, fresh);
        if (stale()) return { src: null, error: null };
      }
    }
    if (result !== "ok") {
      this.releaseSlot(slot);
      return {
        src: null,
        error:
          result === "blocked"
            ? "Your browser blocked playback. Click play again to start the video."
            : `Couldn't play “${item.name}”. The file may be unsupported or unavailable.`,
      };
    }
    const captured = this.captureStream(slot.el);
    const video = captured ? await waitForVideoTrack(captured, TRACK_WAIT_MS) : null;
    if (!video || stale()) {
      video?.stop();
      this.releaseSlot(slot);
      if (stale()) return { src: null, error: null };
      return {
        src: null,
        error: captured ? `“${item.name}” has no picture to show.` : "This browser can't send a video. Use Chrome, Edge or Firefox.",
      };
    }
    setMotionHint(video);
    return { error: null, src: { kind: "file", itemId: item.id, slot, video } };
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

  private releaseSlot(slot: Slot) {
    slot.el.pause();
    // Release the file so the browser stops buffering it.
    slot.el.removeAttribute("src");
    try {
      slot.el.load();
    } catch {
      // ignore
    }
  }

  /** Stops a source that is no longer on air (`next` is what replaced it, if anything). */
  private disposeSource(src: Source | null, next: Source | null) {
    if (!src) return;
    src.video.stop();
    if (src.kind === "file") {
      if (!(next?.kind === "file" && next.slot === src.slot)) this.releaseSlot(src.slot);
    } else if (next?.kind !== "youtube") {
      this.player.stop();
    }
  }

  private async endSession(error: string | null): Promise<void> {
    const handle = this.handle;
    const active = this.active;
    this.handle = null;
    this.active = null;
    this.sessionTarget = null;
    // Restore the box / remove the share first, then stop our tracks: an
    // ended track still in the camera tile would read as "camera off".
    if (handle) {
      try {
        await handle.release();
      } catch {
        // the room may already be gone
      }
    }
    this.disposeSource(active, null);
    if (!active && this.player.status === "connected") this.player.stop();
    for (const s of this.graph?.slots ?? []) this.releaseSlot(s);
    this.dropDest();
    this.set({ status: "off", target: null, playing: false, currentId: null, position: 0, duration: 0, preview: null, notice: null, error });
  }

  /** Pause / resume (the picture holds its last frame while paused). */
  togglePause(): void {
    const src = this.active;
    if (!src || this.state.status !== "live") return;
    if (src.kind === "youtube") {
      if (this.state.playing) this.player.pause();
      else this.player.play();
      this.set({ playing: !this.state.playing });
      return;
    }
    const el = src.slot.el;
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
    const src = this.active;
    if (!src || this.state.status !== "live") return;
    const max = this.state.duration || seconds;
    const t = Math.max(0, Math.min(max, seconds));
    if (src.kind === "youtube") this.player.seek(t);
    else src.slot.el.currentTime = t;
    this.set({ position: t });
  }

  private onPlayerState(s: "playing" | "paused" | "ended") {
    if (this.active?.kind !== "youtube" || this.state.status !== "live") return;
    if (s === "ended") this.onSourceEnded(null);
    else this.set({ playing: s === "playing" });
  }

  /** The video on air finished (or failed): continue the playlist or stop. */
  private onSourceEnded(error: string | null) {
    const target = this.sessionTarget;
    const cur = this.active?.itemId;
    if (!target || !cur) return;
    const mode = this.state.playMode;
    const next = mode === "next" || mode === "nextLoop" ? nextVideo(this.state.videos, cur, mode === "nextLoop") : null;
    if (!next || (mode === "loop" && !error)) {
      // "loop" repeats inside the player; reaching here means it couldn't.
      void this.stop().then(() => {
        if (error) this.set({ error });
      });
      return;
    }
    if (next.kind === "youtube" && this.player.status !== "connected") {
      void this.stop().then(() =>
        this.set({ error: `Up next is “${next.name}” on YouTube: connect the YouTube player to keep the playlist going.` }),
      );
      return;
    }
    if (error) this.set({ error });
    void this.play(next.id, target);
  }

  /** Our output was removed by something else (camera button, control bar, host controls, disconnect). */
  private onStoppedElsewhere(sessionId: number) {
    if (sessionId !== this.sessionId) return;
    void this.stop();
  }
}
