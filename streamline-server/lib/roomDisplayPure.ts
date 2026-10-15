/**
 * Room display name (pure). rooms/{roomId}.displayName is what people SEE
 * (room header, join page, invite page) and what the owner can rename.
 *
 * It is deliberately a separate field: roomName / name / livekitRoomName are
 * identity data (LiveKit room, room-access-token claims, legacy invite
 * matching, resolve-by-name in lib/roomIdentity.ts) and must never change
 * when a room is renamed.
 */
import { sanitizeDisplayName } from "./sanitizeDisplayName";

export const ROOM_DISPLAY_NAME_MAX = 80;

/** Name to show for a room: its display name, else the names it was created with. */
export function roomDisplayName(room: any, roomId: string): string {
  const pick = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return (
    pick(room?.displayName) || pick(room?.roomName) || pick(room?.name) || pick(room?.livekitRoomName) || roomId
  );
}

// Flat shape (no strictNullChecks on the server).
export type DisplayNameParse = { ok: boolean; value?: string | null; details?: string };

/**
 * Validates a rename. "" / null clears the custom name (the room shows its
 * original name again). Same character rules as room creation.
 */
export function parseDisplayNameInput(raw: unknown): DisplayNameParse {
  if (raw === null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, details: "displayName must be a string" };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  const cleaned = sanitizeDisplayName(trimmed).replace(/\s+/g, " ").trim();
  if (cleaned !== trimmed.replace(/\s+/g, " ")) {
    return { ok: false, details: "Use letters, numbers, spaces, - – ' and & only" };
  }
  if (cleaned.length > ROOM_DISPLAY_NAME_MAX) {
    return { ok: false, details: `displayName must be ${ROOM_DISPLAY_NAME_MAX} characters or less` };
  }
  return { ok: true, value: cleaned };
}
