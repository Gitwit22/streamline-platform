// Pure helpers for the routed room page (creator/pages/Room.tsx): token
// response parsing, join-gate room info, disconnect classification and the
// share-link token store. Kept free of React/LiveKit imports so they are
// unit-testable.

import { getRoomAccessPermissions, type RoomAccessPermissions } from "./roomAccessClaims";

export const ROOM_PERMISSION_KEYS = [
  "canStream",
  "canRecord",
  "canDestinations",
  "canModerate",
  "canLayout",
  "canScreenShare",
  "canInvite",
  "canAnalytics",
  "canMuteGuests",
  "canRemoveGuests",
] as const;

export type RoomPermissionKey = (typeof ROOM_PERMISSION_KEYS)[number];
export type RoomPermissions = Record<RoomPermissionKey, boolean>;

/**
 * Permissions for this participant: the `permissions` object from the /token
 * response when present, otherwise decoded from the roomAccessToken (older
 * servers / missing field). Returns null when neither source has any.
 */
export function resolveRoomPermissions(
  fromResponse: unknown,
  roomAccessToken: string | null | undefined,
): RoomPermissions | null {
  let source: Record<string, unknown> | null = null;
  if (fromResponse && typeof fromResponse === "object" && !Array.isArray(fromResponse)) {
    source = fromResponse as Record<string, unknown>;
  } else {
    const decoded = getRoomAccessPermissions(roomAccessToken ?? null);
    if (decoded) source = decoded as Record<string, unknown>;
  }
  if (!source) return null;
  const out = {} as RoomPermissions;
  for (const k of ROOM_PERMISSION_KEYS) out[k] = source[k] === true;
  // Older permission payloads have no dedicated mute/remove flags; those
  // abilities were part of canModerate.
  if (!("canMuteGuests" in source)) out.canMuteGuests = out.canModerate;
  if (!("canRemoveGuests" in source)) out.canRemoveGuests = out.canModerate;
  return out;
}

/**
 * In-room capability check: host always; otherwise the token-response
 * permissions or the roomAccessToken claims. Nothing while re-auth is needed.
 */
export function hasRoomPermission(
  key: RoomPermissionKey,
  ctx: {
    isHost: boolean;
    needsReauth?: boolean;
    roomPermissions?: Partial<RoomPermissions> | null;
    ratPermissions?: RoomAccessPermissions | null;
  },
): boolean {
  if (ctx.needsReauth) return false;
  if (ctx.isHost) return true;
  return !!ctx.roomPermissions?.[key] || !!(ctx.ratPermissions as any)?.[key];
}

export type PublicRoomStatus = "live" | "idle" | "ended" | "not_found" | "unknown";

export type PublicRoomInfo = {
  roomName: string | null;
  hostName: string | null;
  status: PublicRoomStatus;
  allowGuests: boolean;
  guestJoinAllowed: boolean | null;
};

/** Normalize GET /api/rooms/:id/info (roomStatus on new servers, status on old). */
export function normalizePublicRoomInfo(httpStatus: number, data: any): PublicRoomInfo {
  if (httpStatus === 404) {
    return { roomName: null, hostName: null, status: "not_found", allowGuests: false, guestJoinAllowed: false };
  }
  const raw = String(data?.roomStatus || data?.status || "").trim().toLowerCase();
  const status: PublicRoomStatus =
    raw === "live" ? "live" : raw === "ended" || raw === "closed" ? "ended" : raw === "not_found" ? "not_found" : raw === "idle" ? "idle" : "unknown";
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    roomName: str(data?.roomName),
    hostName: str(data?.hostName),
    status,
    allowGuests: data?.allowGuests !== false,
    guestJoinAllowed: typeof data?.guestJoinAllowed === "boolean" ? data.guestJoinAllowed : null,
  };
}

/** Backoff for re-requesting /token while the room is not live yet. */
export function nextMintRetryDelayMs(attempt: number): number {
  const n = Math.max(0, Math.floor(attempt));
  return Math.min(30_000, 4_000 * Math.pow(2, n));
}

/** "m:ss" (or "h:mm:ss") for the waiting screen. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

// LiveKit DisconnectReason values (@livekit/protocol), duplicated as numbers
// so this module needs no LiveKit import.
const DR_CLIENT_INITIATED = 1;
const DR_DUPLICATE_IDENTITY = 2;
const DR_PARTICIPANT_REMOVED = 4;
const DR_ROOM_DELETED = 5;

export type DisconnectKind = "explicit" | "client" | "removed" | "ended" | "duplicate" | "error";

/**
 * Decide what a LiveKit disconnect means for the page:
 * - explicit: the user pressed Exit Room / Leave (leave flow already ran)
 * - client:   client-initiated but not by the user (unmount, token swap): ignore
 * - removed / ended: the host removed us or closed the room
 * - duplicate: same identity joined elsewhere
 * - error: network drop / failed connect → offer Retry, never leave
 */
export function classifyDisconnect(reason: number | null | undefined, explicitLeave: boolean): DisconnectKind {
  if (explicitLeave) return "explicit";
  if (reason === DR_CLIENT_INITIATED) return "client";
  if (reason === DR_PARTICIPANT_REMOVED) return "removed";
  if (reason === DR_ROOM_DELETED) return "ended";
  if (reason === DR_DUPLICATE_IDENTITY) return "duplicate";
  return "error";
}

export type JoinPagePresence = { count: number; names: string[]; lastSeenAt: number | null };

/** Parse `joinPage` from /api/invites/room-status defensively (missing → null). */
export function parseJoinPagePresence(data: any): JoinPagePresence | null {
  const jp = data?.joinPage;
  if (jp && typeof jp === "object") {
    const names = Array.isArray(jp.names)
      ? jp.names.filter((n: unknown): n is string => typeof n === "string" && !!n.trim()).map((n: string) => n.trim())
      : [];
    const countRaw = typeof jp.count === "number" && Number.isFinite(jp.count) ? jp.count : names.length;
    const lastSeen =
      typeof jp.lastSeenAt === "number"
        ? jp.lastSeenAt
        : typeof jp.lastSeenAt === "string" && !Number.isNaN(Date.parse(jp.lastSeenAt))
          ? Date.parse(jp.lastSeenAt)
          : null;
    return { count: Math.max(0, Math.floor(countRaw)), names, lastSeenAt: lastSeen };
  }
  // Legacy servers only report a boolean.
  if (data && typeof data.hasJoinPageView === "boolean") {
    return { count: data.hasJoinPageView && !data.hasEnteredRoom ? 1 : 0, names: [], lastSeenAt: null };
  }
  return null;
}

/** Host pill text for guests waiting on the join page ("" = hide). */
export function joinPagePillText(p: JoinPagePresence | null): string {
  if (!p || p.count <= 0) return "";
  if (p.names.length === 1 && p.count === 1) return `${p.names[0]} is viewing the join page`;
  if (p.names.length > 0) {
    const shown = p.names.slice(0, 2).join(", ");
    const more = p.count - Math.min(2, p.names.length);
    return `${shown}${more > 0 ? ` +${more}` : ""} viewing the join page`;
  }
  return p.count === 1 ? "Guest is viewing the join page" : `${p.count} guests are viewing the join page`;
}

// --- Share-link (/room?t=<roomAccessToken>) token store --------------------
// stripQueryParams removes `t` after the first mint, so keep it per room for
// re-mints and status checks.

const SHARE_KEY = (roomId: string) => `sl_share_token:${roomId}`;

export function storeShareToken(roomId: string | null | undefined, token: string | null | undefined): void {
  if (!roomId || !token) return;
  try {
    sessionStorage.setItem(SHARE_KEY(roomId), token);
  } catch {
    // ignore
  }
}

export function readShareToken(roomId: string | null | undefined): string | null {
  if (!roomId) return null;
  try {
    const v = sessionStorage.getItem(SHARE_KEY(roomId));
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/** True when a 403 from /token means "no access" (vs. a fixable auth state). */
export function isAccessDeniedCode(code: string | null | undefined): boolean {
  const c = String(code || "").toLowerCase();
  return (
    c === "not_allowed" ||
    c === "forbidden" ||
    c === "access_denied" ||
    c === "not_invited" ||
    c === "room_access_denied" ||
    c === "guests_not_allowed" ||
    c === "banned" ||
    c === ""
  );
}

/** Notice when the server downgraded a requested invisible join. */
export function presenceDowngradeNotice(
  requested: "normal" | "invisible",
  granted: unknown,
): string | null {
  if (requested !== "invisible") return null;
  const g = String(granted ?? "").toLowerCase();
  if (!g || g === "invisible" || g === "silent") return null;
  return "Invisible mode isn't available for this room, so you joined visibly.";
}
