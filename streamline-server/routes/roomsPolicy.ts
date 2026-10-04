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
// Body: { access?: "invite_only" | "link" | "public", allowGuests?: boolean }
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
  const hasAccess = body.access !== undefined;
  const nextAccess = hasAccess ? normalizeRoomAccessMode(body.access) : null;
  if (hasAccess && !nextAccess) {
    return res.status(400).json({ error: "invalid_access" });
  }
  if (typeof allowGuests !== "boolean" && !nextAccess) {
    return res.status(400).json({ error: "invalid_policy_patch" });
  }

  const ref = db.collection("rooms").doc(roomId);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });

  const patch: Record<string, unknown> = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (typeof allowGuests === "boolean") patch.allowGuests = allowGuests;
  if (nextAccess) {
    const derived = derivePolicyFields(nextAccess);
    patch.access = derived.access;
    patch.visibility = derived.visibility;
    patch.requiresAuth = derived.requiresAuth;
    patch.accessUpdatedBy = uid;
  }
  await ref.set(patch as any, { merge: true });

  const after = await ref.get();
  return res.json(policyPayload(roomId, (after.data() as any) || {}));
});

export default router;
