/**
 * Pure policy helpers for in-room moderation (host vs. producer vs. cohost).
 *
 * The roomAccessToken carries a role ("host" | "cohost" | ...) and a
 * permissions map. Hosts (owners, admins acting as host) may do everything.
 * Delegated producers also carry role "host" but have `actingOwnerUid` set:
 * they are limited by the permissions in their token (derived from their
 * collaborator permissions). Cohosts are limited to what their permissions
 * allow and can never act on the room owner/host identities or hand out the
 * cohost role.
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

export type ModerationActorRole = "host" | "producer" | "cohost" | "other";

/**
 * Either a bare role string (treated as-is) or roomAccessToken claims, in
 * which case a "host" token with `actingOwnerUid` is a delegated producer.
 */
export type ModerationActor = unknown;

function actorRoleString(actor: ModerationActor): { role: string; actingOwnerUid: string } {
  if (actor && typeof actor === "object") {
    const a = actor as Record<string, unknown>;
    return {
      role: String(a.role ?? "").trim().toLowerCase(),
      actingOwnerUid: typeof a.actingOwnerUid === "string" ? a.actingOwnerUid.trim() : "",
    };
  }
  return { role: String(actor ?? "").trim().toLowerCase(), actingOwnerUid: "" };
}

export function moderationActorRole(actor: ModerationActor): ModerationActorRole {
  const { role, actingOwnerUid } = actorRoleString(actor);
  if (role === "host") return actingOwnerUid ? "producer" : "host";
  // Legacy "moderator" is treated as cohost everywhere.
  if (role === "cohost" || role === "moderator") return "cohost";
  return "other";
}

/** Owner/admin host (not a delegated producer). */
export function isFullHostActor(actor: ModerationActor): boolean {
  return moderationActorRole(actor) === "host";
}

/** Host, producer or cohost (may open moderation endpoints; per-key checks still apply). */
export function isStaffActor(actor: ModerationActor): boolean {
  return moderationActorRole(actor) !== "other";
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

/**
 * True when the actor may perform the action: full host always; producers
 * and cohosts only when their token permissions hold `key`.
 */
export function actorMay(
  actor: ModerationActor,
  perms: Record<string, unknown> | null | undefined,
  key: RoomAccessPermissionKey,
): boolean {
  const kind = moderationActorRole(actor);
  if (kind === "host") return true;
  if (kind === "producer" || kind === "cohost") return accessHasPerm(perms, key);
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
 * True for LiveKit identities that are not a signed-in account: invite/link
 * guests ("invite:...", "guest_..."), share/direct/legacy session ids,
 * invisible observers and producer identities. Account identities are the
 * user's Firebase uid.
 */
export function isAnonymousIdentity(identity: string): boolean {
  const id = String(identity ?? "").trim();
  if (!id) return true;
  if (/^(invite|share|direct|legacy|jwt|producer):/.test(id)) return true;
  if (/^(guest|invisible)_/.test(id)) return true;
  // Firebase uids never contain ':' or '/'.
  return id.includes(":") || id.includes("/");
}

/**
 * Permission each room-controls key requires. "host" means host-level:
 * capability scopes would let a cohost escalate someone (or themselves).
 * Producers may change host-level keys when they hold canModerate
 * (collaborator manageParticipants).
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
  actor: ModerationActor,
  perms: Record<string, unknown> | null | undefined,
  keys: string[],
): RoomAccessPermissionKey | "host" | null {
  const kind = moderationActorRole(actor);
  if (kind === "host") return null;
  for (const k of keys) {
    const need = CONTROL_KEY_REQUIRED_PERM[k] ?? "host";
    if (need === "host") {
      if (kind === "producer" && accessHasPerm(perms, "canModerate")) continue;
      return "host";
    }
    if ((kind !== "cohost" && kind !== "producer") || !accessHasPerm(perms, need)) return need;
  }
  return null;
}

/**
 * Hosts may assign any preset; producers any preset (callers also require
 * canModerate); cohosts may only set participant/viewer.
 */
export function canAssignRolePreset(actor: ModerationActor, presetId: unknown): boolean {
  const kind = moderationActorRole(actor);
  const target = String(presetId ?? "").trim().toLowerCase();
  if (kind === "host" || kind === "producer") return true;
  if (kind === "cohost") return target === "participant" || target === "viewer";
  return false;
}

/**
 * Fold the cohost's controls-doc scopes (copied from the owner's cohost
 * preset when the role was applied, possibly adjusted by the host) into the
 * cohost's roomAccessToken permissions. Callers must intersect the result
 * with the OWNER's plan entitlements afterwards (recording / destinations),
 * see intersectPermissionsWithEntitlements.
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
  const stream = pick("canStartStopStream");
  const record = pick("canStartStopRecording");
  const destinations = pick("canManageDestinations");
  if (mute !== undefined) next.canMuteGuests = mute;
  if (remove !== undefined) next.canRemoveGuests = remove;
  if (invite !== undefined) next.canInvite = invite;
  if (layout !== undefined) next.canLayout = layout;
  if (screen !== undefined) next.canScreenShare = screen;
  if (stream !== undefined) next.canStream = stream;
  if (record !== undefined) next.canRecord = record;
  if (destinations !== undefined) next.canDestinations = destinations;
  if (mute !== undefined || remove !== undefined) {
    next.canModerate = !!(next.canMuteGuests || next.canRemoveGuests);
  }
  return next;
}

/** Collaborator (producer) permissions -> roomAccessToken permissions. */
export function collaboratorToRoomAccessPermissions(raw: unknown): Record<RoomAccessPermissionKey, boolean> {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const manage = !!p.manageParticipants;
  return {
    canStream: !!p.manageStreaming,
    canRecord: !!p.manageRecording,
    canDestinations: !!p.manageStreaming,
    canModerate: manage,
    canLayout: !!p.controlLayouts,
    canScreenShare: true,
    canInvite: manage,
    canAnalytics: true,
    canMuteGuests: manage,
    canRemoveGuests: manage,
  };
}
