import { describe, expect, it, vi } from "vitest";
import {
  VIDEO_LIMITS,
  VideoDeck,
  isVideoFile,
  nextVideo,
  videoNameFromFile,
  type PlayTarget,
  type StagePublisher,
  type VideoItem,
  type VideoPersistence,
} from "../mediaVideo";
import type { OutputHandle } from "../mediaOutputs";
import type { PlayerEvents } from "../youtubePlayerLink";

// ---- fakes -----------------------------------------------------------------

// jsdom has no MediaStream; the deck only wraps tracks in one.
if (typeof globalThis.MediaStream === "undefined") {
  (globalThis as unknown as { MediaStream: unknown }).MediaStream = class {
    constructor(public tracks: unknown[] = []) {}
  };
}

class FakeVideo extends EventTarget {
  src = "";
  currentTime = 0;
  duration = 30;
  paused = true;
  loop = false;
  crossOrigin: string | null = null;
  preload = "";
  playsInline = false;
  playError: Error | null = null;
  play = vi.fn(async () => {
    if (this.playError) {
      const e = this.playError;
      this.playError = null;
      throw e;
    }
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  load = vi.fn();
  remove = vi.fn();
  removeAttribute = vi.fn((name: string) => {
    if (name === "src") this.src = "";
  });
  fire(type: string) {
    this.dispatchEvent(new Event(type));
  }
}

function fakeTrack(kind: "video" | "audio", label: string = kind) {
  const t = {
    kind,
    label,
    readyState: "live",
    contentHint: "",
    stop: vi.fn(() => {
      t.readyState = "ended";
    }),
    clone: vi.fn(() => fakeTrack(kind, `${label}-clone`)),
  };
  return t as unknown as MediaStreamTrack & { stop: ReturnType<typeof vi.fn>; clone: ReturnType<typeof vi.fn>; label: string };
}

function fakePlayer() {
  let events: PlayerEvents = {};
  const p = {
    status: "none" as "none" | "opening" | "ready" | "connected",
    videoTrack: null as MediaStreamTrack | null,
    audioTrack: null as MediaStreamTrack | null,
    loadError: null as Error | null,
    setEvents: (e: PlayerEvents) => {
      events = e;
    },
    open: vi.fn(() => true),
    capture: vi.fn(async () => {
      p.status = "connected";
      p.videoTrack = fakeTrack("video", "tab");
      p.audioTrack = fakeTrack("audio", "tab-audio");
      events.onStatus?.("connected");
    }),
    load: vi.fn(async () => {
      if (p.loadError) {
        const e = p.loadError;
        p.loadError = null;
        throw e;
      }
      return "Real title";
    }),
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    setLoop: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
    emit: () => events,
  };
  return p;
}

function setup(opts: { capture?: "ok" | "unsupported" | "no-video" } = {}) {
  const gains: Array<{ gain: { value: number }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  const audioTrack = fakeTrack("audio", "session-audio");
  const ctx = {
    createMediaElementSource: vi.fn(() => ({ connect: vi.fn() })),
    createMediaStreamSource: vi.fn(() => ({ connect: vi.fn() })),
    createGain: vi.fn(() => {
      const g = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
      gains.push(g);
      return g;
    }),
    createMediaStreamDestination: vi.fn(() => ({ stream: { getAudioTracks: () => [audioTrack], getTracks: () => [audioTrack] } })),
  };
  const mixer = { init: vi.fn(), resume: vi.fn(async () => {}), getAudioContext: () => ctx as unknown as AudioContext };
  const persistence = {
    load: vi.fn(async (): ReturnType<VideoPersistence["load"]> => ({ layout: { videos: [], playMode: "once" }, assets: {}, missing: [] })),
    save: vi.fn(async () => {}),
    upload: vi.fn(async () => ({ assetId: "asset_1", url: "https://cdn/x.mp4" })),
    resolveUrl: vi.fn(async () => "https://cdn/fresh.mp4" as string | null),
  } satisfies VideoPersistence;
  const videos: FakeVideo[] = [];
  const captured: Array<ReturnType<typeof fakeTrack>> = [];
  const capture = opts.capture ?? "ok";
  const player = fakePlayer();
  const deck = new VideoDeck(mixer, persistence, {
    createVideo: () => {
      const v = new FakeVideo();
      videos.push(v);
      return v as unknown as HTMLVideoElement;
    },
    mountElement: () => {},
    captureStream: () => {
      if (capture === "unsupported") return null;
      const t = fakeTrack("video", `file-${captured.length}`);
      captured.push(t);
      const list = capture === "no-video" ? [] : [t];
      return { getVideoTracks: () => list, addEventListener: () => {}, removeEventListener: () => {} } as unknown as MediaStream;
    },
    createObjectUrl: (f) => `blob:${f.name}`,
    revokeObjectUrl: vi.fn(),
    player,
    fetchTitle: vi.fn(async () => "Fetched title"),
  });

  const handles: Array<OutputHandle & { release: ReturnType<typeof vi.fn>; replaceVideo: ReturnType<typeof vi.fn>; target: PlayTarget }> = [];
  let stoppedCb: (() => void) | null = null;
  const publisher = {
    screenSharing: false as boolean,
    caps: { stage: true, box: true, sound: true },
    capabilities() {
      return this.caps;
    },
    isScreenSharing() {
      return this.screenSharing;
    },
    publish: vi.fn(async (target: PlayTarget, _v: MediaStreamTrack, _a: MediaStreamTrack | null, onStopped: () => void) => {
      stoppedCb = onStopped;
      const h = { target, notice: null, release: vi.fn(async () => {}), replaceVideo: vi.fn(async () => {}) };
      handles.push(h);
      return h as OutputHandle;
    }),
  } satisfies StagePublisher & { screenSharing: boolean; caps: unknown };
  return { deck, persistence, publisher, handles, videos, captured, player, gains, stopped: () => stoppedCb?.() };
}

type S = ReturnType<typeof setup>;

async function loadedWith(s: S, items: Array<{ assetId?: string; youtubeId?: string; name: string; url?: string }>, playMode = "once") {
  s.persistence.load.mockResolvedValueOnce({
    layout: {
      videos: items.map((i) => ({ assetId: i.assetId, youtubeId: i.youtubeId, name: i.name, volume: 0.8 })),
      playMode: playMode as "once",
    },
    assets: Object.fromEntries(items.filter((i) => i.url && i.assetId).map((i) => [i.assetId!, { url: i.url! }])),
    missing: [],
  });
  await s.deck.ensureLoaded();
  s.deck.attachPublisher(s.publisher);
  return s.deck.getState().videos;
}

const file = (n: number) => ({ assetId: `a${n}`, name: `Clip ${n}`, url: `https://cdn/a${n}.mp4` });

// ---- tests -----------------------------------------------------------------

describe("helpers", () => {
  it("isVideoFile uses the MIME type, else the extension", () => {
    expect(isVideoFile({ type: "video/mp4", name: "a.bin" })).toBe(true);
    expect(isVideoFile({ type: "audio/mpeg", name: "a.mp4" })).toBe(false);
    expect(isVideoFile({ type: "", name: "clip.MOV" })).toBe(true);
    expect(isVideoFile({ type: "", name: "song.mp3" })).toBe(false);
  });
  it("videoNameFromFile strips the extension", () => {
    expect(videoNameFromFile("01 - Intro.mp4")).toBe("01 - Intro");
    expect(videoNameFromFile(".mp4")).toBe("Video");
  });
  it("nextVideo continues, skips unplayable items and wraps only when asked", () => {
    const v = (id: string, url: string | null, kind: "file" | "youtube" = "file") =>
      ({ id, kind, url, youtubeId: kind === "youtube" ? "dQw4w9WgXcQ" : null }) as VideoItem;
    const list = [v("1", "u"), v("2", null), v("3", null, "youtube"), v("4", "u")];
    expect(nextVideo(list, "1", false)?.id).toBe("3");
    expect(nextVideo(list, "4", false)).toBeNull();
    expect(nextVideo(list, "4", true)?.id).toBe("1");
    expect(nextVideo([v("1", "u")], "1", true)?.id).toBe("1");
    expect(nextVideo(list, "missing", true)).toBeNull();
  });
});

describe("playing in the video box and on stage", () => {
  it("plays a file in the box: captured picture + session sound, then live", async () => {
    const s = setup();
    const [a] = await loadedWith(s, [file(1)]);
    await s.deck.play(a.id, "box");
    expect(s.publisher.publish).toHaveBeenCalledWith("box", s.captured[0], expect.anything(), expect.any(Function));
    expect(s.captured[0].contentHint).toBe("motion");
    expect(s.deck.getState()).toMatchObject({ status: "live", target: "box", currentId: a.id, playing: true, error: null });
  });

  it("stage needs no screen share running; the box doesn't care", async () => {
    const s = setup();
    const [a] = await loadedWith(s, [file(1)]);
    s.publisher.screenSharing = true;
    await s.deck.play(a.id, "stage");
    expect(s.deck.getState().error).toMatch(/Stop your screen share/);
    expect(s.publisher.publish).not.toHaveBeenCalled();
    await s.deck.play(a.id, "box");
    expect(s.deck.getState()).toMatchObject({ status: "live", target: "box" });
  });

  it("refuses without a room, and when the role can't publish (invisible host)", async () => {
    const s = setup();
    s.persistence.load.mockResolvedValueOnce({ layout: { videos: [{ assetId: "a1", name: "x", volume: 1 }], playMode: "once" }, assets: { a1: { url: "u" } }, missing: [] });
    await s.deck.ensureLoaded();
    const [a] = s.deck.getState().videos;
    await s.deck.play(a.id, "box");
    expect(s.deck.getState().error).toMatch(/Join the room/);

    s.publisher.caps = { stage: false, box: false, sound: false };
    s.deck.attachPublisher(s.publisher);
    await s.deck.play(a.id, "box");
    expect(s.deck.getState().error).toMatch(/invisible hosts/);
    expect(s.publisher.publish).not.toHaveBeenCalled();
  });

  it("stop releases the output first (camera comes back), then stops the picture", async () => {
    const s = setup();
    const [a] = await loadedWith(s, [file(1)]);
    await s.deck.play(a.id, "box");
    const order: string[] = [];
    s.handles[0].release.mockImplementationOnce(async () => {
      order.push("release");
    });
    s.captured[0].stop.mockImplementationOnce(() => order.push("stop-track"));
    await s.deck.stop();
    expect(order).toEqual(["release", "stop-track"]);
    expect(s.deck.getState()).toMatchObject({ status: "off", target: null, currentId: null });
  });

  it("switching videos in the same place swaps the picture instead of re-publishing", async () => {
    const s = setup();
    const [a, b] = await loadedWith(s, [file(1), file(2)]);
    await s.deck.play(a.id, "box");
    await s.deck.play(b.id, "box");
    expect(s.publisher.publish).toHaveBeenCalledTimes(1);
    expect(s.handles[0].replaceVideo).toHaveBeenCalledWith(s.captured[1]);
    expect(s.captured[0].stop).toHaveBeenCalled();
    // The two hidden players alternate, so the old one kept playing until the swap.
    expect(s.videos[1].src).toBe("https://cdn/a2.mp4");
    expect(s.deck.getState()).toMatchObject({ status: "live", currentId: b.id });
  });

  it("moving from the box to the stage ends the box session first", async () => {
    const s = setup();
    const [a] = await loadedWith(s, [file(1)]);
    await s.deck.play(a.id, "box");
    await s.deck.play(a.id, "stage");
    expect(s.handles[0].release).toHaveBeenCalled();
    expect(s.handles[1].target).toBe("stage");
    expect(s.deck.getState()).toMatchObject({ status: "live", target: "stage" });
  });

  it("a failed switch keeps the video that was playing", async () => {
    const s = setup();
    const [a, b] = await loadedWith(s, [file(1), { assetId: "a2", name: "Broken" }]);
    await s.deck.play(a.id, "box");
    s.deck.getState().videos[1].url = "https://cdn/broken.mp4";
    s.videos[1].playError = new DOMException("no source", "NotSupportedError");
    s.persistence.resolveUrl.mockResolvedValueOnce(null);
    await s.deck.play(b.id, "box");
    expect(s.deck.getState()).toMatchObject({ status: "live", currentId: a.id });
    expect(s.deck.getState().error).toMatch(/Couldn't play “Broken”/);
    expect(s.handles[0].release).not.toHaveBeenCalled();
  });

  it("surfaces publish failures instead of claiming the video is live", async () => {
    const s = setup();
    const [a] = await loadedWith(s, [file(1)]);
    s.publisher.publish.mockRejectedValueOnce(new Error("insufficient permissions"));
    await s.deck.play(a.id, "box");
    expect(s.deck.getState().status).toBe("off");
    expect(s.deck.getState().error).toMatch(/insufficient permissions/);
    expect(s.captured[0].stop).toHaveBeenCalled();
  });

  it("stops when something else ends the output (camera button, Stop sharing)", async () => {
    const s = setup();
    const [a] = await loadedWith(s, [file(1)]);
    await s.deck.play(a.id, "box");
    s.stopped();
    await vi.waitFor(() => expect(s.deck.getState().status).toBe("off"));
  });

  it("leaving the room ends playback", async () => {
    const s = setup();
    const [a] = await loadedWith(s, [file(1)]);
    await s.deck.play(a.id, "stage");
    s.deck.detachPublisher(s.publisher);
    await vi.waitFor(() => expect(s.handles[0].release).toHaveBeenCalled());
    expect(s.deck.getState()).toMatchObject({ status: "off", attached: false });
  });

  it("quick double clicks never publish twice", async () => {
    const s = setup();
    const [a, b] = await loadedWith(s, [file(1), file(2)]);
    await Promise.all([s.deck.play(a.id, "box"), s.deck.play(b.id, "box")]);
    expect(s.publisher.publish).toHaveBeenCalledTimes(1);
    expect(s.deck.getState()).toMatchObject({ status: "live", currentId: b.id });
  });

  it("a stop during start-up leaves nothing published", async () => {
    const s = setup();
    const [a] = await loadedWith(s, [file(1)]);
    let release!: (h: OutputHandle) => void;
    const late = { notice: null, release: vi.fn(async () => {}), replaceVideo: vi.fn(async () => {}) };
    s.publisher.publish.mockImplementationOnce(() => new Promise<OutputHandle>((r) => (release = r)) as never);
    const starting = s.deck.play(a.id, "box");
    await vi.waitFor(() => expect(s.publisher.publish).toHaveBeenCalled());
    const stopping = s.deck.stop();
    release(late);
    await Promise.all([starting, stopping]);
    expect(late.release).toHaveBeenCalled();
    expect(s.deck.getState().status).toBe("off");
  });
});

describe("playlist", () => {
  it("once: the box returns to the camera when the video ends", async () => {
    const s = setup();
    const [a] = await loadedWith(s, [file(1), file(2)]);
    await s.deck.play(a.id, "box");
    s.videos[0].fire("ended");
    await vi.waitFor(() => expect(s.deck.getState().status).toBe("off"));
    expect(s.handles[0].release).toHaveBeenCalled();
  });

  it("next: continues down the playlist in the same place, then stops after the last", async () => {
    const s = setup();
    const [a, b] = await loadedWith(s, [file(1), file(2)], "next");
    await s.deck.play(a.id, "stage");
    s.videos[0].fire("ended");
    await vi.waitFor(() => expect(s.deck.getState().currentId).toBe(b.id));
    expect(s.publisher.publish).toHaveBeenCalledTimes(1);
    s.videos[1].fire("ended");
    await vi.waitFor(() => expect(s.deck.getState().status).toBe("off"));
  });

  it("nextLoop wraps around; loop repeats inside the player", async () => {
    const s = setup();
    const [a, b] = await loadedWith(s, [file(1), file(2)], "nextLoop");
    await s.deck.play(b.id, "box");
    s.videos[0].fire("ended");
    await vi.waitFor(() => expect(s.deck.getState().currentId).toBe(a.id));

    s.deck.setPlayMode("loop");
    expect(s.videos[1].loop).toBe(true); // the element now on air loops by itself
    await s.deck.flushSave();
    expect(s.persistence.save).toHaveBeenLastCalledWith(expect.objectContaining({ playMode: "loop" }));
  });

  it("stops (and says why) when the next item is YouTube and the player isn't connected", async () => {
    const s = setup();
    const [a] = await loadedWith(s, [file(1), { youtubeId: "dQw4w9WgXcQ", name: "Song" }], "next");
    await s.deck.play(a.id, "box");
    s.videos[0].fire("ended");
    await vi.waitFor(() => expect(s.deck.getState().status).toBe("off"));
    expect(s.deck.getState().error).toMatch(/Up next is “Song” on YouTube/);
  });
});

describe("YouTube", () => {
  it("adds links, fetches the title and saves only the id", async () => {
    vi.useFakeTimers();
    try {
      const s = setup();
      await s.deck.ensureLoaded();
      expect(s.deck.addYouTube("not a link")).toMatch(/isn't a YouTube/);
      expect(s.deck.addYouTube("https://youtu.be/dQw4w9WgXcQ?t=3")).toBeNull();
      await vi.waitFor(() => expect(s.deck.getState().videos[0].name).toBe("Fetched title"));
      await vi.advanceTimersByTimeAsync(500);
      expect(s.persistence.save).toHaveBeenLastCalledWith({
        videos: [{ youtubeId: "dQw4w9WgXcQ", name: "Fetched title", volume: 1 }],
        playMode: "once",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("needs the player connected, then publishes a clone of the captured tab", async () => {
    const s = setup();
    const [y] = await loadedWith(s, [{ youtubeId: "dQw4w9WgXcQ", name: "Song" }]);
    await s.deck.play(y.id, "box");
    expect(s.deck.getState().error).toMatch(/Connect the YouTube player/);

    await s.deck.capturePlayer();
    await s.deck.play(y.id, "box");
    expect(s.player.load).toHaveBeenCalledWith("dQw4w9WgXcQ", false);
    const published = s.publisher.publish.mock.calls[0][1] as unknown as { label: string };
    expect(published.label).toBe("tab-clone");
    expect(s.deck.getState()).toMatchObject({ status: "live", target: "box" });

    // Stopping ends the clone, never the tab capture itself.
    await s.deck.stop();
    expect((s.player.videoTrack as unknown as { stop: ReturnType<typeof vi.fn> }).stop).not.toHaveBeenCalled();
    expect(s.player.stop).toHaveBeenCalled();
  });

  it("a YouTube video ending continues the playlist", async () => {
    const s = setup();
    const [y, f] = await loadedWith(s, [{ youtubeId: "dQw4w9WgXcQ", name: "Song" }, file(2)], "next");
    await s.deck.capturePlayer();
    await s.deck.play(y.id, "stage");
    s.player.emit().onState?.("ended");
    await vi.waitFor(() => expect(s.deck.getState().currentId).toBe(f.id));
    expect(s.player.stop).toHaveBeenCalled(); // player tab goes idle once a file is on air
  });

  it("a failed YouTube-to-YouTube switch ends playback instead of showing YouTube's error screen", async () => {
    const s = setup();
    const [y1, y2] = await loadedWith(s, [
      { youtubeId: "dQw4w9WgXcQ", name: "One" },
      { youtubeId: "aaaaaaaaaaa", name: "Two" },
    ]);
    await s.deck.capturePlayer();
    await s.deck.play(y1.id, "stage");
    s.player.loadError = new Error("The video's owner doesn't allow it to be played in other apps.");
    await s.deck.play(y2.id, "stage");
    expect(s.deck.getState().status).toBe("off");
    expect(s.deck.getState().error).toMatch(/owner doesn't allow/);
    expect(s.handles[0].release).toHaveBeenCalled();
  });
});

describe("list + persistence", () => {
  it("adds video files (skipping others), uploads them and saves the list", async () => {
    vi.useFakeTimers();
    try {
      const s = setup();
      await s.deck.ensureLoaded();
      const n = s.deck.addFiles([new File(["x"], "clip.mp4", { type: "video/mp4" }), new File(["x"], "song.mp3", { type: "audio/mpeg" })]);
      expect(n).toBe(1);
      expect(s.deck.getState().videos[0]).toMatchObject({ kind: "file", name: "clip", url: "blob:clip.mp4", saveState: "saving" });
      await vi.waitFor(() => expect(s.deck.getState().videos[0].saveState).toBe("saved"));
      await vi.advanceTimersByTimeAsync(500);
      expect(s.persistence.save).toHaveBeenCalledWith({ videos: [{ assetId: "asset_1", name: "clip", volume: 1 }], playMode: "once" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks failed uploads and never saves before the list loaded", async () => {
    const s = setup();
    s.persistence.upload.mockRejectedValueOnce(new Error("Storage limit exceeded"));
    s.deck.addFiles([new File(["x"], "clip.mp4", { type: "video/mp4" })]);
    await vi.waitFor(() => expect(s.deck.getState().videos[0].saveState).toBe("failed"));
    expect(s.deck.getState().videos[0]).toMatchObject({ saveError: "Storage limit exceeded", url: "blob:clip.mp4" });
    expect(s.persistence.save).not.toHaveBeenCalled();
  });

  it("does not save when the saved list couldn't be loaded", async () => {
    const s = setup();
    s.persistence.load.mockRejectedValueOnce(new Error("500"));
    await s.deck.ensureLoaded();
    expect(s.deck.getState().persistError).toMatch(/Couldn't load/);
    s.deck.addFromLibrary({ id: "x", name: "X", url: "https://x" });
    await s.deck.flushSave();
    expect(s.persistence.save).not.toHaveBeenCalled();
  });

  it("enforces the playlist limit", async () => {
    const s = setup();
    await s.deck.ensureLoaded();
    for (let i = 0; i < VIDEO_LIMITS.videos; i++) expect(s.deck.addFromLibrary({ id: `a${i}`, name: "x", url: "u" })).toBe(true);
    expect(s.deck.addFromLibrary({ id: "over", name: "x", url: "u" })).toBe(false);
    expect(s.deck.addYouTube("dQw4w9WgXcQ")).toMatch(/full/);
    expect(s.deck.addFiles([new File(["x"], "c.mp4", { type: "video/mp4" })])).toBe(0);
  });

  it("keeps saved files whose library entry is gone as missing, plus YouTube items", async () => {
    const s = setup();
    s.persistence.load.mockResolvedValueOnce({
      layout: {
        videos: [
          { assetId: "gone", name: "Old", volume: 1 },
          { youtubeId: "dQw4w9WgXcQ", name: "Song", volume: 0.5 },
        ],
        playMode: "nextLoop",
      },
      assets: {},
      missing: ["gone"],
    });
    await s.deck.ensureLoaded();
    expect(s.deck.getState().playMode).toBe("nextLoop");
    expect(s.deck.getState().videos[0]).toMatchObject({ kind: "file", saveState: "missing", url: null });
    expect(s.deck.getState().videos[1]).toMatchObject({ kind: "youtube", youtubeId: "dQw4w9WgXcQ" });
    s.deck.setPlayMode("once");
    await s.deck.flushSave();
    expect(s.persistence.save).toHaveBeenCalledWith({
      videos: [
        { assetId: "gone", name: "Old", volume: 1 },
        { youtubeId: "dQw4w9WgXcQ", name: "Song", volume: 0.5 },
      ],
      playMode: "once",
    });
  });
});
