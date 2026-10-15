/**
 * Naming for NEW rooms (pure).
 *
 * The LiveKit room name is identity: tokens grant `room: livekitRoomName`,
 * and egress, room metadata, remove-all and webhooks all address the room by
 * it. It must therefore be unique and server-generated: it is always the
 * Firestore roomId. A user-typed label is display-only (rooms/{id}.displayName,
 * see lib/roomDisplayPure.ts). Previously the typed label was used, so two
 * hosts who picked the same name shared one LiveKit room.
 *
 * Existing rooms keep the livekitRoomName they were created with.
 */
export function newRoomNaming(roomId: string, label: string | null | undefined): {
  livekitRoomName: string;
  displayName: string | undefined;
} {
  const display = typeof label === "string" ? label.trim() : "";
  return { livekitRoomName: roomId, displayName: display || undefined };
}
