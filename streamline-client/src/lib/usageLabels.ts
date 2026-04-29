import { computeEffectiveFeatureAccess } from "./effectiveFeatureAccess";

export const usageLabels = {
  inRoomMinutes: "Room minutes",
  broadcastMinutes: "Broadcast minutes",
  recordingMinutes: "Recording minutes",
} as const;

export const usageTooltips = {
  inRoomMinutes: "Time spent inside StreamLine rooms.",
  broadcastMinutes: "Time used for streaming to external platforms (RTMP/HLS).",
  recordingMinutes: "Time used for cloud recording.",
} as const;

export function getUsageGating(me: any): {
  canShowBroadcastMinutes: boolean;
} {
  const access = computeEffectiveFeatureAccess({
    effectiveEntitlements: me?.effectiveEntitlements,
    platformFlags: me?.platformFlags,
  });

  return {
    canShowBroadcastMinutes: access.usage.broadcastMinutes.visible,
  };
}
