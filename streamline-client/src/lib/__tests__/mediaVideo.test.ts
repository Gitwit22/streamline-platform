import { describe, expect, it, vi } from "vitest";
import {
  VIDEO_LIMITS,
  VideoDeck,
  isVideoFile,
  videoNameFromFile,
  type StageHandle,
  type StagePublisher,
  type VideoPersistence,
} from "../mediaVideo";

// ---- fakes -----------------------------------------------------------------

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

function fakeTrack(kind: "video" | "audio") {
  return { kind, stop: vi.fn(), contentHint: "" } as unknown as MediaStreamTrack & { stop: ReturnType<typeof vi.fn> };
}

function setup(opts: { capture?: "ok" | "unsupported" | "no-video" } = {}) {
  const audioTrack = fakeTrack("audio");
  const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  const ctx = {
    createMediaElementSource: vi.fn(() => ({ connect: vi.fn() })),
    createGain: vi.fn(() => gain),
    createMediaStreamDestination: vi.fn(() => ({ stream: { getAudioTracks: () => [audioTrack] } })),
  };
  const mixer = { init: vi.fn(), resume: vi.fn(async () => {}), getAudioContext: () => ctx as unknown as AudioContext };
  const persistence = {
    load: vi.fn(async () => ({ layout: { videos: [], loop: false }, assets: {}, missing: [] as string[] })),
    save: vi.fn(async () => {}),
    upload: vi.fn(async () => ({ assetId: "asset_1", url: "https://cdn/x.mp4" })),
    resolveUrl: vi.fn(async () => "https://cdn/fresh.mp4" as string | null),
  } satisfies VideoPersistence;
  const videos: FakeVideo[] = [];
  const videoTracks: Array<ReturnType<typeof fakeTrack>> = [];
  const capture = opts.capture ?? "ok";
  const deck = new VideoDeck(mixer, persistence, {
    createVideo: () => {
      const v = new FakeVideo();
      videos.push(v);
      return v as unknown as HTMLVideoElement;
    },
    mountElement: () => {},
    captureStream: () => {
      if (capture === "unsupported") return null;
      const t = fakeTrack("video");
      videoTracks.push(t);
      const list = capture === "no-video" ? [] : [t];
      return { getVideoTracks: () => list, addEventListener: () => {}, removeEventListener: () => {} } as unknown as MediaStream;
    },
    createObjectUrl: (f) => `blob:${f.name}`,
    revokeObjectUrl: vi.fn(),
  });

  const handles: Array<StageHandle & { unpublish: ReturnType<typeof vi.fn> }> = [];
  let stoppedCb: (() => void) | null = null;
  const publisher = {
    screenSharing: false as boolean,
    isScreenSharing() {
      return this.screenSharing;
    },
    publish: vi.fn(async (_v: MediaStreamTrack, _a: MediaStreamTrack | null, onStopped: () => void) => {
      stoppedCb = onStopped;
      const h = { unpublish: vi.fn(async () => {}) };
      handles.push(h);
      return h;
    }),
  } satisfies StagePublisher & { screenSharing: boolean };
  return { deck, mixer, persistence, publisher, handles, videos, videoTracks, audioTrack, gain, stopped: () => stoppedCb?.() };
}

async function loadedWith(s: ReturnType<typeof setup>, items: Array<{ assetId: string; name: string; url?: string }>) {
  s.persistence.load.mockResolvedValueOnce({
    layout: { videos: items.map((i) => ({ assetId: i.assetId, name: i.name, volume: 0.8 })), loop: false },
    assets: Object.fromEntries(items.filter((i) => i.url).map((i) => [i.assetId, { url: i.url! }])),
    missing: [],
  });
  await s.deck.ensureLoaded();
  return s.deck.getState().videos;
}

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
});

describe("VideoDeck stage playback", () => {
  it("plays, captures and publishes a video on stage", async () => {
    const s = setup();
    const [item] = await loadedWith(s, [{ assetId: "a1", name: "Intro", url: "https://cdn/a1.mp4" }]);
    s.deck.attachPublisher(s.publisher);

    await s.deck.playOnStage(item.id);

    const el = s.videos[0];
    expect(el.src).toBe("https://cdn/a1.mp4");
    expect(el.crossOrigin).toBe("anonymous");
    expect(s.gain.gain.value).toBe(0.8);
    expect(s.publisher.publish).toHaveBeenCalledWith(s.videoTracks[0], s.audioTrack, expect.any(Function));
    expect(s.videoTracks[0].contentHint).toBe("motion");
    expect(s.deck.getState()).toMatchObject({ stage: "live", currentId: item.id, playing: true, error: null });
  });

  it("refuses without a room, and while the host shares their screen", async () => {
    const s = setup();
    const [item] = await loadedWith(s, [{ assetId: "a1", name: "Intro", url: "https://cdn/a1.mp4" }]);
    await s.deck.playOnStage(item.id);
    expect(s.deck.getState().error).toMatch(/Join the room/);

    s.deck.attachPublisher(s.publisher);
    s.publisher.screenSharing = true;
    await s.deck.playOnStage(item.id);
    expect(s.deck.getState().error).toMatch(/Stop your screen share/);
    expect(s.publisher.publish).not.toHaveBeenCalled();
    expect(s.deck.getState().stage).toBe("off");
  });

  it("retries once with a fresh URL when the signed URL fails", async () => {
    const s = setup();
    const [item] = await loadedWith(s, [{ assetId: "a1", name: "Intro", url: "https://cdn/expired.mp4" }]);
    s.deck.attachPublisher(s.publisher);
    s.deck["ensureElement"](); // create the element so the failure can be armed
    s.videos[0].playError = new DOMException("no source", "NotSupportedError");

    await s.deck.playOnStage(item.id);

    expect(s.persistence.resolveUrl).toHaveBeenCalledWith("a1");
    expect(s.videos[0].src).toBe("https://cdn/fresh.mp4");
    expect(s.deck.getState().stage).toBe("live");
  });

  it("reports an unsupported browser and a file without a picture", async () => {
    const s = setup({ capture: "unsupported" });
    const [item] = await loadedWith(s, [{ assetId: "a1", name: "Intro", url: "https://cdn/a1.mp4" }]);
    s.deck.attachPublisher(s.publisher);
    await s.deck.playOnStage(item.id);
    expect(s.deck.getState()).toMatchObject({ stage: "off", currentId: null });
    expect(s.deck.getState().error).toMatch(/Chrome, Edge or Firefox/);
    expect(s.publisher.publish).not.toHaveBeenCalled();
  });

  it("surfaces publish failures instead of claiming the video is live", async () => {
    const s = setup();
    const [item] = await loadedWith(s, [{ assetId: "a1", name: "Intro", url: "https://cdn/a1.mp4" }]);
    s.deck.attachPublisher(s.publisher);
    s.publisher.publish.mockRejectedValueOnce(new Error("insufficient permissions"));
    await s.deck.playOnStage(item.id);
    expect(s.deck.getState().stage).toBe("off");
    expect(s.deck.getState().error).toMatch(/insufficient permissions/);
    expect(s.videoTracks[0].stop).toHaveBeenCalled();
  });

  it("takes the video off stage when it ends (no loop) and on stop", async () => {
    const s = setup();
    const [a, b] = await loadedWith(s, [
      { assetId: "a1", name: "Intro", url: "https://cdn/a1.mp4" },
      { assetId: "a2", name: "Promo", url: "https://cdn/a2.mp4" },
    ]);
    s.deck.attachPublisher(s.publisher);
    await s.deck.playOnStage(a.id);
    s.videos[0].fire("ended");
    await Promise.resolve();
    expect(s.handles[0].unpublish).toHaveBeenCalled();
    expect(s.deck.getState()).toMatchObject({ stage: "off", currentId: null, playing: false });

    await s.deck.playOnStage(b.id);
    await s.deck.stop();
    expect(s.handles[1].unpublish).toHaveBeenCalled();
    expect(s.deck.getState().stage).toBe("off");
  });

  it("switching videos unpublishes the previous one first", async () => {
    const s = setup();
    const [a, b] = await loadedWith(s, [
      { assetId: "a1", name: "Intro", url: "https://cdn/a1.mp4" },
      { assetId: "a2", name: "Promo", url: "https://cdn/a2.mp4" },
    ]);
    s.deck.attachPublisher(s.publisher);
    await s.deck.playOnStage(a.id);
    await s.deck.playOnStage(b.id);
    expect(s.handles[0].unpublish).toHaveBeenCalled();
    expect(s.handles[1].unpublish).not.toHaveBeenCalled();
    expect(s.deck.getState()).toMatchObject({ stage: "live", currentId: b.id });
  });

  it("stops when something else removes the tracks, and when leaving the room", async () => {
    const s = setup();
    const [a] = await loadedWith(s, [{ assetId: "a1", name: "Intro", url: "https://cdn/a1.mp4" }]);
    s.deck.attachPublisher(s.publisher);
    await s.deck.playOnStage(a.id);
    s.stopped();
    await Promise.resolve();
    expect(s.deck.getState().stage).toBe("off");
    expect(s.videos[0].pause).toHaveBeenCalled();

    await s.deck.playOnStage(a.id);
    s.deck.detachPublisher(s.publisher);
    await Promise.resolve();
    expect(s.handles[1].unpublish).toHaveBeenCalled();
    expect(s.deck.getState()).toMatchObject({ stage: "off", canPublish: false });
  });

  it("a stop during start-up never leaves a video published", async () => {
    const s = setup();
    const [a] = await loadedWith(s, [{ assetId: "a1", name: "Intro", url: "https://cdn/a1.mp4" }]);
    s.deck.attachPublisher(s.publisher);
    let release!: (h: StageHandle) => void;
    const late = { unpublish: vi.fn(async () => {}) };
    s.publisher.publish.mockImplementationOnce(
      () => new Promise<StageHandle>((r) => (release = r)) as ReturnType<typeof s.publisher.publish>,
    );
    const starting = s.deck.playOnStage(a.id);
    await vi.waitFor(() => expect(s.publisher.publish).toHaveBeenCalled());
    await s.deck.stop();
    release(late);
    await starting;
    expect(late.unpublish).toHaveBeenCalled();
    expect(s.deck.getState().stage).toBe("off");
  });
});

describe("VideoDeck list + persistence", () => {
  it("adds video files (skipping others), uploads them and saves the list", async () => {
    vi.useFakeTimers();
    try {
      const s = setup();
      await s.deck.ensureLoaded();
      const n = s.deck.addFiles([
        new File(["x"], "clip.mp4", { type: "video/mp4" }),
        new File(["x"], "song.mp3", { type: "audio/mpeg" }),
      ]);
      expect(n).toBe(1);
      expect(s.deck.getState().videos[0]).toMatchObject({ name: "clip", url: "blob:clip.mp4", saveState: "saving" });
      await vi.waitFor(() => expect(s.deck.getState().videos[0].saveState).toBe("saved"));
      await vi.advanceTimersByTimeAsync(500);
      expect(s.persistence.save).toHaveBeenCalledWith({ videos: [{ assetId: "asset_1", name: "clip", volume: 1 }], loop: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks failed uploads, keeps them playable, and never saves before the list loaded", async () => {
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

  it("enforces the list limit", async () => {
    const s = setup();
    await s.deck.ensureLoaded();
    for (let i = 0; i < VIDEO_LIMITS.videos; i++) expect(s.deck.addFromLibrary({ id: `a${i}`, name: "x", url: "u" })).toBe(true);
    expect(s.deck.addFromLibrary({ id: "over", name: "x", url: "u" })).toBe(false);
    expect(s.deck.addFiles([new File(["x"], "c.mp4", { type: "video/mp4" })])).toBe(0);
  });

  it("shows saved items whose file is gone as missing, and keeps them in the saved list", async () => {
    const s = setup();
    s.persistence.load.mockResolvedValueOnce({
      layout: { videos: [{ assetId: "gone", name: "Old", volume: 1 }], loop: true },
      assets: {},
      missing: ["gone"],
    });
    await s.deck.ensureLoaded();
    expect(s.deck.getState()).toMatchObject({ loop: true });
    expect(s.deck.getState().videos[0]).toMatchObject({ saveState: "missing", url: null });
    s.deck.setLoop(false);
    await s.deck.flushSave();
    expect(s.persistence.save).toHaveBeenCalledWith({ videos: [{ assetId: "gone", name: "Old", volume: 1 }], loop: false });
  });
});
