import { Router } from "express";
import admin from "firebase-admin";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { requireRoomAccessToken, type RoomAccessClaims } from "../middleware/roomAccessToken";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { actorMay } from "../lib/roomModerationPolicy";
import {
  derivePolicyFields,
  normalizeRoomAccessMode,
  resolveRoomAccessMode,
  isDiscoverable,
} from "../lib/roomAccessPolicy";
import { isWaitingRoomEnabled } from "../lib/waitingRoomPure";
import { markAdmitted } from "../lib/waitingRoom";
import { listRoomParticipantIdentities } from "./roomGuestAccess";

const router = Router();

function policyPayload(roomId: string, room: Record<string, any>) {
  const access = resolveRoomAccessMode(room);
  const derived = derivePolicyFields(access);
  return {
    ok: true as const,
    roomId,
    access,
    discoverable: isDiscoverable(access),
    visibility: derived.visibility,
    requiresAuth: derived.requiresAuth,
    requiresPayment: room.requiresPayment === true,
    allowGuests: typeof room.allowGuests === "boolean" ? !!room.allowGuests : null,
    waitingRoomEnabled: isWaitingRoomEnabled(room),
  };
}

// GET /api/rooms/:roomId/policy
// Auth: roomAccessToken (header/query). No Firebase auth required.
router.get("/:roomId/policy", requireRoomAccessToken as any, async (req: any, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!roomId) return res.status(400).json({ error: "roomId_required" });

  const access = (req as any).roomAccess as RoomAccessClaims | undefined;
  if (!access || !access.roomId) return res.status(401).json({ error: PERMISSION_ERRORS.ROOM_TOKEN_REQUIRED });
  if (access.roomId !== roomId) return res.status(403).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });

  const snap = await db.collection("rooms").doc(roomId).get();
  if (!snap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });

  return res.json(policyPayload(roomId, (snap.data() as any) || {}));
});

// PATCH /api/rooms/:roomId/policy
// Body: { access?: "invite_only" | "link" | "public", allowGuests?: boolean, waitingRoomEnabled?: boolean }
// Auth: Firebase auth + roomAccessToken. Owner/admin host, or a producer /
// cohost whose token holds canModerate. Only affects the production room;
// the viewer-facing HLS channel is unaffected.
router.patch("/:roomId/policy", requireAuth as any, requireRoomAccessToken as any, async (req: any, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!roomId) return res.status(400).json({ error: "roomId_required" });

  const access = (req as any).roomAccess as RoomAccessClaims | undefined;
  if (!access || !access.roomId) return res.status(401).json({ error: PERMISSION_ERRORS.ROOM_TOKEN_REQUIRED });
  if (access.roomId !== roomId) return res.status(403).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });
  if (!actorMay(access, access.permissions, "canModerate")) {
    return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
  }

  const uid = (req as any).user?.uid as string | undefined;
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  const body = (req.body || {}) as any;
  const allowGuests = typeof body.allowGuests === "boolean" ? body.allowGuests : undefined;
  if (body.waitingRoomEnabled !== undefined && typeof body.waitingRoomEnabled !== "boolean") {
    return res.status(400).json({ error: "invalid_waiting_room" });
  }
  const waitingRoomEnabled: boolean | undefined = body.waitingRoomEnabled;
  const hasAccess = body.access !== undefined;
  const nextAccess = hasAccess ? normalizeRoomAccessMode(body.access) : null;
  if (hasAccess && !nextAccess) {
    return res.status(400).json({ error: "invalid_access" });
  }
  if (typeof allowGuests !== "boolean" && !nextAccess && typeof waitingRoomEnabled !== "boolean") {
    return res.status(400).json({ error: "invalid_policy_patch" });
  }

  const ref = db.collection("rooms").doc(roomId);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });

  const patch: Record<string, unknown> = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (typeof allowGuests === "boolean") patch.allowGuests = allowGuests;
  const room = (snap.data() as any) || {};
  const turningWaitingRoomOn = waitingRoomEnabled === true && !isWaitingRoomEnabled(room);
  if (typeof waitingRoomEnabled === "boolean") patch.waitingRoomEnabled = waitingRoomEnabled;
  if (nextAccess) {
    const derived = derivePolicyFields(nextAccess);
    patch.access = derived.access;
    patch.visibility = derived.visibility;
    patch.requiresAuth = derived.requiresAuth;
    patch.accessUpdatedBy = uid;
  }
  // Turning the waiting room on never queues people already in the room:
  // record them as admitted so their reconnects/token refreshes go straight
  // back in. Done before the flag is saved so there is no window where they'd
  // be queued. Best effort: the setting is saved either way.
  if (turningWaitingRoomOn) {
    try {
      const livekitRoomName = String(room.livekitRoomName || access.livekitRoomName || roomId).trim();
      const identities = await listRoomParticipantIdentities(livekitRoomName);
      if (identities && identities.length) await markAdmitted(roomId, identities, uid);
      else if (identities === null) console.warn("[roomsPolicy] waiting room on: could not list participants", { roomId });
    } catch (err: any) {
      console.warn("[roomsPolicy] waiting room on: admitting current participants failed", { roomId, error: err?.message || err });
    }
  }

  await ref.set(patch as any, { merge: true });

  const after = await ref.get();
  return res.json(policyPayload(roomId, (after.data() as any) || {}));
});

export default router;
