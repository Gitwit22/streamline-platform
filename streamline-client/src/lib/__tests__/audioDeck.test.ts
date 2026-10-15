import { describe, expect, it, vi } from "vitest";
import { AudioDeck, isAudioFile, nameFromFile, nextAfterEnd, type DeckPersistence, type SavedLayout } from "../audioDeck";

// ---- fakes -----------------------------------------------------------------

class FakeAudio extends EventTarget {
  src = "";
  currentTime = 0;
  duration = 120;
  paused = true;
  crossOrigin: string | null = null;
  preload = "";
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  fire(type: string) {
    this.dispatchEvent(new Event(type));
  }
}

function fakeCtx() {
  const gains: Array<{ gain: { value: number }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  const sources: Array<{ buffer: unknown; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; onended: null | (() => void); connect: ReturnType<typeof vi.fn> }> = [];
  const ctx = {
    createMediaElementSource: vi.fn(() => ({ connect: vi.fn() })),
    createGain: vi.fn(() => {
      const g = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
      gains.push(g);
      return g;
    }),
    createBufferSource: vi.fn(() => {
      const s = { buffer: null as unknown, start: vi.fn(), stop: vi.fn(), onended: null as null | (() => void), connect: vi.fn() };
      sources.push(s);
      return s;
    }),
    decodeAudioData: vi.fn(async () => ({ duration: 2 })),
  };
  return { ctx, gains, sources };
}

function setup(opts: { layout?: SavedLayout; assets?: Record<string, { url: string }>; missing?: string[]; loadFails?: boolean } = {}) {
  const { ctx, gains, sources } = fakeCtx();
  const bus = { id: "musicBus" };
  const mixer = {
    init: vi.fn(),
    resume: vi.fn(async () => {}),
    getAudioContext: () => ctx as unknown as AudioContext,
    getMusicBusInput: () => bus as unknown as AudioNode,
  };
  const saves: SavedLayout[] = [];
  let uploadImpl: (f: File) => Promise<{ assetId: string; url: string }> = async (f) => ({ assetId: `asset_${f.name.replace(/\W/g, "")}`, url: "" });
  const persistence: DeckPersistence = {
    load: vi.fn(async () => {
      if (opts.loadFails) throw new Error("boom");
      return {
        layout: opts.layout ?? { playlist: [], pads: [], loopMode: "all" },
        assets: opts.assets ?? {},
        missing: opts.missing ?? [],
      };
    }),
    save: vi.fn(async (l: SavedLayout) => {
      saves.push(l);
    }),
    upload: vi.fn((f: File, onProgress: (p: number) => void) => {
      onProgress(50);
      return uploadImpl(f);
    }),
    resolveUrl: vi.fn(async (id: string) => `https://fresh.example/${id}`),
  };
  const audios: FakeAudio[] = [];
  const fetchBytes = vi.fn(async () => new ArrayBuffer(8));
  let blob = 0;
  const deck = new AudioDeck(
    mixer,
    persistence,
    () => {
      const a = new FakeAudio();
      audios.push(a);
      return a as unknown as HTMLAudioElement;
    },
    () => `blob:${++blob}`,
    () => {},
    fetchBytes,
  );
  return {
    deck,
    persistence,
    saves,
    audios,
    gains,
    sources,
    fetchBytes,
    bus,
    setUpload: (fn: typeof uploadImpl) => {
      uploadImpl = fn;
    },
  };
}

const mp3 = (name: string) => new File(["x"], name, { type: "audio/mpeg" });
const flush = () => new Promise((r) => setTimeout(r, 0));

// ---- tests -----------------------------------------------------------------

describe("audioDeck helpers", () => {
  it("accepts audio files only and derives names", () => {
    expect(isAudioFile({ type: "audio/mpeg", name: "a.mp3" })).toBe(true);
    expect(isAudioFile({ type: "video/mp4", name: "a.mp4" })).toBe(false);
    expect(isAudioFile({ type: "", name: "a.flac" })).toBe(true);
    expect(isAudioFile({ type: "", name: "a.txt" })).toBe(false);
    expect(nameFromFile("01 - Intro.mp3")).toBe("01 - Intro");
  });

  it("nextAfterEnd follows the loop mode", () => {
    expect(nextAfterEnd(["a", "b"], "a", "off")).toBe("b");
    expect(nextAfterEnd(["a", "b"], "b", "off")).toBeNull();
    expect(nextAfterEnd(["a", "b"], "b", "all")).toBe("a");
    expect(nextAfterEnd(["a", "b"], "b", "one")).toBe("b");
  });
});

describe("AudioDeck persistence", () => {
  it("loads the saved layout and marks unresolvable files as missing", async () => {
    const t = setup({
      layout: {
        playlist: [
          { assetId: "a1", name: "Song", volume: 0.5 },
          { assetId: "gone", name: "Old", volume: 1 },
        ],
        pads: [{ assetId: "p1", name: "Clap", volume: 1 }],
        loopMode: "one",
      },
      assets: { a1: { url: "https://lib/a1" }, p1: { url: "https://lib/p1" } },
      missing: ["gone"],
    });
    await t.deck.ensureLoaded();
    const s = t.deck.getState();
    expect(s.loaded).toBe(true);
    expect(s.loopMode).toBe("one");
    expect(s.playlist.map((x) => [x.name, x.saveState, x.url])).toEqual([
      ["Song", "saved", "https://lib/a1"],
      ["Old", "missing", null],
    ]);
    expect(s.pads[0].saveState).toBe("saved");
  });

  it("uploads added files to the library and saves the layout (missing items are kept)", async () => {
    vi.useFakeTimers();
    try {
      const t = setup({ layout: { playlist: [{ assetId: "gone", name: "Old", volume: 1 }], pads: [], loopMode: "all" }, missing: ["gone"] });
      await t.deck.ensureLoaded();
      const added = t.deck.addFiles([mp3("Intro.mp3"), new File(["x"], "notes.txt", { type: "text/plain" })], "playlist");
      expect(added).toBe(1);
      await vi.advanceTimersByTimeAsync(0);
      const item = t.deck.getState().playlist[1];
      expect(item).toMatchObject({ name: "Intro", saveState: "saved", assetId: "asset_Intromp3", url: "blob:1" });
      await vi.advanceTimersByTimeAsync(500);
      expect(t.saves.at(-1)).toEqual({
        playlist: [
          { assetId: "gone", name: "Old", volume: 1 },
          { assetId: "asset_Intromp3", name: "Intro", volume: 1 },
        ],
        pads: [],
        loopMode: "all",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a failed upload playable, unsaved, and retryable", async () => {
    const t = setup();
    await t.deck.ensureLoaded();
    t.setUpload(async () => {
      throw new Error("Storage limit exceeded");
    });
    t.deck.addFiles([mp3("Big.mp3")], "pads");
    await flush();
    const pad = t.deck.getState().pads[0];
    expect(pad).toMatchObject({ saveState: "failed", saveError: "Storage limit exceeded", url: "blob:1", assetId: null });
    await t.deck.flushSave();
    expect(t.saves).toHaveLength(0);

    t.setUpload(async () => ({ assetId: "asset_ok", url: "" }));
    t.deck.retrySave(pad.id);
    await flush();
    expect(t.deck.getState().pads[0]).toMatchObject({ saveState: "saved", assetId: "asset_ok" });
  });

  it("never saves when the saved layout couldn't be loaded", async () => {
    const t = setup({ loadFails: true });
    await t.deck.ensureLoaded();
    expect(t.deck.getState().persistError).toMatch(/won't be saved/);
    t.deck.addFromLibrary({ id: "a1", name: "Song", url: "https://lib/a1" }, "playlist");
    await t.deck.flushSave();
    await new Promise((r) => setTimeout(r, 450));
    expect(t.persistence.save).not.toHaveBeenCalled();
  });
});

describe("AudioDeck playlist", () => {
  async function withTracks(loopMode: "off" | "one" | "all" = "all") {
    const t = setup({
      layout: {
        playlist: [
          { assetId: "a1", name: "One", volume: 0.4 },
          { assetId: "a2", name: "Two", volume: 1 },
        ],
        pads: [],
        loopMode,
      },
      assets: { a1: { url: "https://lib/a1" }, a2: { url: "https://lib/a2" } },
    });
    await t.deck.ensureLoaded();
    return t;
  }

  it("plays through the Music bus with the track's own volume", async () => {
    const t = await withTracks();
    const [one] = t.deck.getState().playlist;
    t.deck.playTrack(one.id);
    const el = t.audios[0];
    expect(el.src).toBe("https://lib/a1");
    expect(el.crossOrigin).toBe("anonymous");
    expect(el.play).toHaveBeenCalled();
    expect(t.gains[0].gain.value).toBe(0.4);
    expect(t.gains[0].connect).toHaveBeenCalledWith(t.bus);
    expect(t.deck.getState()).toMatchObject({ currentId: one.id, playing: true });
  });

  it("follows the loop mode when a track ends", async () => {
    const all = await withTracks("all");
    const [a, b] = all.deck.getState().playlist;
    all.deck.playTrack(b.id);
    all.audios[0].fire("ended");
    expect(all.deck.getState().currentId).toBe(a.id);

    const off = await withTracks("off");
    const [, b2] = off.deck.getState().playlist;
    off.deck.playTrack(b2.id);
    off.audios[0].fire("ended");
    expect(off.deck.getState()).toMatchObject({ currentId: b2.id, playing: false });
  });

  it("previous restarts the track after 3 seconds", async () => {
    const t = await withTracks();
    const [, b] = t.deck.getState().playlist;
    t.deck.playTrack(b.id);
    t.audios[0].currentTime = 10;
    t.deck.previous();
    expect(t.deck.getState().currentId).toBe(b.id);
    expect(t.audios[0].currentTime).toBe(0);
    t.deck.previous();
    expect(t.deck.getState().currentId).not.toBe(b.id);
  });

  it("refreshes an expired library URL once, then reports the error", async () => {
    const t = await withTracks();
    const [a] = t.deck.getState().playlist;
    t.deck.playTrack(a.id);
    t.audios[0].fire("error");
    await flush();
    expect(t.persistence.resolveUrl).toHaveBeenCalledWith("a1");
    expect(t.audios[0].src).toBe("https://fresh.example/a1");
    t.audios[0].fire("error");
    await flush();
    expect(t.deck.getState()).toMatchObject({ playing: false, error: "Couldn't play “One”." });
  });

  it("changing the current track's volume applies immediately", async () => {
    const t = await withTracks();
    const [a] = t.deck.getState().playlist;
    t.deck.playTrack(a.id);
    t.deck.setVolume(a.id, 0.8);
    expect(t.gains[0].gain.value).toBe(0.8);
  });
});

describe("AudioDeck soundboard", () => {
  it("decodes a pad once, plays it into the Music bus and tracks what's playing", async () => {
    const t = setup({
      layout: { playlist: [], pads: [{ assetId: "p1", name: "Clap", volume: 0.7 }], loopMode: "all" },
      assets: { p1: { url: "https://lib/p1" } },
    });
    await t.deck.ensureLoaded();
    const [pad] = t.deck.getState().pads;
    await t.deck.playPad(pad.id);
    await t.deck.playPad(pad.id);
    expect(t.fetchBytes).toHaveBeenCalledTimes(1);
    expect(t.sources).toHaveLength(2);
    // Pressing again restarts: the first one was stopped.
    expect(t.sources[0].stop).toHaveBeenCalled();
    expect(t.gains.at(-1)!.gain.value).toBe(0.7);
    expect(t.gains.at(-1)!.connect).toHaveBeenCalledWith(t.bus);
    expect(t.deck.getState().padsPlaying).toEqual([pad.id]);
    t.sources[1].onended?.();
    expect(t.deck.getState().padsPlaying).toEqual([]);
  });

  it("reports a pad that can't be loaded", async () => {
    const t = setup({
      layout: { playlist: [], pads: [{ assetId: "p1", name: "Clap", volume: 1 }], loopMode: "all" },
      assets: { p1: { url: "https://lib/p1" } },
    });
    await t.deck.ensureLoaded();
    t.fetchBytes.mockRejectedValue(new Error("403"));
    await t.deck.playPad(t.deck.getState().pads[0].id);
    expect(t.persistence.resolveUrl).toHaveBeenCalledWith("p1");
    expect(t.deck.getState().error).toBe("Couldn't load “Clap”.");
  });
});
