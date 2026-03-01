// NOTE: LiveKit's JS client (`livekit-client`) represents Track.Source as
// string literals like "camera" and "microphone".
//
// The server SDK (v2.x) exposes protobuf numeric enums (e.g. TrackSource.CAMERA === 1).
// `AccessToken.toJwt()` calls an internal `trackSourceToString()` that only
// accepts ***numeric*** TrackSource values — passing plain strings like "camera"
// throws: "Cannot convert TrackSource camera to string".
//
// We keep string literals as the canonical type for UI-facing code, and provide
// `toSdkSources()` to convert them to SDK enums right before `addGrant()`.

export type LiveKitTrackSource =
  | "camera"
  | "microphone"
  | "screen_share"
  | "screen_share_audio";

// VideoGrant-compatible return type (used for LiveKit token grants)
export type LiveKitGrant = {
  canSubscribe: boolean;
  canPublish: boolean;
  canPublishData: boolean;
  canPublishSources: LiveKitTrackSource[];
};

// Narrow type: just the realtime flags that matter for LiveKit permissions
export type RealtimePreset = {
  canPublishAudio?: boolean;
  canPublishVideo?: boolean;
  canScreenShare?: boolean;
  canSubscribe?: boolean;
  canSendData?: boolean; // chat/data
};

// Convert preset-style flags into LiveKit grant format
export function presetToLiveKitGrant(p: RealtimePreset): LiveKitGrant {
  const canPublish = !!p.canPublishAudio || !!p.canPublishVideo || !!p.canScreenShare;

  const sources: LiveKitTrackSource[] = [];
  if (p.canPublishAudio) sources.push("microphone");
  if (p.canPublishVideo) sources.push("camera");
  if (p.canScreenShare) {
    sources.push("screen_share");
    sources.push("screen_share_audio");
  }

  return {
    canSubscribe: p.canSubscribe ?? true,
    canPublish,
    canPublishData: p.canSendData ?? true,
    canPublishSources: sources,
  };
}

// Optional coarse role mapping so role-based grants can share the same truth
export function roleToParticipantPermission(
  role: "viewer" | "guest" | "participant" | "cohost" | "host",
): LiveKitGrant {
  const canSubscribe = true;
  let canPublish = false;
  let canPublishData = false;
  let canPublishSources: LiveKitTrackSource[] = [];

  switch (role) {
    case "viewer": {
      // Reserved for HLS watch-only (future)
      canPublish = false;
      canPublishData = false;
      canPublishSources = [];
      break;
    }
    case "guest":
    case "participant": {
      // Invite-based guests and authenticated participants both get mic+cam
      canPublish = true;
      canPublishData = true;
      canPublishSources = ["microphone", "camera"];
      break;
    }
    case "cohost":
    case "host":
    default: {
      canPublish = true;
      canPublishData = true;
      canPublishSources = [
        "microphone",
        "camera",
        "screen_share",
        "screen_share_audio",
      ];
      break;
    }
  }

  return {
    canSubscribe,
    canPublish,
    canPublishData,
    canPublishSources,
  };
}

/**
 * Map our string-literal track sources to the livekit-server-sdk TrackSource
 * enum values.  `AccessToken.toJwt()` (v2.x) requires numeric enum values;
 * passing plain strings throws at runtime.
 *
 * Usage:
 *   import { toSdkSources } from "../lib/livekitPermissions";
 *   at.addGrant({ room, ...grant, canPublishSources: toSdkSources(grant.canPublishSources) });
 */
const SDK_SOURCE_MAP: Record<LiveKitTrackSource, number> = {
  camera: 1,          // TrackSource.CAMERA
  microphone: 2,      // TrackSource.MICROPHONE
  screen_share: 3,    // TrackSource.SCREEN_SHARE
  screen_share_audio: 4, // TrackSource.SCREEN_SHARE_AUDIO
};

export function toSdkSources(sources: LiveKitTrackSource[]): number[] {
  return sources.map((s) => SDK_SOURCE_MAP[s]);
}
