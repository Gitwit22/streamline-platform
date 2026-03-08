import { computeEffectiveFeatureAccess } from "./effectiveFeatureAccess";

export const usageLabels = {
  inRoomMinutes: "In-room minutes",
  broadcastMinutes: "Broadcast minutes",
  recordingMinutes: "Recording minutes",
} as const;

export const usageTooltips = {
  inRoomMinutes: "Counts time people spend inside StreamLine rooms (per participant).",
  broadcastMinutes: "Counts time used for HLS/RTMP broadcasting (transcode/egress minutes).",
  recordingMinutes: "Counts time used for cloud recording.",
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
