export const usageLabels = {
  /** Monthly gated minutes: time actively streaming out (RTMP / HLS). */
  streamingMinutes: "Streaming minutes",
  /** @deprecated legacy key; the monthly bucket is now streaming minutes. */
  inRoomMinutes: "Streaming minutes",
  broadcastMinutes: "Broadcast minutes",
  destinationMinutes: "Destination minutes (analytics)",
  recordingMinutes: "Recording minutes",
} as const;

export const usageTooltips = {
  streamingMinutes:
    "Time your room is actively streaming out (RTMP multistream or HLS). Overlapping outputs count once; multiple destinations are not multiplied. Resets on the 1st of each month (UTC).",
  /** @deprecated legacy key */
  inRoomMinutes:
    "Time your room is actively streaming out (RTMP multistream or HLS). Having a room open without broadcasting does not count.",
  broadcastMinutes: "Time used for streaming to external platforms (RTMP/HLS).",
  destinationMinutes:
    "Stream time multiplied by the number of destinations. Shown for reference only; it does not count toward your monthly minutes.",
  recordingMinutes: "Time used for cloud recording. Tracked separately; recordings are limited by storage.",
} as const;
