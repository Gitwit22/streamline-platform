import type { Request } from "express";
import { getEffectiveEntitlements } from "./effectiveEntitlements";
import type { InviteClaims } from "../middleware/requireAuth";
import type { RoomAccessClaims } from "../middleware/roomAccessToken";
import { getRoom, type RoomDoc } from "../services/rooms";
import {
  DEFAULT_ROLE_PROFILES_BY_ID,
  type RolePermissionMap,
} from "./permissions/defaultRoleProfiles";

export type RoomRole = "participant" | "cohost";

export type RolePermissions = RolePermissionMap;

// Simple-mode role matrix used for invite-based roles and default profiles.
// Values are derived from DEFAULT_ROLE_PROFILES to keep a single source of truth.
export const ROLE_PERMISSIONS: Record<RoomRole, RolePermissions> = {
  participant: {
    ...DEFAULT_ROLE_PROFILES_BY_ID.participant.permissions,
  },
  cohost: {
    ...DEFAULT_ROLE_PROFILES_BY_ID.cohost.permissions,
  },
};

/**
 * Intersect a role's permission flags with the entitlements of the "owner" account
 * (typically the host who created the room or invite).
 *
 * - Recording is only enabled when the host plan has recording feature.
 * - External destinations / multistream are only enabled when the host plan
 *   has RTMP/multistream enabled.
 */
export async function intersectPermissionsWithEntitlements(
  perms: Record<string, boolean>,
  uid?: string
): Promise<Record<string, boolean>> {
  if (!uid) return perms;
  try {
    const ent = await getEffectiveEntitlements(uid);
    const planFeatures = ent.features;
    const rawFeatures = (ent.plan.raw?.features || {}) as any;

    const next: Record<string, boolean> = { ...perms };

    if (Object.prototype.hasOwnProperty.call(next, "canRecord")) {
      next.canRecord = !!next.canRecord && !!planFeatures.recording;
    }

    if (Object.prototype.hasOwnProperty.call(next, "canDestinations")) {
      // RTMP / Stream Destinations are effectively enabled when the plan
      // allows at least one destination. We still honor legacy feature
      // flags as a fallback so older plans behave sensibly, but the
      // numeric cap is the primary source of truth.
      const maxFromLimits = Number(ent.limits?.rtmpDestinationsMax ?? 0) || 0;
      const rtmpEnabledByLimit = maxFromLimits > 0;
      const rtmpEnabledByFlags = Boolean(
        planFeatures.multistream ||
        planFeatures.rtmp ||
        rawFeatures.rtmpMultistream ||
        rawFeatures.multistream ||
        (ent.plan.raw as any)?.multistreamEnabled
      );
      const rtmpEnabled = rtmpEnabledByLimit || rtmpEnabledByFlags;
      next.canDestinations = !!next.canDestinations && rtmpEnabled;
    }

    return next;
  } catch (err) {
    console.error("[rolePermissions] failed to intersect permissions with entitlements", err);
    return perms;
  }
}

export type RoomActorRole = "owner" | "admin" | RoomRole | "viewer";

export type RoomGuardContext = {
  roomId: string;
  room: RoomDoc;
  role: RoomActorRole;
  permissions: RolePermissions;
  actorType: "user" | "invite" | "roomAccess";
  uid?: string;
  invite?: InviteClaims;
  roomAccess?: RoomAccessClaims;
};

export class RoomPermissionError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message?: string) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

function allTruePermissions(): RolePermissions {
  return {
    canStream: true,
    canRecord: true,
    canDestinations: true,
    canModerate: true,
    canLayout: true,
    canScreenShare: true,
    canInvite: true,
    canAnalytics: true,
    canMuteGuests: true,
    canRemoveGuests: true,
  };
}

function ensureBooleanPerms(perms: Partial<RolePermissions> | undefined): RolePermissions {
  const base: RolePermissions = {
    canStream: false,
    canRecord: false,
    canDestinations: false,
    canModerate: false,
    canLayout: false,
    canScreenShare: false,
    canInvite: false,
    canAnalytics: false,
    canMuteGuests: false,
    canRemoveGuests: false,
  };
  const src = perms || {};
  return {
    canStream: !!src.canStream,
    canRecord: !!src.canRecord,
    canDestinations: !!src.canDestinations,
    canModerate: !!src.canModerate,
    canLayout: !!src.canLayout,
    canScreenShare: !!src.canScreenShare,
    canInvite: !!src.canInvite,
    canAnalytics: !!src.canAnalytics,
    canMuteGuests: !!src.canMuteGuests,
    canRemoveGuests: !!src.canRemoveGuests,
  };
}

export type RoomPermissionKey = keyof RolePermissions;

export async function assertRoomPerm(
  req: Request,
  roomId: string,
  perm: RoomPermissionKey
): Promise<RoomGuardContext> {
  const trimmedRoomId = String(roomId || "").trim();
  if (!trimmedRoomId) {
    throw new RoomPermissionError(400, "invalid_room", "roomId is required");
  }

  let roomData: RoomDoc;
  try {
    const { data } = await getRoom(trimmedRoomId);
    roomData = data;
  } catch (err: any) {
    if (err?.message === "room_not_found") {
      throw new RoomPermissionError(404, "room_not_found");
    }
    throw err;
  }

  const user = (req as any).user as { uid: string } | undefined;
  // Normalize account to an object so downstream checks never need
  // to guard against undefined. This mirrors how other routes use
  // req.account when present and keeps the logic explicit.
  const account = ((req as any).account || {}) as {
    isAdmin?: boolean;
    adminOverride?: boolean;
    adminOverrideHls?: boolean;
  };
  const invite = (req as any).invite as InviteClaims | undefined;
  const roomAccess = (req as any).roomAccess as RoomAccessClaims | undefined;

  if (!user && !invite && !roomAccess) {
    throw new RoomPermissionError(401, "unauthorized");
  }

  let actorType: RoomGuardContext["actorType"];
  let role: RoomActorRole;
  let permissions: RolePermissions;
  let uid: string | undefined;

  if (roomAccess && roomAccess.roomId) {
    if (roomAccess.roomId !== trimmedRoomId) {
      throw new RoomPermissionError(403, "room_mismatch");
    }
    actorType = "roomAccess";
    role = (roomAccess.role as any) || "viewer";
    permissions = ensureBooleanPerms(roomAccess.permissions as any);
  } else if (user) {
    uid = user.uid;
    actorType = "user";
    const isOwner = roomData.ownerId && roomData.ownerId === uid;
    const hasAdminOverride =
      !!account.isAdmin ||
      !!account.adminOverride ||
      !!account.adminOverrideHls;

    if (isOwner) {
      role = "owner";
      permissions = allTruePermissions();
    } else if (hasAdminOverride) {
      // Treat admins / override accounts as having full permissions for
      // room-level operations such as starting/stopping HLS and managing
      // recording or destinations.
      role = "admin";
      permissions = allTruePermissions();
    } else {
      role = "participant";
      permissions = ensureBooleanPerms({});
    }
  } else {
    actorType = "invite";
    role = ((invite?.role as any) || "viewer") as RoomActorRole;
    if (role === "cohost" || role === "participant") {
      const base = ROLE_PERMISSIONS[role as RoomRole] || ROLE_PERMISSIONS.participant;
      permissions = await intersectPermissionsWithEntitlements(base, invite?.createdByUid) as RolePermissions;
    } else {
      permissions = ensureBooleanPerms({});
    }
  }

  if (role === "owner" || role === "admin") {
    return {
      roomId: trimmedRoomId,
      room: roomData,
      role,
      permissions: allTruePermissions(),
      actorType,
      uid,
      invite,
      roomAccess,
    };
  }

  if (!permissions[perm]) {
    throw new RoomPermissionError(403, "insufficient_permissions");
  }

  return {
    roomId: trimmedRoomId,
    room: roomData,
    role,
    permissions,
    actorType,
    uid,
    invite,
    roomAccess,
  };
}

export async function assertRoomOwner(req: Request, roomId: string): Promise<RoomGuardContext> {
  const ctx = await assertRoomPerm(req, roomId, "canStream");
  if (ctx.role !== "owner") {
    throw new RoomPermissionError(403, "not_room_owner");
  }
  return ctx;
}

export async function assertRoomViewer(req: Request, roomId: string): Promise<RoomGuardContext> {
  const trimmedRoomId = String(roomId || "").trim();
  let roomData: RoomDoc;
  try {
    const { data } = await getRoom(trimmedRoomId);
    roomData = data;
  } catch (err: any) {
    if (err?.message === "room_not_found") {
      throw new RoomPermissionError(404, "room_not_found");
    }
    throw err;
  }

  const roomAccess = (req as any).roomAccess as RoomAccessClaims | undefined;
  if (roomAccess && roomAccess.roomId !== trimmedRoomId) {
    throw new RoomPermissionError(403, "room_mismatch");
  }

  const user = (req as any).user as { uid: string } | undefined;
  const invite = (req as any).invite as InviteClaims | undefined;

  if (!roomAccess && !invite && !user) {
    throw new RoomPermissionError(401, "unauthorized");
  }

  return {
    roomId: trimmedRoomId,
    room: roomData,
    role: "viewer",
    permissions: ensureBooleanPerms({}),
    actorType: roomAccess ? "roomAccess" : invite ? "invite" : "user",
    uid: user?.uid,
    invite,
    roomAccess,
  };
}
