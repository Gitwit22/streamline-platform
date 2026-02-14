import type { ParticipantPermission } from "livekit-server-sdk";

type PublishSource = "microphone" | "camera" | "screen_share" | "screen_share_audio";

// Narrow type: just the realtime flags that matter for LiveKit permissions
export type RealtimePreset = {
  canPublishAudio?: boolean;
  canPublishVideo?: boolean;
  canScreenShare?: boolean;
  canSubscribe?: boolean;
  canSendData?: boolean; // chat/data
};

// Convert preset-style flags into LiveKit ParticipantPermission
export function presetToParticipantPermission(p: RealtimePreset): ParticipantPermission {
  const canPublish = !!p.canPublishAudio || !!p.canPublishVideo || !!p.canScreenShare;

  const base = {
    canSubscribe: p.canSubscribe ?? true,
    canPublish,
    canPublishData: p.canSendData ?? true,
  } as ParticipantPermission;

  return base;
}

// Optional coarse role mapping so role-based grants can share the same truth
export function roleToParticipantPermission(
  role: "viewer" | "participant" | "cohost" | "host",
): ParticipantPermission {
  const canSubscribe = true;
  let canPublish = false;
  let canPublishData = false;
  let canPublishSources: PublishSource[] = [];

  switch (role) {
    case "viewer": {
      canPublish = false;
      canPublishData = false;
      canPublishSources = [];
      break;
    }
    case "participant": {
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
    // LiveKit expects string source names for permissions/grants.
    canPublishSources: canPublishSources as any,
  } as ParticipantPermission;
}
