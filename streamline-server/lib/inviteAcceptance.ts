import crypto from "crypto";
import { firestore } from "../firebaseAdmin";

/**
 * When INVITE_TOKEN_SECRET / ROOM_ACCESS_TOKEN_SECRET / GUEST_SESSION_SECRET
 * are unset they all fall back to JWT_SECRET, so a room access token or a
 * guest session would pass verifyInviteToken. Reject those shapes: room
 * access tokens carry livekitRoomName/permissions, guest sessions inviteId.
 */
export function isInviteShapedClaims(claims: any): boolean {
  if (!claims || typeof claims !== "object") return false;
  if ("livekitRoomName" in claims || "permissions" in claims || "inviteId" in claims) return false;
  return true;
}

/** Stable acceptance inviteId for a JWT invite (a hash, never the raw token). */
export function jwtInviteAcceptanceId(inviteToken: string): string {
  return `jwt:${crypto.createHash("sha256").update(inviteToken).digest("base64url").slice(0, 24)}`;
}

/**
 * Invite acceptances for logged-in users: roomInviteAcceptances/{roomId}_{uid}.
 *
 * Written when an authenticated user redeems a room invite (join-now) or
 * accepts a cohost invite link, and read by /api/rooms/:roomId/token and
 * assertRoomPerm, so invitees keep their invited role after the guest session
 * or invite token is gone (refresh, new tab, expired session).
 */

export type AcceptanceRole = "participant" | "cohost";

export type InviteAcceptance = {
  roomId: string;
  uid: string;
  inviteId: string;
  role: AcceptanceRole;
  createdByUid: string | null;
  expiresAtMs: number | null;
};

export const INVITE_ACCEPTANCES_COLLECTION = "roomInviteAcceptances";

export function acceptanceDocId(roomId: string, uid: string): string {
  return `${roomId}_${uid}`;
}

export function normalizeAcceptanceRole(raw: unknown): AcceptanceRole | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "cohost" || v === "moderator") return "cohost";
  if (v === "participant" || v === "guest") return "participant";
  return null;
}

/** Never downgrade: a cohost acceptance survives a later participant redeem. */
export function mergeAcceptanceRole(existing: unknown, next: AcceptanceRole): AcceptanceRole {
  return normalizeAcceptanceRole(existing) === "cohost" ? "cohost" : next;
}

/**
 * Pure validity check for a stored acceptance doc. Returns the normalized
 * acceptance, or null when it's malformed, for another room/user, or expired.
 */
export function parseAcceptance(
  data: any,
  roomId: string,
  uid: string,
  nowMs: number = Date.now(),
): InviteAcceptance | null {
  if (!data || typeof data !== "object") return null;
  if (String(data.roomId || "") !== roomId || String(data.uid || "") !== uid) return null;
  if (data.revokedAt) return null;
  const role = normalizeAcceptanceRole(data.role);
  if (!role) return null;
  const expiresAtMs = typeof data.expiresAtMs === "number" && Number.isFinite(data.expiresAtMs) ? data.expiresAtMs : null;
  if (expiresAtMs !== null && expiresAtMs <= nowMs) return null;
  return {
    roomId,
    uid,
    inviteId: String(data.inviteId || ""),
    role,
    createdByUid: typeof data.createdByUid === "string" && data.createdByUid ? data.createdByUid : null,
    expiresAtMs,
  };
}

/** True for inviteIds that name a Firestore roomInvites doc (not jwt:/legacy:/direct:). */
export function isFirestoreInviteId(inviteId: string): boolean {
  return !!inviteId && !/^(jwt|legacy|direct|share):/.test(inviteId);
}

export async function recordInviteAcceptance(params: {
  roomId: string;
  uid: string;
  inviteId: string;
  role: AcceptanceRole;
  createdByUid?: string | null;
  expiresAtMs?: number | null;
}): Promise<void> {
  const { roomId, uid, inviteId, role } = params;
  if (!roomId || !uid) return;
  const ref = firestore.collection(INVITE_ACCEPTANCES_COLLECTION).doc(acceptanceDocId(roomId, uid));
  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? ((snap.data() as any) || {}) : null;
    const existingValid = existing ? parseAcceptance(existing, roomId, uid) : null;
    const mergedRole = existingValid ? mergeAcceptanceRole(existingValid.role, role) : role;
    // Keep the invite that granted the higher role when we don't upgrade.
    const keepExisting = !!existingValid && mergedRole === existingValid.role && existingValid.role !== role;
    tx.set(ref, {
      roomId,
      uid,
      inviteId: keepExisting ? existingValid!.inviteId : inviteId,
      role: mergedRole,
      createdByUid: keepExisting ? existingValid!.createdByUid : params.createdByUid ?? null,
      expiresAtMs: keepExisting ? existingValid!.expiresAtMs : params.expiresAtMs ?? null,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
      revokedAt: null,
    });
  });
}

/**
 * Loads the caller's active acceptance for a room. Acceptances that came from
 * a Firestore invite are dropped once that invite is revoked. Fails closed
 * (null) on read errors.
 */
export async function getInviteAcceptance(roomId: string, uid: string): Promise<InviteAcceptance | null> {
  if (!roomId || !uid) return null;
  try {
    const snap = await firestore.collection(INVITE_ACCEPTANCES_COLLECTION).doc(acceptanceDocId(roomId, uid)).get();
    if (!snap.exists) return null;
    const acceptance = parseAcceptance(snap.data(), roomId, uid);
    if (!acceptance) return null;
    if (isFirestoreInviteId(acceptance.inviteId)) {
      const inviteSnap = await firestore.collection("roomInvites").doc(acceptance.inviteId).get();
      if (inviteSnap.exists && (inviteSnap.data() as any)?.revokedAt) return null;
    }
    return acceptance;
  } catch (err) {
    console.warn("[inviteAcceptance] lookup failed", (err as any)?.message || err);
    return null;
  }
}
