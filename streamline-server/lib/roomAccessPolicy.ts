/**
 * Room access model for the RTC production room (rooms/{roomId}.access).
 *
 *   invite_only (default) - only the owner/delegated producers, cohosts and
 *                           people holding a valid invite (invite JWT, invite
 *                           guest session, recorded acceptance) or a host
 *                           stage grant may get a token. Direct link joins
 *                           and uninvited signed-in users are refused.
 *   link                  - anyone with the room link may watch as an audience
 *                           viewer (subscribe-only). Publishing still needs an
 *                           invite or a host stage promotion.
 *   public                - same as link, and the room may be listed/shown in
 *                           public room info.
 *
 * Rooms created before `access` existed have no field and are invite_only;
 * invites keep working in every mode.
 *
 * The viewer-facing HLS channel (publicHls, /api/hls/public, PPV) is NOT
 * governed by this setting.
 *
 * Legacy fields are derived from `access` on write so older readers agree:
 *   visibility:   invite_only -> "private", link -> "unlisted", public -> "public"
 *   requiresAuth: invite_only -> true (no anonymous direct join), else false
 * `allowGuests` stays an explicit, orthogonal host override: false means no
 * anonymous (account-less) guests at all, even with an invite.
 *
 * Pure module (no Firestore).
 */

export type RoomAccessMode = "invite_only" | "link" | "public";

export const ROOM_ACCESS_MODES: readonly RoomAccessMode[] = ["invite_only", "link", "public"];

export const DEFAULT_ROOM_ACCESS: RoomAccessMode = "invite_only";

/** Accepts the canonical values plus a few spellings; unknown -> null. */
export function normalizeRoomAccessMode(raw: unknown): RoomAccessMode | null {
  const v = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (v === "invite_only" || v === "invite" || v === "invites_only") return "invite_only";
  if (v === "link" || v === "anyone_with_link" || v === "anyone_with_the_link") return "link";
  if (v === "public") return "public";
  return null;
}

/**
 * Access mode for a new room from the create body: `access` wins; a legacy
 * `visibility` is mapped (public -> public, unlisted -> link, private ->
 * invite_only); otherwise invite_only.
 */
export function accessFromCreateBody(body: any): RoomAccessMode {
  const explicit = normalizeRoomAccessMode(body?.access);
  if (explicit) return explicit;
  const legacy = String(body?.visibility || "").trim().toLowerCase();
  if (legacy === "public") return "public";
  if (legacy === "unlisted") return "link";
  return DEFAULT_ROOM_ACCESS;
}

/** Effective access mode of a room doc. Missing/invalid field -> invite_only. */
export function resolveRoomAccessMode(room: Record<string, unknown> | null | undefined): RoomAccessMode {
  return normalizeRoomAccessMode(room?.access) ?? DEFAULT_ROOM_ACCESS;
}

export type DerivedRoomPolicyFields = {
  access: RoomAccessMode;
  visibility: "private" | "unlisted" | "public";
  requiresAuth: boolean;
};

export function derivePolicyFields(access: RoomAccessMode): DerivedRoomPolicyFields {
  return {
    access,
    visibility: access === "invite_only" ? "private" : access === "public" ? "public" : "unlisted",
    requiresAuth: access === "invite_only",
  };
}

/** True when uninvited people with the link may watch (subscribe-only). */
export function allowsLinkViewers(access: RoomAccessMode): boolean {
  return access === "link" || access === "public";
}

/** True when the room may appear in public listings / public room info. */
export function isDiscoverable(access: RoomAccessMode): boolean {
  return access === "public";
}

/** Explicit host override: anonymous guests disabled only when allowGuests === false. */
export function anonymousGuestsAllowed(room: Record<string, unknown> | null | undefined): boolean {
  return room?.allowGuests !== false;
}

/**
 * True when a guest session's inviteId comes from a real invite (Firestore
 * roomInvites id, "legacy:" / "jwt:" invite JWT). Sessions minted for direct
 * link joins ("direct:") or share-link holders ("share:") are not invites.
 */
export function isInviteSessionId(inviteId: unknown): boolean {
  const id = String(inviteId ?? "").trim();
  if (!id) return false;
  return !/^(direct|share):/.test(id);
}

export type TokenCaller = {
  /** Owner, delegated producer, or platform admin acting as host. */
  isHostLike: boolean;
  /** Signed-in cohost (cohost acceptance / cohost invite JWT / host-applied cohost role). */
  isCohost: boolean;
  /**
   * Invite evidence: invite JWT for this room, invite guest session, recorded
   * acceptance, or a host stage grant (controls role participant/cohost).
   */
  hasInvite: boolean;
};

// (Flat shape: the server tsconfig doesn't narrow boolean discriminants.)
export type TokenAccessDecision = {
  allow: boolean;
  maxRole?: "host" | "cohost" | "participant" | "viewer";
  status?: 403;
  error?: "not_allowed";
};

/**
 * Who may get a production-room token, and the most they may be minted as.
 * The caller still applies its own role logic (guest vs participant, stage
 * controls, presence) under that ceiling.
 */
export function decideTokenAccess(access: RoomAccessMode, caller: TokenCaller): TokenAccessDecision {
  if (caller.isHostLike) return { allow: true, maxRole: "host" };
  if (caller.isCohost) return { allow: true, maxRole: "cohost" };
  if (caller.hasInvite) return { allow: true, maxRole: "participant" };
  if (allowsLinkViewers(access)) return { allow: true, maxRole: "viewer" };
  return { allow: false, status: 403, error: "not_allowed" };
}

export type JoinGuestDecision = {
  allow: boolean;
  role?: "viewer";
  status?: 403;
  error?: "not_allowed" | "guests_not_allowed";
};

/** POST /rooms/:roomId/join-guest (direct join by link, no invite). */
export function decideDirectGuestJoin(access: RoomAccessMode, room: Record<string, unknown> | null | undefined): JoinGuestDecision {
  if (!allowsLinkViewers(access)) return { allow: false, status: 403, error: "not_allowed" };
  if (!anonymousGuestsAllowed(room)) return { allow: false, status: 403, error: "guests_not_allowed" };
  return { allow: true, role: "viewer" };
}

/** Public /info flag: can someone without an invite join from the room link right now? */
export function directJoinAllowed(access: RoomAccessMode, room: Record<string, unknown> | null | undefined, isLive: boolean): boolean {
  return isLive && allowsLinkViewers(access) && anonymousGuestsAllowed(room);
}
