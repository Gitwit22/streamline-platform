import crypto from "crypto";

/**
 * Waiting room: when a room has waitingRoomEnabled, people who would get an
 * on-stage token wait in rooms/{roomId}/waitingRoom/{entryId} until the host
 * or a cohost admits (or denies) them. Pure rules here; Firestore access in
 * lib/waitingRoom.ts; the gate in routes/roomGuestAccess.ts.
 */

/** An admission covers token refreshes/reconnects for as long as a room access token lives. */
export const ADMISSION_TTL_MS = 12 * 60 * 60 * 1000;
/** A denial expires too, so an old link reused another day isn't refused forever. */
export const DENIAL_TTL_MS = 12 * 60 * 60 * 1000;
/** Waiting entries without a poll for this long are hidden from the host (the person left). */
export const WAITING_PRESENCE_TTL_MS = 45_000;
export const WAITING_MAX_LIST = 100;

export type WaitingStatus = "waiting" | "admitted" | "denied";

export type WaitingEntry = {
  identity?: string | null;
  displayName?: string | null;
  status?: string | null;
  requestedAtMs?: number | null;
  lastSeenAtMs?: number | null;
  decidedAtMs?: number | null;
};

/** Reads the room flag; anything but an explicit true (old rooms) is off. */
export function isWaitingRoomEnabled(room: { waitingRoomEnabled?: unknown } | null | undefined): boolean {
  return !!room && room.waitingRoomEnabled === true;
}

/**
 * Who has to wait: everyone who would get an on-stage token, except the
 * host / producers / platform-admin hosts and cohosts. Audience viewers
 * (subscribe-only) never wait.
 */
export function waitingRoomApplies(params: {
  enabled: boolean;
  isHostLike: boolean;
  isCohost: boolean;
  role: string;
}): boolean {
  if (!params.enabled) return false;
  if (params.isHostLike || params.isCohost) return false;
  const role = String(params.role || "").toLowerCase();
  if (role === "host" || role === "cohost" || role === "viewer") return false;
  return true;
}

export type AdmissionState = "admitted" | "denied" | "waiting" | "none";

/** What a stored entry means right now (expired decisions read as "none"). */
export function admissionState(entry: WaitingEntry | null | undefined, nowMs: number): AdmissionState {
  if (!entry) return "none";
  const decidedAt = typeof entry.decidedAtMs === "number" ? entry.decidedAtMs : null;
  if (entry.status === "admitted") {
    return decidedAt !== null && nowMs - decidedAt < ADMISSION_TTL_MS ? "admitted" : "none";
  }
  if (entry.status === "denied") {
    return decidedAt !== null && nowMs - decidedAt < DENIAL_TTL_MS ? "denied" : "none";
  }
  if (entry.status === "waiting") return "waiting";
  return "none";
}

export type VisibleWaitingEntry = { id: string; displayName: string; waitingSince: number };

/** People still waiting (polled recently), oldest first, for the host's list. */
export function visibleWaitingEntries(
  entries: Array<WaitingEntry & { id: string }>,
  nowMs: number,
  ttlMs: number = WAITING_PRESENCE_TTL_MS,
): VisibleWaitingEntry[] {
  const cutoff = nowMs - ttlMs;
  return entries
    .filter((e) => e && e.status === "waiting")
    .filter((e) => typeof e.lastSeenAtMs === "number" && e.lastSeenAtMs >= cutoff)
    .map((e) => ({
      id: e.id,
      displayName: String(e.displayName || "").trim() || "Guest",
      waitingSince: typeof e.requestedAtMs === "number" ? e.requestedAtMs : (e.lastSeenAtMs as number),
    }))
    .sort((a, b) => a.waitingSince - b.waitingSince)
    .slice(0, WAITING_MAX_LIST);
}

/** Doc id for one identity: hashed so identities never become raw Firestore ids. */
export function waitingEntryId(identity: string): string {
  return crypto.createHash("sha256").update(`wr:${String(identity)}`).digest("base64url").slice(0, 32);
}

/** Entry ids arriving in URLs: exactly what waitingEntryId produces. */
export function isValidWaitingEntryId(raw: unknown): raw is string {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{32}$/.test(raw);
}
