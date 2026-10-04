/**
 * Pure policy helpers for in-room moderation (host vs. cohost).
 *
 * The roomAccessToken carries a role ("host" | "cohost" | ...) and a
 * permissions map. Hosts (owners, delegated producers, admins acting as host)
 * may do everything; cohosts are limited to what their permissions allow and
 * can never act on the room owner/host identities or hand out the cohost role.
 */

export type RoomAccessPermissionKey =
  | "canStream"
  | "canRecord"
  | "canDestinations"
  | "canModerate"
  | "canLayout"
  | "canScreenShare"
  | "canInvite"
  | "canAnalytics"
  | "canMuteGuests"
  | "canRemoveGuests";

export type ModerationActorRole = "host" | "cohost" | "other";

export function moderationActorRole(role: unknown): ModerationActorRole {
  const r = String(role ?? "").trim().toLowerCase();
  if (r === "host") return "host";
  if (r === "cohost") return "cohost";
  return "other";
}

/**
 * Reads one permission from a roomAccessToken permissions map. Older tokens
 * only carried canModerate; it implies mute/remove when those are absent
 * (same rule as ensureBooleanPerms in rolePermissions).
 */
export function accessHasPerm(perms: Record<string, unknown> | null | undefined, key: RoomAccessPermissionKey): boolean {
  const src = (perms || {}) as Record<string, unknown>;
  if ((key === "canMuteGuests" || key === "canRemoveGuests") && !Object.prototype.hasOwnProperty.call(src, key)) {
    return !!src.canModerate;
  }
  return !!src[key];
}

/** True when the actor (host, or cohost holding `key`) may perform the action. */
export function actorMay(
  role: unknown,
  perms: Record<string, unknown> | null | undefined,
  key: RoomAccessPermissionKey,
): boolean {
  const actor = moderationActorRole(role);
  if (actor === "host") return true;
  if (actor === "cohost") return accessHasPerm(perms, key);
  return false;
}

/** Identities a non-host must never moderate: the room owner and producers. */
export function isProtectedRoomIdentity(
  identity: string,
  ownerUid: string | null | undefined,
  extra: Array<string | null | undefined> = [],
): boolean {
  if (!identity) return true;
  if (ownerUid && identity === ownerUid) return true;
  if (identity.startsWith("producer:")) return true;
  return extra.some((x) => !!x && x === identity);
}

/**
 * Permission each room-controls key requires. "host" means host-only:
 * capability scopes would let a cohost escalate someone (or themselves).
 */
export const CONTROL_KEY_REQUIRED_PERM: Record<string, RoomAccessPermissionKey | "host"> = {
  canPublishAudio: "canMuteGuests",
  forcedMute: "canMuteGuests",
  canPublishVideo: "canModerate",
  forcedVideoOff: "canModerate",
  tileVisible: "canModerate",
  canScreenShare: "canModerate",
  screenShareLayout: "canLayout",
  outputFormat: "canLayout",
  canMuteGuests: "host",
  canRemoveGuests: "host",
  canInviteLinks: "host",
  canManageDestinations: "host",
  canStartStopStream: "host",
  canStartStopRecording: "host",
};

/**
 * Returns the first permission the actor is missing for this set of controls
 * keys (or "host" for host-only keys), or null when every key is allowed.
 */
export function missingPermForControlsPatch(
  role: unknown,
  perms: Record<string, unknown> | null | undefined,
  keys: string[],
): RoomAccessPermissionKey | "host" | null {
  const actor = moderationActorRole(role);
  if (actor === "host") return null;
  for (const k of keys) {
    const need = CONTROL_KEY_REQUIRED_PERM[k] ?? "host";
    if (need === "host") return "host";
    if (actor !== "cohost" || !accessHasPerm(perms, need)) return need;
  }
  return null;
}

/** Hosts may assign any preset; cohosts may only set participant/viewer. */
export function canAssignRolePreset(role: unknown, presetId: unknown): boolean {
  const actor = moderationActorRole(role);
  const target = String(presetId ?? "").trim().toLowerCase();
  if (actor === "host") return true;
  if (actor === "cohost") return target === "participant" || target === "viewer";
  return false;
}

/**
 * When a host promoted someone to cohost via room controls, the controls doc
 * carries capability scopes (canMuteGuests, canRemoveGuests, ...). Fold them
 * into the cohost's roomAccessToken permissions so the server accepts what
 * the host granted. Recording/streaming/destinations are never widened here.
 */
export function mergeCohostControlScopes(
  perms: Record<string, boolean>,
  controls: Record<string, unknown> | null | undefined,
): Record<string, boolean> {
  if (!controls) return perms;
  const next = { ...perms };
  const pick = (k: string): boolean | undefined => (typeof controls[k] === "boolean" ? (controls[k] as boolean) : undefined);
  const mute = pick("canMuteGuests");
  const remove = pick("canRemoveGuests");
  const invite = pick("canInviteLinks");
  const layout = pick("canChangeLayoutScene");
  const screen = pick("canScreenShare");
  if (mute !== undefined) next.canMuteGuests = mute;
  if (remove !== undefined) next.canRemoveGuests = remove;
  if (invite !== undefined) next.canInvite = invite;
  if (layout !== undefined) next.canLayout = layout;
  if (screen !== undefined) next.canScreenShare = screen;
  if (mute !== undefined || remove !== undefined) {
    next.canModerate = !!(next.canMuteGuests || next.canRemoveGuests);
  }
  return next;
}
