import { TrackSource } from "livekit-server-sdk";

// VideoGrant-compatible return type (used for LiveKit token grants)
export type LiveKitGrant = {
  canSubscribe: boolean;
  canPublish: boolean;
  canPublishData: boolean;
  canPublishSources: TrackSource[];
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

  const sources: TrackSource[] = [];
  if (p.canPublishAudio) sources.push(TrackSource.MICROPHONE);
  if (p.canPublishVideo) sources.push(TrackSource.CAMERA);
  if (p.canScreenShare) {
    sources.push(TrackSource.SCREEN_SHARE);
    sources.push(TrackSource.SCREEN_SHARE_AUDIO);
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
  let canPublishSources: TrackSource[] = [];

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
      canPublishSources = [TrackSource.MICROPHONE, TrackSource.CAMERA];
      break;
    }
    case "cohost":
    case "host":
    default: {
      canPublish = true;
      canPublishData = true;
      canPublishSources = [
        TrackSource.MICROPHONE,
        TrackSource.CAMERA,
        TrackSource.SCREEN_SHARE,
        TrackSource.SCREEN_SHARE_AUDIO,
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
