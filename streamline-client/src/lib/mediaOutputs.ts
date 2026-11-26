/**
 * Where a Media-panel video plays (lib/mediaVideo.ts), on the LiveKit side.
 * Used by MediaVideoBridge; kept free of React so it can be unit-tested.
 *
 *  stage – published as the participant's screen share (+ screen-share
 *          audio): layouts and every output show it like any share.
 *  box   – replaces the picture in the participant's own camera tile. The
 *          real camera keeps running underneath (replaceTrack with
 *          userProvided=true never stops it), so when the video ends the
 *          tile goes straight back to the live camera, or back to the name
 *          tile if the camera was off. Screen sharing is never touched.
 *
 * Sound is published as screen-share audio in both cases (the host hears it
 * through the mixer's Screen share channel, MixerBridge). Roles that can't
 * publish screen-share audio get the picture only, and are told so.
 */
import { AudioPresets, RoomEvent, Track } from "livekit-client";

export type PlayTarget = "box" | "stage";

export type PublishCapabilities = {
  stage: boolean;
  box: boolean;
  /** Video sound can be sent (screen-share audio is allowed). */
  sound: boolean;
};

/** Removes / restores what publish() did; replaceVideo swaps the picture in place (playlist advance). */
export interface OutputHandle {
  replaceVideo(video: MediaStreamTrack): Promise<void>;
  release(): Promise<void>;
  /** Shown to the host while this output is live (e.g. sound not allowed). */
  notice: string | null;
}

// ---- structural LiveKit types (the parts used here) -------------------------

export type LkLocalTrack = {
  mediaStreamTrack: MediaStreamTrack;
  replaceTrack(track: MediaStreamTrack, userProvided?: boolean): Promise<unknown>;
  mute(): Promise<unknown>;
  unmute(): Promise<unknown>;
};
export type LkPublication = { trackSid: string; isMuted: boolean; track?: LkLocalTrack };
export type LkLocalParticipant = {
  getTrackPublication(source: Track.Source): LkPublication | undefined;
  publishTrack(track: MediaStreamTrack, options: Record<string, unknown>): Promise<LkPublication>;
  unpublishTrack(track: MediaStreamTrack | LkLocalTrack, stopOnUnpublish?: boolean): Promise<unknown>;
  isScreenShareEnabled: boolean;
  permissions?: { canPublish?: boolean; canPublishSources?: number[] } | undefined;
};
export type LkRoom = {
  localParticipant: LkLocalParticipant;
  on(event: RoomEvent, fn: (...args: never[]) => void): unknown;
  off(event: RoomEvent, fn: (...args: never[]) => void): unknown;
};

// ---- capabilities ------------------------------------------------------------

function mayPublish(lp: LkLocalParticipant, source: Track.Source): boolean {
  const p = lp.permissions;
  if (!p) return true; // not known yet: LiveKit rejects the publish if it isn't allowed
  if (p.canPublish === false) return false;
  const list = p.canPublishSources;
  return !list || list.length === 0 || list.includes(Track.sourceToProto(source) as unknown as number);
}

export function publishCapabilities(lp: LkLocalParticipant): PublishCapabilities {
  return {
    stage: mayPublish(lp, Track.Source.ScreenShare),
    box: mayPublish(lp, Track.Source.Camera),
    sound: mayPublish(lp, Track.Source.ScreenShareAudio),
  };
}

const NO_SOUND_NOTICE = "Your role can't send video sound, so only the picture plays. Ask the host to allow screen sharing.";

// ---- shared audio ---------------------------------------------------------------

async function publishSound(lp: LkLocalParticipant, audio: MediaStreamTrack | null, name: string): Promise<LkPublication | null> {
  if (!audio || !mayPublish(lp, Track.Source.ScreenShareAudio)) return null;
  return lp.publishTrack(audio, {
    source: Track.Source.ScreenShareAudio,
    name,
    audioPreset: AudioPresets.musicHighQualityStereo,
    dtx: false,
    red: false,
  });
}

async function unpublishQuietly(lp: LkLocalParticipant, pub: LkPublication | null) {
  if (!pub?.track) return;
  try {
    await lp.unpublishTrack(pub.track, true);
  } catch {
    // already gone (disconnect)
  }
}

/**
 * Publishes a video to `target`. `onStopped` runs once if something else
 * ends it (control bar, host controls, camera toggle, device switch, disconnect).
 */
export async function publishOutput(
  room: LkRoom,
  target: PlayTarget,
  video: MediaStreamTrack,
  audio: MediaStreamTrack | null,
  onStopped: () => void,
): Promise<OutputHandle> {
  return target === "stage" ? publishStage(room, video, audio, onStopped) : publishBox(room, video, audio, onStopped);
}

// ---- stage -------------------------------------------------------------------------

async function publishStage(
  room: LkRoom,
  video: MediaStreamTrack,
  audio: MediaStreamTrack | null,
  onStopped: () => void,
): Promise<OutputHandle> {
  const lp = room.localParticipant;
  let videoPub: LkPublication | null = null;
  let soundPub: LkPublication | null = null;
  let releasing = false;

  const onUnpublished = (pub: LkPublication) => {
    if (releasing || (pub.trackSid !== videoPub?.trackSid && pub.trackSid !== soundPub?.trackSid)) return;
    void handle.release();
    onStopped();
  };

  const handle: OutputHandle = {
    notice: null,
    async replaceVideo(next) {
      await videoPub?.track?.replaceTrack(next, true);
    },
    async release() {
      if (releasing) return;
      releasing = true;
      room.off(RoomEvent.LocalTrackUnpublished, onUnpublished as never);
      await unpublishQuietly(lp, videoPub);
      await unpublishQuietly(lp, soundPub);
    },
  };

  try {
    videoPub = await lp.publishTrack(video, {
      source: Track.Source.ScreenShare,
      name: "stage-video",
      degradationPreference: "maintain-framerate",
    });
    soundPub = await publishSound(lp, audio, "stage-video-audio");
  } catch (e) {
    await handle.release();
    throw e;
  }
  if (audio && !soundPub) handle.notice = NO_SOUND_NOTICE;
  room.on(RoomEvent.LocalTrackUnpublished, onUnpublished as never);
  return handle;
}

// ---- box (own camera tile) ---------------------------------------------------------

const BOX_WATCH_MS = 500;

async function publishBox(
  room: LkRoom,
  video: MediaStreamTrack,
  audio: MediaStreamTrack | null,
  onStopped: () => void,
): Promise<OutputHandle> {
  const lp = room.localParticipant;
  const camPub = lp.getTrackPublication(Track.Source.Camera);
  const camTrack = camPub?.track;

  // What to restore: the camera's own track and whether it was on.
  const original = camTrack ? camTrack.mediaStreamTrack : null;
  const cameraWasOn = !!camPub && !camPub.isMuted && original?.readyState === "live";

  let boxPub: LkPublication | null = null; // our own camera publication (no camera publication existed)
  let soundPub: LkPublication | null = null;
  let current = video;
  let internal = 0; // >0 while we mute/unmute/replace ourselves
  let released = false;
  let watch: ReturnType<typeof setInterval> | null = null;

  const pubInUse = (): LkPublication | null => (camTrack ? camPub! : boxPub);

  const stopFromOutside = () => {
    if (released) return;
    void handle.release();
    onStopped();
  };
  // Camera button / host controls mute the tile → the video stops.
  const onMuted = (pub: LkPublication) => {
    if (internal === 0 && pub && pub.trackSid === pubInUse()?.trackSid) stopFromOutside();
  };
  const onUnpublished = (pub: LkPublication) => {
    if (internal === 0 && pub && (pub.trackSid === pubInUse()?.trackSid || pub.trackSid === soundPub?.trackSid)) stopFromOutside();
  };

  const internally = async <T>(fn: () => Promise<T>): Promise<T> => {
    internal += 1;
    try {
      return await fn();
    } finally {
      internal -= 1;
    }
  };

  const handle: OutputHandle = {
    notice: null,
    async replaceVideo(next) {
      const track = pubInUse()?.track;
      if (!track) throw new Error("Your video box is no longer available.");
      await internally(() => track.replaceTrack(next, true));
      current = next;
    },
    async release() {
      if (released) return;
      released = true;
      if (watch) clearInterval(watch);
      room.off(RoomEvent.TrackMuted, onMuted as never);
      room.off(RoomEvent.LocalTrackUnpublished, onUnpublished as never);
      await internally(async () => {
        await unpublishQuietly(lp, soundPub);
        if (!camTrack) {
          // We created the camera publication: removing it brings back the name tile.
          await unpublishQuietly(lp, boxPub);
          return;
        }
        try {
          await restoreCamera(camPub!, camTrack, original, cameraWasOn, current);
        } catch (e) {
          console.warn("[media] couldn't restore the camera", e);
        }
      });
    },
  };

  try {
    await internally(async () => {
      if (camTrack) {
        await camTrack.replaceTrack(video, true);
        // Camera was off: show the video (a user-provided track isn't re-acquired on unmute).
        if (camPub!.isMuted) await camTrack.unmute();
      } else {
        boxPub = await lp.publishTrack(video, { source: Track.Source.Camera, name: "camera" });
      }
      soundPub = await publishSound(lp, audio, "box-video-audio");
    });
  } catch (e) {
    await handle.release();
    throw e;
  }
  if (audio && !soundPub) handle.notice = NO_SOUND_NOTICE;

  room.on(RoomEvent.TrackMuted, onMuted as never);
  room.on(RoomEvent.LocalTrackUnpublished, onUnpublished as never);
  // A camera device switch / restart swaps the tile's track without an event we can hook: stop then.
  watch = setInterval(() => {
    if (internal === 0 && pubInUse()?.track && pubInUse()!.track!.mediaStreamTrack !== current) stopFromOutside();
  }, BOX_WATCH_MS);
  return handle;
}

/**
 * Puts the camera tile back: the live camera if it was on (and still is),
 * otherwise a muted camera so the name tile shows. Always hands the track
 * back to LiveKit (userProvided=false) so the camera button and device
 * switching behave normally afterwards.
 */
async function restoreCamera(
  pub: LkPublication,
  track: LkLocalTrack,
  original: MediaStreamTrack | null,
  cameraWasOn: boolean,
  ours: MediaStreamTrack,
): Promise<void> {
  const nowTrack = track.mediaStreamTrack;
  if (nowTrack !== ours) {
    // LiveKit already put a new camera track in (device switch / restart):
    // keep it, just give ownership back, and release the old camera.
    await track.replaceTrack(nowTrack, false);
    if (original && original !== nowTrack && original.readyState === "live") original.stop();
    return;
  }
  const keepOn = cameraWasOn && !pub.isMuted && original?.readyState === "live";
  if (keepOn && original) {
    await track.replaceTrack(original, false);
    return;
  }
  // Camera should end up off (it was off, or was turned off during the video).
  if (!pub.isMuted) await track.mute();
  if (original) {
    await track.replaceTrack(original, false);
    if (original.readyState === "live") original.stop(); // camera light off
  }
}
