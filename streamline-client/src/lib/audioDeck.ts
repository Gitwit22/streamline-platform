/**
 * Audio deck: background-music playlist + soundboard pads for the host.
 *
 * Everything plays into the mixer's Music bus (lib/audioMixer.ts), so the
 * Music channel's volume, mute, ducking and "Send mix to stream" apply.
 * The deck lives for the whole tab (not inside a React component), so audio
 * keeps playing when panels close.
 *
 * Persistence: added files are uploaded to the user's content library and
 * the layout (order, names, volumes, loop mode) is saved per account
 * (server: routes/audioDeck.ts). An item that couldn't be uploaded stays
 * playable for this session and is marked "not saved".
 */

import type { AudioMixer } from "./audioMixer";

export type LoopMode = "off" | "one" | "all";
export type DeckList = "playlist" | "pads";

/**
 * saved   – in the content library and in the saved layout
 * saving  – uploading to the content library
 * failed  – upload failed (playable this session only; retry possible)
 * missing – saved layout points at a file that no longer resolves
 */
export type DeckSaveState = "saved" | "saving" | "failed" | "missing";

export type DeckItem = {
  id: string;
  name: string;
  /** 0–1, applied on top of the Music channel. */
  volume: number;
  assetId: string | null;
  /** Playable URL (blob: for local files, signed URL for library files). */
  url: string | null;
  saveState: DeckSaveState;
  saveError?: string;
  uploadPct?: number;
};

export type DeckState = {
  loaded: boolean;
  /** Layout couldn't be loaded: changes aren't saved this session. */
  persistError: string | null;
  playlist: DeckItem[];
  pads: DeckItem[];
  currentId: string | null;
  playing: boolean;
  position: number;
  duration: number;
  loopMode: LoopMode;
  padsPlaying: string[];
  error: string | null;
};

export type SavedLayout = {
  playlist: Array<{ assetId: string; name: string; volume: number }>;
  pads: Array<{ assetId: string; name: string; volume: number }>;
  loopMode: LoopMode;
};

export interface DeckPersistence {
  load(): Promise<{ layout: SavedLayout; assets: Record<string, { url: string }>; missing: string[] }>;
  save(layout: SavedLayout): Promise<void>;
  upload(file: File, onProgress: (pct: number) => void): Promise<{ assetId: string; url: string }>;
  /** Fresh playable URL (signed URLs expire), or null when gone. */
  resolveUrl(assetId: string): Promise<string | null>;
}

type MixerLike = Pick<AudioMixer, "init" | "resume" | "getAudioContext" | "getMusicBusInput">;

export const DECK_LIMITS = { playlist: 50, pads: 24 } as const;

const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm|opus)$/i;

/** Audio files only (by MIME type, or extension when the browser gives none). */
export function isAudioFile(f: { type: string; name: string }): boolean {
  if (f.type) return f.type.startsWith("audio/");
  return AUDIO_EXT.test(f.name);
}

/** Display name from a file name ("01 - Intro.mp3" -> "01 - Intro"). */
export function nameFromFile(name: string): string {
  const base = name.replace(/\.[^/.]+$/, "").trim();
  return (base || "Audio").slice(0, 80);
}

/** What happens when the current track ends. Returns the next track id, or null to stop. */
export function nextAfterEnd(ids: string[], currentId: string | null, loop: LoopMode): string | null {
  if (!currentId) return null;
  if (loop === "one") return currentId;
  const i = ids.indexOf(currentId);
  if (i < 0) return null;
  if (i + 1 < ids.length) return ids[i + 1];
  return loop === "all" && ids.length > 0 ? ids[0] : null;
}

let seq = 0;
function newId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

const SAVE_DEBOUNCE_MS = 400;

export class AudioDeck {
  private state: DeckState = {
    loaded: false,
    persistError: null,
    playlist: [],
    pads: [],
    currentId: null,
    playing: false,
    position: 0,
    duration: 0,
    loopMode: "all",
    padsPlaying: [],
    error: null,
  };
  private listeners = new Set<(s: DeckState) => void>();

  // Playlist output: one element for the whole session (an element can only
  // be wired into one AudioContext, so it's recreated if the context changes).
  private el: HTMLAudioElement | null = null;
  private elCtx: AudioContext | null = null;
  private trackGain: GainNode | null = null;
  private retriedUrlFor: string | null = null;

  // Soundboard
  private buffers = new Map<string, AudioBuffer>();
  private padSources = new Map<string, Set<AudioBufferSourceNode>>();

  // Local files kept for "retry save"; blob URLs to revoke on remove.
  private files = new Map<string, File>();
  private blobUrls = new Map<string, string>();

  private loadPromise: Promise<void> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private mixer: MixerLike,
    private persistence: DeckPersistence,
    private createAudio: () => HTMLAudioElement = () => new Audio(),
    private createObjectUrl: (f: File) => string = (f) => URL.createObjectURL(f),
    private revokeObjectUrl: (u: string) => void = (u) => URL.revokeObjectURL(u),
    private fetchBytes: (url: string) => Promise<ArrayBuffer> = async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    },
  ) {}

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  getState(): DeckState {
    return this.state;
  }

  subscribe(fn: (s: DeckState) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private set(patch: Partial<DeckState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  private updateItem(list: DeckList, id: string, patch: Partial<DeckItem>) {
    this.set({ [list]: this.state[list].map((it) => (it.id === id ? { ...it, ...patch } : it)) } as Partial<DeckState>);
  }

  private find(id: string): { list: DeckList; item: DeckItem } | null {
    const p = this.state.playlist.find((x) => x.id === id);
    if (p) return { list: "playlist", item: p };
    const pad = this.state.pads.find((x) => x.id === id);
    return pad ? { list: "pads", item: pad } : null;
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  /** Loads the saved layout once per tab. Safe to call repeatedly. */
  ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          const { layout, assets, missing } = await this.persistence.load();
          const missingSet = new Set(missing);
          const toItem = (x: SavedLayout["playlist"][number], prefix: string): DeckItem => ({
            id: newId(prefix),
            name: x.name,
            volume: x.volume,
            assetId: x.assetId,
            url: assets[x.assetId]?.url || null,
            saveState: missingSet.has(x.assetId) || !assets[x.assetId]?.url ? "missing" : "saved",
          });
          // Anything added before the load finished stays, after the saved items.
          const addedEarly = this.state.playlist.length + this.state.pads.length > 0;
          this.set({
            loaded: true,
            persistError: null,
            playlist: [...layout.playlist.map((x) => toItem(x, "trk")), ...this.state.playlist],
            pads: [...layout.pads.map((x) => toItem(x, "pad")), ...this.state.pads],
            loopMode: layout.loopMode,
          });
          if (addedEarly) this.scheduleSave();
        } catch {
          this.set({
            loaded: true,
            persistError: "Couldn't load your saved audio. Changes in this session won't be saved.",
          });
        }
      })();
    }
    return this.loadPromise;
  }

  private layout(): SavedLayout {
    // "missing" items stay in the saved layout: a lookup can fail transiently,
    // and dropping them would delete them for good. Only remove() drops them.
    const keep = (it: DeckItem) => !!it.assetId && (it.saveState === "saved" || it.saveState === "missing");
    const out = (it: DeckItem) => ({ assetId: it.assetId!, name: it.name, volume: it.volume });
    return {
      playlist: this.state.playlist.filter(keep).map(out),
      pads: this.state.pads.filter(keep).map(out),
      loopMode: this.state.loopMode,
    };
  }

  private scheduleSave() {
    // Never save before the saved layout was loaded: that would overwrite it.
    if (!this.state.loaded || this.state.persistError) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persistence.save(this.layout()).catch(() => {
        this.set({ error: "Couldn't save your audio deck. Your last change may not be kept." });
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

  /** Adds audio files (non-audio files are skipped); each uploads to the library. Returns how many were added. */
  addFiles(files: File[], list: DeckList): number {
    const room = DECK_LIMITS[list] - this.state[list].length;
    const audio = files.filter(isAudioFile).slice(0, Math.max(0, room));
    const added: DeckItem[] = audio.map((f) => {
      const id = newId(list === "playlist" ? "trk" : "pad");
      const url = this.createObjectUrl(f);
      this.files.set(id, f);
      this.blobUrls.set(id, url);
      return { id, name: nameFromFile(f.name), volume: 1, assetId: null, url, saveState: "saving", uploadPct: 0 };
    });
    if (added.length === 0) return 0;
    this.set({ [list]: [...this.state[list], ...added] } as Partial<DeckState>);
    for (const it of added) void this.upload(list, it.id);
    return added.length;
  }

  private async upload(list: DeckList, id: string) {
    const file = this.files.get(id);
    if (!file) return;
    this.updateItem(list, id, { saveState: "saving", saveError: undefined, uploadPct: 0 });
    try {
      const { assetId } = await this.persistence.upload(file, (pct) => this.updateItem(list, id, { uploadPct: pct }));
      if (!this.find(id)) return; // removed while uploading
      this.files.delete(id);
      // Keep playing from the local copy this session; the library copy is used next time.
      this.updateItem(list, id, { assetId, saveState: "saved", uploadPct: undefined });
      this.scheduleSave();
    } catch (e) {
      if (!this.find(id)) return;
      this.updateItem(list, id, {
        saveState: "failed",
        uploadPct: undefined,
        saveError: e instanceof Error && e.message ? e.message : "Upload failed",
      });
    }
  }

  retrySave(id: string): void {
    const found = this.find(id);
    if (found && found.item.saveState === "failed") void this.upload(found.list, id);
  }

  /** Adds an existing content-library file. */
  addFromLibrary(asset: { id: string; name: string; url: string }, list: DeckList): boolean {
    if (this.state[list].length >= DECK_LIMITS[list]) return false;
    const item: DeckItem = {
      id: newId(list === "playlist" ? "trk" : "pad"),
      name: (asset.name || "Audio").slice(0, 80),
      volume: 1,
      assetId: asset.id,
      url: asset.url,
      saveState: "saved",
    };
    this.set({ [list]: [...this.state[list], item] } as Partial<DeckState>);
    this.scheduleSave();
    return true;
  }

  /** Removes from the deck only; the library file is kept. */
  remove(id: string): void {
    const found = this.find(id);
    if (!found) return;
    if (found.list === "playlist" && this.state.currentId === id) this.stop(true);
    if (found.list === "pads") {
      this.stopPad(id);
      this.buffers.delete(id);
    }
    const blob = this.blobUrls.get(id);
    if (blob) this.revokeObjectUrl(blob);
    this.blobUrls.delete(id);
    this.files.delete(id);
    this.set({ [found.list]: this.state[found.list].filter((x) => x.id !== id) } as Partial<DeckState>);
    if (found.item.assetId) this.scheduleSave();
  }

  move(id: string, delta: -1 | 1): void {
    const list = this.state.playlist.some((x) => x.id === id) ? "playlist" : "pads";
    const items = [...this.state[list]];
    const i = items.findIndex((x) => x.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    this.set({ [list]: items } as Partial<DeckState>);
    this.scheduleSave();
  }

  rename(id: string, name: string): void {
    const found = this.find(id);
    const clean = name.trim().slice(0, 80);
    if (!found || !clean) return;
    this.updateItem(found.list, id, { name: clean });
    this.scheduleSave();
  }

  setVolume(id: string, volume: number): void {
    const found = this.find(id);
    if (!found) return;
    const v = Math.max(0, Math.min(1, Math.round(volume * 100) / 100));
    this.updateItem(found.list, id, { volume: v });
    if (found.list === "playlist" && this.state.currentId === id && this.trackGain) this.trackGain.gain.value = v;
    this.scheduleSave();
  }

  setLoopMode(mode: LoopMode): void {
    this.set({ loopMode: mode });
    this.scheduleSave();
  }

  clearError(): void {
    this.set({ error: null });
  }

  // -------------------------------------------------------------------------
  // Playlist playback
  // -------------------------------------------------------------------------

  /** Wires the playlist element into the mixer's Music bus (needs a user gesture first time). */
  private ensureOutput(): HTMLAudioElement | null {
    this.mixer.init();
    void this.mixer.resume();
    const ctx = this.mixer.getAudioContext();
    const bus = this.mixer.getMusicBusInput();
    if (!ctx || !bus) return null;
    if (this.el && this.elCtx === ctx) return this.el;

    const el = this.createAudio();
    el.crossOrigin = "anonymous";
    el.preload = "auto";
    el.addEventListener("timeupdate", () => this.set({ position: el.currentTime || 0 }));
    el.addEventListener("durationchange", () => this.set({ duration: Number.isFinite(el.duration) ? el.duration : 0 }));
    el.addEventListener("ended", () => this.onEnded());
    el.addEventListener("error", () => void this.onError());
    const source = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    source.connect(gain);
    gain.connect(bus);
    this.el = el;
    this.elCtx = ctx;
    this.trackGain = gain;
    return el;
  }

  /** Plays a playlist track from the start. */
  playTrack(id: string): void {
    const item = this.state.playlist.find((x) => x.id === id);
    if (!item) return;
    if (!item.url) {
      this.set({ error: `“${item.name}” isn't available. It may have been deleted from your library.` });
      return;
    }
    const el = this.ensureOutput();
    if (!el) {
      this.set({ error: "Audio isn't ready yet. Try again." });
      return;
    }
    this.retriedUrlFor = null;
    if (this.trackGain) this.trackGain.gain.value = item.volume;
    el.src = item.url;
    el.currentTime = 0;
    this.set({ currentId: id, playing: true, position: 0, duration: 0, error: null });
    void this.startElement(el);
  }

  private async startElement(el: HTMLAudioElement) {
    try {
      await el.play();
    } catch (e) {
      // AbortError = a newer src replaced this one; anything else is a real failure.
      if (e instanceof DOMException && e.name === "AbortError") return;
      // NotAllowedError = the browser blocked autoplay until the user interacts.
      if (e instanceof DOMException && e.name === "NotAllowedError") {
        this.set({ playing: false, error: "Your browser blocked playback. Click play to start the audio." });
        return;
      }
      const item = this.state.playlist.find((x) => x.id === this.state.currentId);
      this.set({ playing: false, error: item ? `Couldn't play “${item.name}”.` : "Couldn't start playback." });
    }
  }

  /** Play/pause toggle; starts the first track when nothing is loaded. */
  togglePlay(): void {
    const el = this.el;
    if (!this.state.currentId || !el) {
      const first = this.state.playlist.find((x) => !!x.url);
      if (first) this.playTrack(first.id);
      return;
    }
    if (this.state.playing) {
      el.pause();
      this.set({ playing: false });
    } else {
      this.ensureOutput();
      this.set({ playing: true, error: null });
      void this.startElement(el);
    }
  }

  stop(clearCurrent = false): void {
    if (this.el) {
      this.el.pause();
      try {
        this.el.currentTime = 0;
      } catch {
        // no source loaded
      }
    }
    this.set({ playing: false, position: 0, ...(clearCurrent ? { currentId: null, duration: 0 } : {}) });
  }

  next(): void {
    const ids = this.state.playlist.map((x) => x.id);
    const i = this.state.currentId ? ids.indexOf(this.state.currentId) : -1;
    if (ids.length === 0) return;
    const nextId = i + 1 < ids.length ? ids[i + 1] : ids[0];
    this.playTrack(nextId);
  }

  previous(): void {
    // Like most players: past 3s, "previous" restarts the current track.
    if (this.el && this.state.currentId && (this.el.currentTime || 0) > 3) {
      this.seek(0);
      return;
    }
    const ids = this.state.playlist.map((x) => x.id);
    if (ids.length === 0) return;
    const i = this.state.currentId ? ids.indexOf(this.state.currentId) : 0;
    this.playTrack(ids[i > 0 ? i - 1 : ids.length - 1]);
  }

  seek(seconds: number): void {
    if (!this.el || !this.state.currentId) return;
    const max = this.state.duration || seconds;
    const t = Math.max(0, Math.min(max, seconds));
    this.el.currentTime = t;
    this.set({ position: t });
  }

  private onEnded() {
    const nextId = nextAfterEnd(
      this.state.playlist.map((x) => x.id),
      this.state.currentId,
      this.state.loopMode,
    );
    if (nextId) this.playTrack(nextId);
    else this.set({ playing: false, position: 0 });
  }

  /** Signed library URLs expire: fetch a fresh one once, then report. */
  private async onError() {
    const id = this.state.currentId;
    const item = id ? this.state.playlist.find((x) => x.id === id) : null;
    if (!item) return;
    if (item.assetId && !this.blobUrls.has(item.id) && this.retriedUrlFor !== item.id) {
      this.retriedUrlFor = item.id;
      const fresh = await this.persistence.resolveUrl(item.assetId).catch(() => null);
      if (fresh && this.state.currentId === item.id && this.el) {
        this.updateItem("playlist", item.id, { url: fresh });
        this.el.src = fresh;
        void this.startElement(this.el);
        return;
      }
    }
    this.set({ playing: false, error: `Couldn't play “${item.name}”.` });
  }

  // -------------------------------------------------------------------------
  // Soundboard
  // -------------------------------------------------------------------------

  /** Plays a pad from the start (pressing a playing pad restarts it). */
  async playPad(id: string): Promise<void> {
    const pad = this.state.pads.find((x) => x.id === id);
    if (!pad) return;
    this.mixer.init();
    void this.mixer.resume();
    const ctx = this.mixer.getAudioContext();
    const bus = this.mixer.getMusicBusInput();
    if (!ctx || !bus) {
      this.set({ error: "Audio isn't ready yet. Try again." });
      return;
    }
    let buffer = this.buffers.get(id);
    if (!buffer) {
      try {
        let url = pad.url;
        if (!url && pad.assetId) url = await this.persistence.resolveUrl(pad.assetId);
        if (!url) throw new Error("unavailable");
        let bytes: ArrayBuffer;
        try {
          bytes = await this.fetchBytes(url);
        } catch (err) {
          // Expired signed URL: one fresh attempt.
          if (!pad.assetId || this.blobUrls.has(id)) throw err;
          const fresh = await this.persistence.resolveUrl(pad.assetId);
          if (!fresh) throw err;
          this.updateItem("pads", id, { url: fresh });
          bytes = await this.fetchBytes(fresh);
        }
        buffer = await ctx.decodeAudioData(bytes);
        this.buffers.set(id, buffer);
      } catch {
        this.set({ error: `Couldn't load “${pad.name}”.` });
        return;
      }
    }
    this.stopPad(id);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = pad.volume;
    src.connect(gain);
    gain.connect(bus);
    const set = this.padSources.get(id) ?? new Set<AudioBufferSourceNode>();
    set.add(src);
    this.padSources.set(id, set);
    src.onended = () => {
      set.delete(src);
      try {
        gain.disconnect();
      } catch {
        // already disconnected
      }
      this.syncPadsPlaying();
    };
    src.start();
    this.syncPadsPlaying();
  }

  stopPad(id: string): void {
    const set = this.padSources.get(id);
    if (!set) return;
    for (const s of set) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    set.clear();
    this.syncPadsPlaying();
  }

  stopAllPads(): void {
    for (const id of this.padSources.keys()) this.stopPad(id);
  }

  private syncPadsPlaying() {
    const playing = [...this.padSources.entries()].filter(([, s]) => s.size > 0).map(([id]) => id);
    this.set({ padsPlaying: playing });
  }
}
