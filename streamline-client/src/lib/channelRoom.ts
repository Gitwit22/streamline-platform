/**
 * Which room a channel viewer page (/live/:savedEmbedId) plays (audit P2).
 * activeRoomId is null until the channel's first HLS start, so a page opened
 * before then falls back to the home room (the server's playback endpoint
 * does the same), and a page that is not playing follows the channel when the
 * host goes live from another room.
 */
export function channelPlayRoomId(meta: { activeRoomId?: unknown; homeRoomId?: unknown } | null | undefined): string {
  const active = typeof meta?.activeRoomId === "string" ? meta.activeRoomId.trim() : "";
  if (active) return active;
  return typeof meta?.homeRoomId === "string" ? meta.homeRoomId.trim() : "";
}

/** Switch only when nothing is playing, so a live viewer is never cut off. */
export function shouldSwitchChannelRoom(currentRoomId: string, nextRoomId: string, currentlyLive: boolean): boolean {
  if (!nextRoomId || nextRoomId === currentRoomId) return false;
  return !currentRoomId || !currentlyLive;
}
