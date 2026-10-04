// LiveKit capture/publish defaults derived from the host's effective media
// preset (see lib/mediaPresetLabels.ts).
import {
  LocalVideoTrack,
  ScreenSharePresets,
  Track,
  VideoPresets,
  type LocalParticipant,
  type Room,
  type RoomOptions,
  type ScreenShareCaptureOptions,
} from "livekit-client";
import { captureResolutionForPreset, type CaptureResolutionKey } from "./mediaPresetLabels";

export function captureResolutionFor(key: CaptureResolutionKey) {
  return key === "h1080" ? VideoPresets.h1080.resolution : VideoPresets.h720.resolution;
}

/**
 * Room options for a session. Must stay referentially/JSON stable for the
 * life of a LiveKitRoom: useLiveKitRoom recreates the Room when the options'
 * JSON changes, so callers compute this ONCE at mount.
 *
 * - videoCaptureDefaults: camera at 720p, or 1080p when the host's preset is
 *   1080p or higher (so the composite isn't upscaled).
 * - publishDefaults: simulcast on (viewers get lower layers), screen share
 *   encoded at 1080p30.
 * - adaptiveStream + dynacast: subscribers only pull the layer they render
 *   and publishers stop encoding unused layers.
 */
export function buildRoomOptions(presetId?: string | null): RoomOptions {
  const key = captureResolutionForPreset(presetId);
  return {
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: {
      resolution: captureResolutionFor(key),
    },
    publishDefaults: {
      simulcast: true,
      screenShareEncoding: ScreenSharePresets.h1080fps30.encoding,
    },
  };
}

function isSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /^((?!chrome|chromium|android|crios|fxios|edg).)*safari/i.test(ua);
}

/**
 * Screen-share capture options: 1080p30 with tab/system audio so the mixer's
 * screenShareBus receives audio. Audio processing is off (music/video audio,
 * not speech). Safari ignores system audio and captures low-res when a
 * resolution is forced, so it only gets audio.
 */
export function screenShareCaptureOptions(): ScreenShareCaptureOptions {
  const opts: ScreenShareCaptureOptions = {
    audio: {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
      channelCount: 2,
    },
    systemAudio: "include",
    selfBrowserSurface: "exclude",
    surfaceSwitching: "include",
  };
  if (!isSafari()) opts.resolution = ScreenSharePresets.h1080fps30.resolution;
  return opts;
}

type SetScreenShareEnabled = LocalParticipant["setScreenShareEnabled"];
const PATCHED = new WeakSet<LocalParticipant>();

/**
 * Make `setScreenShareEnabled(true)` without capture options (ControlBar /
 * VideoConference prefabs) use screenShareCaptureOptions(). Disabling and
 * callers passing their own options are untouched. Returns an undo function.
 */
export function patchScreenShareDefaults(lp: LocalParticipant): () => void {
  if (PATCHED.has(lp)) return () => {};
  const original: SetScreenShareEnabled = lp.setScreenShareEnabled.bind(lp);
  const patched: SetScreenShareEnabled = (enabled, options, publishOptions) =>
    original(enabled, enabled && options === undefined ? screenShareCaptureOptions() : options, publishOptions);
  lp.setScreenShareEnabled = patched;
  PATCHED.add(lp);
  return () => {
    lp.setScreenShareEnabled = original;
    PATCHED.delete(lp);
  };
}

/**
 * Apply a camera capture resolution after connect: update the room's capture
 * defaults (future camera enables) and restart a published camera that
 * captures below the target height, keeping the selected device.
 */
export function applyCameraCaptureDefault(room: Room, key: CaptureResolutionKey) {
  const resolution = captureResolutionFor(key);
  room.options.videoCaptureDefaults = { ...(room.options.videoCaptureDefaults || {}), resolution };
  const track = room.localParticipant?.getTrackPublication(Track.Source.Camera)?.track;
  if (!(track instanceof LocalVideoTrack) || track.isMuted) return;
  const settings = track.mediaStreamTrack?.getSettings?.() || {};
  const currentHeight = settings.height || 0;
  if (!currentHeight || currentHeight >= resolution.height) return;
  track
    .restartTrack({ resolution, ...(settings.deviceId ? { deviceId: settings.deviceId } : {}) })
    .catch((e) => console.warn("[captureDefaults] camera restart failed", e));
}
