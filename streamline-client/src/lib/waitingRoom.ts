/**
 * Waiting room (host admits people), client side. The server decides who
 * waits and who is admitted (streamline-server/lib/waitingRoomPure.ts); these
 * helpers only read its answers.
 */

/** How often a queued guest asks /token again (each ask also keeps them on the host's list). */
export const WAITING_ROOM_POLL_MS = 4000;
/** How often the host's open Dashboard refreshes the queue. */
export const WAITING_ROOM_LIST_POLL_MS = 4000;

export const WAITING_ROOM_DENIED_MESSAGE = "The host didn't let you into this room.";

export type WaitingRoomGate = "waiting" | "denied";

/** What a failed /token answer means for the waiting room, or null if it's about something else. */
export function waitingRoomGateFromMint(status: number, code: string | null | undefined): WaitingRoomGate | null {
  const c = String(code || "").toLowerCase();
  if (status === 409 && c === "waiting_room") return "waiting";
  if (status === 403 && c === "waiting_room_denied") return "denied";
  return null;
}

export type WaitingRoomEntry = { id: string; displayName: string; waitingSince: number };

/** GET /api/rooms/:id/waiting-room -> a safe, sorted list. */
export function normalizeWaitingRoomList(data: unknown): { enabled: boolean; entries: WaitingRoomEntry[] } {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const raw = Array.isArray(d.entries) ? d.entries : [];
  const entries: WaitingRoomEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    if (typeof e.id !== "string" || !e.id) continue;
    entries.push({
      id: e.id,
      displayName: typeof e.displayName === "string" && e.displayName.trim() ? e.displayName.trim() : "Guest",
      waitingSince: typeof e.waitingSince === "number" && Number.isFinite(e.waitingSince) ? e.waitingSince : 0,
    });
  }
  entries.sort((a, b) => a.waitingSince - b.waitingSince);
  return { enabled: d.enabled === true, entries };
}

/** The waitingRoom part of GET /api/invites/room-status (absent on older servers). */
export function parseWaitingRoomStatus(data: unknown): { enabled: boolean; count: number } {
  const wr = data && typeof data === "object" ? (data as Record<string, unknown>).waitingRoom : null;
  if (!wr || typeof wr !== "object") return { enabled: false, count: 0 };
  const w = wr as Record<string, unknown>;
  const count = typeof w.count === "number" && Number.isFinite(w.count) && w.count > 0 ? Math.floor(w.count) : 0;
  return { enabled: w.enabled === true, count };
}

/** Host badge text, or null when nobody is waiting. */
export function waitingRoomPillText(count: number): string | null {
  if (!(count > 0)) return null;
  return count === 1 ? "1 person waiting to join" : `${count} people waiting to join`;
}
