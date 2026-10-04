import crypto from "crypto";

/**
 * Guest join-page presence: guests heartbeat POST /api/telemetry/guest every
 * ~20s while on the join page; hosts read the summary from
 * GET /api/invites/room-status. Entries without a heartbeat for
 * JOIN_PAGE_PRESENCE_TTL_MS stop counting.
 */
export const JOIN_PAGE_PRESENCE_TTL_MS = 60_000;
/** How long an "entered_room" signal keeps hasEnteredRoom true. */
export const ENTERED_ROOM_SIGNAL_TTL_MS = 15 * 60 * 1000;
export const JOIN_PAGE_MAX_NAMES = 10;

export type GuestPresenceStage = "join_page" | "entered_room" | "left";

export function parseGuestPresenceStage(raw: unknown): GuestPresenceStage | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "join_page" || v === "entered_room" || v === "left") return v;
  return null;
}

/** Room ids we accept from unauthenticated telemetry (Firestore doc id safe). */
export function isValidPresenceRoomId(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  const v = raw.trim();
  return v.length > 0 && v.length <= 128 && !v.includes("/") && v !== "." && v !== "..";
}

/**
 * Stable doc id for one guest: the identity when known, else a fingerprint.
 * Hashed so client-supplied values never become raw Firestore ids.
 */
export function joinPresenceKey(parts: { identity?: string | null; fallback?: string | null }): string {
  const identity = String(parts.identity || "").trim().slice(0, 200);
  const basis = identity ? `id:${identity}` : `fp:${String(parts.fallback || "").slice(0, 400)}`;
  return crypto.createHash("sha256").update(basis).digest("base64url").slice(0, 32);
}

export type JoinPagePresenceEntry = {
  stage?: string | null;
  displayName?: string | null;
  lastSeenAtMs?: number | null;
};

export type JoinPageSummary = {
  count: number;
  names: string[];
  /** Epoch ms of the most recent join-page heartbeat, or null. */
  lastSeenAt: number | null;
};

export function summarizeJoinPagePresence(
  entries: JoinPagePresenceEntry[],
  nowMs: number,
  ttlMs: number = JOIN_PAGE_PRESENCE_TTL_MS,
): JoinPageSummary {
  const cutoff = nowMs - ttlMs;
  const live = entries
    .filter((e) => e && e.stage === "join_page")
    .filter((e) => typeof e.lastSeenAtMs === "number" && e.lastSeenAtMs >= cutoff)
    .sort((a, b) => (b.lastSeenAtMs as number) - (a.lastSeenAtMs as number));

  const names: string[] = [];
  for (const e of live) {
    const n = String(e.displayName || "").trim();
    if (n && !names.includes(n)) names.push(n);
    if (names.length >= JOIN_PAGE_MAX_NAMES) break;
  }

  return {
    count: live.length,
    names,
    lastSeenAt: live.length ? (live[0].lastSeenAtMs as number) : null,
  };
}

/** True when any entry says a guest entered the room recently. */
export function hasRecentEnteredRoom(
  entries: JoinPagePresenceEntry[],
  nowMs: number,
  ttlMs: number = ENTERED_ROOM_SIGNAL_TTL_MS,
): boolean {
  const cutoff = nowMs - ttlMs;
  return entries.some(
    (e) => e && e.stage === "entered_room" && typeof e.lastSeenAtMs === "number" && e.lastSeenAtMs >= cutoff,
  );
}
