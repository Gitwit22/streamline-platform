/**
 * A room may be bound to a saved embed (channel) only when both belong to the
 * same owner (pure). Binding a room to a channel lets HLS start point the
 * channel's public page (/live/:savedEmbedId) at that room, so without this
 * check anyone could take over another user's channel (audit P0-2).
 */
export function channelBindingAllowed(embed: any, roomOwnerId: unknown): boolean {
  if (!embed || typeof embed !== "object") return false;
  if (embed.isDeleted === true || embed.archived === true) return false;
  const embedOwner = typeof embed.ownerId === "string" ? embed.ownerId.trim() : "";
  const roomOwner = typeof roomOwnerId === "string" ? roomOwnerId.trim() : "";
  return !!embedOwner && embedOwner === roomOwner;
}
