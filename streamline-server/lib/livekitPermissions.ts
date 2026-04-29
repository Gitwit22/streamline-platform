// NOTE: LiveKit's JS client (`livekit-client`) represents Track.Source as
// string literals like "camera" and "microphone".
//
// The server SDK exposes protobuf numeric enums (e.g. TrackSource.CAMERA === 1).
// We intentionally emit *string* sources here so UI code (and LiveKit Components)
// can reliably compare `canPublishSources` against `Track.Source.*`.

import type { PresenceMode } from "./presenceMode";
import { getPresencePolicy } from "./presenceMode";

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
 * Apply presence-mode restrictions on top of the base role grant.
 * Invisible mode disables publish, screen-share, and data (chat)
 * capabilities while preserving subscribe so the participant can
 * still monitor the room.
 */
export function applyPresenceModeToGrant(
  base: LiveKitGrant,
  mode: PresenceMode,
): LiveKitGrant {
  if (mode === "normal") return base;

  const policy = getPresencePolicy(mode);
  return {
    canSubscribe: base.canSubscribe, // always keep subscribe for monitoring
    canPublish: policy.canPublishAudio || policy.canPublishVideo || policy.canScreenShare,
    canPublishData: policy.canSendChat,
    canPublishSources: [],
  };
}
