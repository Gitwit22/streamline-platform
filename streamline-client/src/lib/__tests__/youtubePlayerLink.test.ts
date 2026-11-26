import { describe, expect, it, vi } from "vitest";
import { YouTubePlayerLink, youTubeErrorMessage, type ChannelLike } from "../youtubePlayerLink";

function setup(opts: { handle?: string | null; noAudio?: boolean; noHandleApi?: boolean; showsColor?: boolean } = {}) {
  const sent: Array<Record<string, unknown>> = [];
  let channel!: ChannelLike & { name: string };
  const video = {
    kind: "video",
    stop: vi.fn(),
    addEventListener: vi.fn(),
    ...(opts.noHandleApi ? {} : { getCaptureHandle: () => (opts.handle === null ? null : { handle: opts.handle ?? "sl-media-player:abc12345" }) }),
  };
  const audio = { kind: "audio", stop: vi.fn() };
  const getDisplayMedia = vi.fn<(opts: Record<string, unknown>) => Promise<MediaStream>>(async () => ({
    getVideoTracks: () => [video],
    getAudioTracks: () => (opts.noAudio ? [] : [audio]),
    getTracks: () => [video, audio],
  }) as unknown as MediaStream);
  const openWindow = vi.fn(() => ({}) as Window);
  const link = new YouTubePlayerLink({
    openWindow,
    createChannel: (name) => {
      channel = { name, postMessage: (m: unknown) => sent.push(m as Record<string, unknown>), close: () => {}, onmessage: null };
      return channel;
    },
    getDisplayMedia,
    playerUrl: "https://app.example/media-player.html",
    randomId: () => "abc12345",
    loadTimeoutMs: 50,
    verifyTimeoutMs: 100,
    // The captured picture shows the requested color only when it's really the player tab.
    createSampler: () => ({
      sample: async () => {
        const check = sent.filter((m) => m.type === "check").pop();
        if (!check || opts.showsColor === false) return [10, 10, 10];
        const [r, g, b] = String(check.color).match(/\d+/g)!.map(Number);
        return [r - 20, g + 10, b - 5]; // a bit off, like compressed video
      },
      close: () => {},
    }),
  });
  const fromPlayer = (m: Record<string, unknown>) => channel.onmessage?.({ data: { to: "room", ...m } });
  return { link, sent, openWindow, getDisplayMedia, fromPlayer, video, audio, channel: () => channel };
}

describe("YouTubePlayerLink", () => {
  it("opens the player tab with its channel id and becomes ready when the player is started", () => {
    const s = setup();
    const statuses: string[] = [];
    s.link.setEvents({ onStatus: (st) => statuses.push(st) });
    expect(s.link.open()).toBe(true);
    expect(s.openWindow).toHaveBeenCalledWith("https://app.example/media-player.html?ch=abc12345");
    expect(s.channel().name).toBe("sl-media-player:abc12345");
    s.fromPlayer({ type: "ready" });
    expect(statuses).toEqual(["opening", "ready"]);
  });

  it("reports a blocked pop-up", () => {
    const s = setup();
    s.openWindow.mockReturnValueOnce(null as unknown as Window);
    expect(s.link.open()).toBe(false);
  });

  it("captures the player tab (tab audio, no local echo) and confirms it's the right tab", async () => {
    const s = setup();
    s.link.open();
    await s.link.capture();
    const opts = s.getDisplayMedia.mock.calls[0][0] as Record<string, unknown>;
    expect(opts).toMatchObject({ preferCurrentTab: false, selfBrowserSurface: "exclude", systemAudio: "exclude" });
    expect((opts.audio as Record<string, unknown>).suppressLocalAudioPlayback).toBe(true);
    expect(s.link.status).toBe("connected");
    expect(s.link.videoTrack).toBe(s.video);
  });

  it("rejects another tab, and a capture without the tab's sound", async () => {
    const wrong = setup({ handle: "something-else" });
    await expect(wrong.link.capture()).rejects.toThrow(/not the player tab/);
    expect(wrong.video.stop).toHaveBeenCalled();
    // No capture handle exposed: the player tab's color decides.
    const otherTab = setup({ handle: null, showsColor: false });
    await expect(otherTab.link.capture()).rejects.toThrow(/not the player tab/);
    expect(otherTab.sent.some((m) => m.type === "check-done")).toBe(true);
    const silent = setup({ noAudio: true });
    await expect(silent.link.capture()).rejects.toThrow(/sound wasn't shared/);
    expect(silent.link.status).not.toBe("connected");
  });

  it("without a capture handle, confirms the tab by the color it shows", async () => {
    const s = setup({ noHandleApi: true });
    await s.link.capture();
    expect(s.link.status).toBe("connected");
    expect(s.sent.find((m) => m.type === "check")?.color).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    const nullHandle = setup({ handle: null });
    await nullHandle.link.capture();
    expect(nullHandle.link.status).toBe("connected");
  });

  it("explains a cancelled picker", async () => {
    const s = setup();
    s.getDisplayMedia.mockRejectedValueOnce(Object.assign(new Error("x"), { name: "NotAllowedError" }));
    await expect(s.link.capture()).rejects.toThrow(/cancelled/);
  });

  it("load() resolves with the title once playing; errors and timeouts reject", async () => {
    const s = setup();
    s.link.open();
    await s.link.capture();
    const p = s.link.load("dQw4w9WgXcQ", true);
    const msg = s.sent.find((m) => m.type === "load")!;
    expect(msg).toMatchObject({ to: "player", videoId: "dQw4w9WgXcQ", loop: true });
    s.fromPlayer({ type: "playing", req: msg.req, title: "Song" });
    await expect(p).resolves.toBe("Song");

    const p2 = s.link.load("dQw4w9WgXcQ", false);
    const msg2 = s.sent.filter((m) => m.type === "load")[1];
    s.fromPlayer({ type: "error", req: msg2.req, code: 150 });
    await expect(p2).rejects.toThrow(/owner doesn't allow/);

    await expect(s.link.load("dQw4w9WgXcQ", false)).rejects.toThrow(/didn't start/);
  });

  it("forwards state/time and disconnects when the tab closes", async () => {
    const s = setup();
    const onState = vi.fn();
    const onTime = vi.fn();
    const onDisconnected = vi.fn();
    s.link.setEvents({ onState, onTime, onDisconnected });
    s.link.open();
    await s.link.capture();
    s.fromPlayer({ type: "state", state: "ended", t: 30, d: 30 });
    s.fromPlayer({ type: "time", t: 5, d: 30 });
    expect(onState).toHaveBeenCalledWith("ended");
    expect(onTime).toHaveBeenLastCalledWith(5, 30);
    s.fromPlayer({ type: "closed" });
    expect(onDisconnected).toHaveBeenCalled();
    expect(s.video.stop).toHaveBeenCalled();
    expect(s.link.status).toBe("none");
  });

  it("refuses to load before it's connected", async () => {
    const s = setup();
    await expect(s.link.load("dQw4w9WgXcQ", false)).rejects.toThrow(/isn't connected/);
  });

  it("maps YouTube error codes to readable messages", () => {
    expect(youTubeErrorMessage(150)).toMatch(/owner/);
    expect(youTubeErrorMessage(100)).toMatch(/removed or is private/);
    expect(youTubeErrorMessage("weird")).toMatch(/couldn't play/);
  });
});
