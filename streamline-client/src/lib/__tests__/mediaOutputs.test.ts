import { describe, expect, it, vi } from "vitest";
import { RoomEvent, Track } from "livekit-client";
import { publishCapabilities, publishOutput, type LkLocalTrack, type LkPublication, type LkRoom } from "../mediaOutputs";

// ---- a fake that mirrors the LiveKit LocalVideoTrack rules mediaOutputs relies on ----
//  - replaceTrack(t, userProvided): stops the old track only when !userProvided
//  - mute(): stops a camera track unless it is user-provided
//  - unmute(): re-acquires the camera unless user-provided (not needed here)

let sidSeq = 0;
function mst(label: string) {
  const t = {
    label,
    readyState: "live" as "live" | "ended",
    stop: vi.fn(() => {
      t.readyState = "ended";
    }),
  };
  return t as unknown as MediaStreamTrack & { stop: ReturnType<typeof vi.fn>; label: string };
}

class FakeTrack implements LkLocalTrack {
  providedByUser = false;
  constructor(
    public mediaStreamTrack: MediaStreamTrack,
    private pub: FakePub,
    private room: FakeRoom,
  ) {}
  replaceTrack = vi.fn(async (t: MediaStreamTrack, userProvided = true) => {
    this.providedByUser = userProvided;
    const old = this.mediaStreamTrack;
    if (!this.providedByUser && old !== t) old.stop();
    this.mediaStreamTrack = t;
  });
  mute = vi.fn(async () => {
    if (this.pub.isMuted) return;
    if (!this.providedByUser) this.mediaStreamTrack.stop();
    this.pub.isMuted = true;
    this.room.emit(RoomEvent.TrackMuted, this.pub);
  });
  unmute = vi.fn(async () => {
    if (!this.pub.isMuted) return;
    this.pub.isMuted = false;
    this.room.emit(RoomEvent.TrackUnmuted, this.pub);
  });
}

class FakePub implements LkPublication {
  trackSid = `TR_${++sidSeq}`;
  isMuted = false;
  track?: FakeTrack;
  constructor(public source: Track.Source) {}
}

class FakeRoom implements LkRoom {
  handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  pubs: FakePub[] = [];
  localParticipant = {
    permissions: undefined as { canPublish?: boolean; canPublishSources?: number[] } | undefined,
    isScreenShareEnabled: false,
    getTrackPublication: (s: Track.Source) => this.pubs.find((p) => p.source === s),
    publishTrack: vi.fn(async (t: MediaStreamTrack, o: Record<string, unknown>) => {
      const pub = new FakePub(o.source as Track.Source);
      pub.track = new FakeTrack(t, pub, this);
      pub.track.providedByUser = true;
      this.pubs.push(pub);
      return pub;
    }),
    unpublishTrack: vi.fn(async (t: unknown, stop?: boolean) => {
      const pub = this.pubs.find((p) => p.track === t || p.track?.mediaStreamTrack === t);
      if (!pub) return;
      this.pubs = this.pubs.filter((p) => p !== pub);
      if (stop) pub.track!.mediaStreamTrack.stop();
      this.emit(RoomEvent.LocalTrackUnpublished, pub);
    }),
  };
  on(e: RoomEvent, fn: (...a: never[]) => void) {
    if (!this.handlers.has(e)) this.handlers.set(e, new Set());
    this.handlers.get(e)!.add(fn as (...a: unknown[]) => void);
  }
  off(e: RoomEvent, fn: (...a: never[]) => void) {
    this.handlers.get(e)?.delete(fn as (...a: unknown[]) => void);
  }
  emit(e: RoomEvent, ...a: unknown[]) {
    for (const fn of [...(this.handlers.get(e) || [])]) fn(...a);
  }
  /** A camera publication like LiveKit's (device track, LiveKit-owned). */
  withCamera(on: boolean) {
    const pub = new FakePub(Track.Source.Camera);
    const cam = mst("camera");
    pub.track = new FakeTrack(cam, pub, this);
    if (!on) {
      cam.stop();
      pub.isMuted = true;
    }
    this.pubs.push(pub);
    return { pub, cam };
  }
}

const sources = (...s: Track.Source[]) => s.map((x) => Track.sourceToProto(x) as unknown as number);

describe("publishCapabilities", () => {
  it("allows everything when permissions aren't known or list no sources", () => {
    const r = new FakeRoom();
    expect(publishCapabilities(r.localParticipant)).toEqual({ stage: true, box: true, sound: true });
    r.localParticipant.permissions = { canPublish: true, canPublishSources: [] };
    expect(publishCapabilities(r.localParticipant)).toEqual({ stage: true, box: true, sound: true });
  });
  it("follows the token's sources (guest without screen share)", () => {
    const r = new FakeRoom();
    r.localParticipant.permissions = { canPublish: true, canPublishSources: sources(Track.Source.Microphone, Track.Source.Camera) };
    expect(publishCapabilities(r.localParticipant)).toEqual({ stage: false, box: true, sound: false });
  });
  it("blocks everything for invisible hosts / audience (canPublish false)", () => {
    const r = new FakeRoom();
    r.localParticipant.permissions = { canPublish: false, canPublishSources: [] };
    expect(publishCapabilities(r.localParticipant)).toEqual({ stage: false, box: false, sound: false });
  });
});

describe("box output", () => {
  it("camera on: shows the video in the tile, then goes straight back to the live camera", async () => {
    const r = new FakeRoom();
    const { pub, cam } = r.withCamera(true);
    const video = mst("video");
    const audio = mst("audio");
    const h = await publishOutput(r, "box", video, audio, vi.fn());

    expect(pub.track!.mediaStreamTrack).toBe(video);
    expect(cam.stop).not.toHaveBeenCalled(); // camera keeps running underneath
    expect(r.pubs.find((p) => p.source === Track.Source.ScreenShareAudio)).toBeTruthy();
    expect(r.pubs.some((p) => p.source === Track.Source.ScreenShare)).toBe(false); // screen share untouched

    await h.release();
    expect(pub.track!.mediaStreamTrack).toBe(cam);
    expect(pub.track!.providedByUser).toBe(false); // LiveKit owns the camera again
    expect(pub.isMuted).toBe(false);
    expect(cam.readyState).toBe("live");
    expect(r.pubs.some((p) => p.source === Track.Source.ScreenShareAudio)).toBe(false);
  });

  it("camera off: unmutes the tile for the video, then returns to the name tile", async () => {
    const r = new FakeRoom();
    const { pub, cam } = r.withCamera(false);
    const video = mst("video");
    const h = await publishOutput(r, "box", video, null, vi.fn());
    expect(pub.isMuted).toBe(false);
    expect(pub.track!.mediaStreamTrack).toBe(video);

    await h.release();
    expect(pub.isMuted).toBe(true);
    expect(pub.track!.mediaStreamTrack).toBe(cam);
    expect(pub.track!.providedByUser).toBe(false); // the camera button re-acquires the device later
  });

  it("no camera publication yet: publishes the video as the camera, then removes it", async () => {
    const r = new FakeRoom();
    const video = mst("video");
    const h = await publishOutput(r, "box", video, null, vi.fn());
    expect(r.pubs[0].source).toBe(Track.Source.Camera);
    await h.release();
    expect(r.pubs).toHaveLength(0);
  });

  it("turning the camera off during the video stops it and leaves the camera off (light off)", async () => {
    const r = new FakeRoom();
    const { pub, cam } = r.withCamera(true);
    const onStopped = vi.fn();
    await publishOutput(r, "box", mst("video"), null, onStopped);
    await pub.track!.mute(); // control bar camera button
    await vi.waitFor(() => expect(onStopped).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(pub.track!.mediaStreamTrack).toBe(cam));
    expect(pub.isMuted).toBe(true);
    expect(cam.stop).toHaveBeenCalled();
    expect(pub.track!.providedByUser).toBe(false);
  });

  it("swaps the picture for the next playlist item without leaving the box", async () => {
    const r = new FakeRoom();
    const { pub, cam } = r.withCamera(true);
    const onStopped = vi.fn();
    const h = await publishOutput(r, "box", mst("v1"), null, onStopped);
    const v2 = mst("v2");
    await h.replaceVideo(v2);
    expect(pub.track!.mediaStreamTrack).toBe(v2);
    expect(onStopped).not.toHaveBeenCalled();
    await h.release();
    expect(pub.track!.mediaStreamTrack).toBe(cam);
  });

  it("a camera device switch during the video ends it and keeps the new camera", async () => {
    vi.useFakeTimers();
    try {
      const r = new FakeRoom();
      const { pub, cam } = r.withCamera(true);
      const onStopped = vi.fn();
      await publishOutput(r, "box", mst("video"), null, onStopped);
      const newCam = mst("camera2");
      pub.track!.mediaStreamTrack = newCam; // LiveKit restartTrack() with another device
      await vi.advanceTimersByTimeAsync(600);
      expect(onStopped).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => expect(pub.track!.providedByUser).toBe(false));
      expect(pub.track!.mediaStreamTrack).toBe(newCam);
      expect(cam.stop).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends the picture only when the role can't publish screen-share audio, and says so", async () => {
    const r = new FakeRoom();
    r.localParticipant.permissions = { canPublish: true, canPublishSources: sources(Track.Source.Microphone, Track.Source.Camera) };
    r.withCamera(true);
    const h = await publishOutput(r, "box", mst("video"), mst("audio"), vi.fn());
    expect(r.pubs.some((p) => p.source === Track.Source.ScreenShareAudio)).toBe(false);
    expect(h.notice).toMatch(/only the picture/);
  });
});

describe("stage output", () => {
  it("publishes a screen share + audio and removes both on release", async () => {
    const r = new FakeRoom();
    const h = await publishOutput(r, "stage", mst("video"), mst("audio"), vi.fn());
    expect(r.pubs.map((p) => p.source).sort()).toEqual([Track.Source.ScreenShare, Track.Source.ScreenShareAudio].sort());
    await h.release();
    expect(r.pubs).toHaveLength(0);
  });

  it("reports when something else unpublishes it (control bar Stop sharing)", async () => {
    const r = new FakeRoom();
    const onStopped = vi.fn();
    await publishOutput(r, "stage", mst("video"), mst("audio"), onStopped);
    const share = r.pubs.find((p) => p.source === Track.Source.ScreenShare)!;
    await r.localParticipant.unpublishTrack(share.track, true);
    expect(onStopped).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(r.pubs).toHaveLength(0));
  });

  it("undoes a half-finished publish", async () => {
    const r = new FakeRoom();
    r.localParticipant.publishTrack
      .mockImplementationOnce(async (t: MediaStreamTrack, o: Record<string, unknown>) => {
        const pub = new FakePub(o.source as Track.Source);
        pub.track = new FakeTrack(t, pub, r);
        r.pubs.push(pub);
        return pub;
      })
      .mockRejectedValueOnce(new Error("not allowed"));
    await expect(publishOutput(r, "stage", mst("video"), mst("audio"), vi.fn())).rejects.toThrow("not allowed");
    expect(r.pubs).toHaveLength(0);
  });
});
