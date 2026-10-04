// Client-side helpers for the roomAccessToken (RAT) returned by /token.
//
// The RAT is an HS256 JWT signed by the server. The client cannot verify it,
// but it can read its payload to align UI gating with what the server will
// actually accept (the server re-verifies every request). Nothing here is a
// security boundary; it only keeps the UI from showing buttons that would
// 401/403.

export type RoomAccessPermissions = Partial<
  Record<
    | "canStream"
    | "canRecord"
    | "canDestinations"
    | "canModerate"
    | "canLayout"
    | "canScreenShare"
    | "canInvite"
    | "canAnalytics"
    | "canMuteGuests"
    | "canRemoveGuests",
    boolean
  >
>;

export type RoomRole = "host" | "cohost" | "participant" | "guest" | "viewer";

export type RoomAccessPayload = {
  roomId?: string;
  role?: string;
  identity?: string;
  permissions?: RoomAccessPermissions;
  /** Set for delegated producers: a "host" token limited by `permissions`. */
  actingOwnerUid?: string;
  exp?: number;
};

/** True for a delegated producer's token (role host, limited by its permissions). */
export function isLimitedHostToken(token: string | null | undefined): boolean {
  const p = decodeRoomAccessToken(token);
  return !!p && String(p.role || "").toLowerCase() === "host" && typeof p.actingOwnerUid === "string" && !!p.actingOwnerUid;
}

function base64UrlDecode(input: string): string {
  let s = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  if (pad) s += "=".repeat(4 - pad);
  const binary = typeof atob === "function" ? atob(s) : "";
  try {
    // Handle UTF-8 payloads (display names etc.).
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return binary;
  }
}

/** Decode (without verifying) the payload of a roomAccessToken. */
export function decodeRoomAccessToken(token: string | null | undefined): RoomAccessPayload | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const parsed = JSON.parse(base64UrlDecode(parts[1]));
    return parsed && typeof parsed === "object" ? (parsed as RoomAccessPayload) : null;
  } catch {
    return null;
  }
}

/** Permissions embedded in the roomAccessToken (all false/absent if unknown). */
export function getRoomAccessPermissions(token: string | null | undefined): RoomAccessPermissions | null {
  const payload = decodeRoomAccessToken(token);
  const perms = payload?.permissions;
  if (!perms || typeof perms !== "object") return null;
  const out: RoomAccessPermissions = {};
  for (const [k, v] of Object.entries(perms)) {
    if (typeof v === "boolean") (out as any)[k] = v;
  }
  return out;
}

/**
 * Normalize a role string from the server (token response, RAT or controls
 * doc). Unknown roles return null instead of throwing so new server roles
 * never break the room page.
 */
export function normalizeRoomRole(raw: unknown): RoomRole | null {
  const r = String(raw ?? "").trim().toLowerCase();
  if (r === "host" || r === "cohost" || r === "participant" || r === "guest" || r === "viewer") return r;
  // Legacy "moderator" is a co-host everywhere (server roleDefaults).
  if (r === "co-host" || r === "co_host" || r === "moderator") return "cohost";
  if (r === "speaker") return "participant";
  return null;
}

/**
 * Invite-redeemed guests currently get an identity with a random suffix
 * (`invite:<inviteId>:<random>`) that changes on every token mint. Re-minting
 * mid-session would hand them a roomAccessToken for a *different* identity
 * than the one connected to LiveKit, so token-refresh hints are ignored for
 * these identities.
 */
export function isEphemeralGuestIdentity(identity: string | null | undefined): boolean {
  return typeof identity === "string" && /^invite:[^:]+:[0-9a-f]+$/i.test(identity);
}
