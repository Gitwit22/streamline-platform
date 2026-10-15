import { Router } from "express";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { requireRoomAccessToken, type RoomAccessClaims } from "../middleware/roomAccessToken";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { actorMay } from "../lib/roomModerationPolicy";
import { getEffectiveEntitlements } from "../lib/effectiveEntitlements";
import { checkFeature } from "../lib/entitlements";
import { LIMIT_ERRORS } from "../lib/limitErrors";
import { graphicsChangeNeedsFeature, normalizeRoomGraphics, parseRoomGraphicsInput } from "../lib/roomGraphicsPure";
import { syncRoomProgramOverlay } from "../services/programOverlay";

/**
 * Live room graphics (lower thirds + banners), mounted at /api/rooms.
 * Same auth as the program layout: Firebase auth + roomAccessToken, host or
 * co-host with canLayout. Stored at rooms/{roomId}.graphics with a `rev`
 * counter so two producers editing at once can't silently overwrite each
 * other (a stale write gets 409 + the current state).
 */
const router = Router();

function roomAccess(req: any, res: any, roomId: string): RoomAccessClaims | null {
  const access = req.roomAccess as RoomAccessClaims | undefined;
  if (!access || !access.roomId) {
    res.status(401).json({ error: PERMISSION_ERRORS.ROOM_TOKEN_REQUIRED });
    return null;
  }
  if (access.roomId !== roomId) {
    res.status(403).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });
    return null;
  }
  if (!actorMay(access, access.permissions, "canLayout")) {
    res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    return null;
  }
  return access;
}

function revOf(stored: any): number {
  const n = Number(stored?.rev);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

// GET /api/rooms/:roomId/graphics -> { graphics, rev }
router.get("/:roomId/graphics", requireAuth as any, requireRoomAccessToken as any, async (req: any, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!roomId) return res.status(400).json({ error: "roomId_required" });
  if (!roomAccess(req, res, roomId)) return;
  try {
    const snap = await db.collection("rooms").doc(roomId).get();
    if (!snap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
    const stored = (snap.data() as any)?.graphics;
    return res.json({ graphics: normalizeRoomGraphics(stored), rev: revOf(stored) });
  } catch (err) {
    console.error("[graphics] GET error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// PUT /api/rooms/:roomId/graphics { lowerThirds, banners, activeLowerThirdId, activeBannerId, rev }
router.put("/:roomId/graphics", requireAuth as any, requireRoomAccessToken as any, async (req: any, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!roomId) return res.status(400).json({ error: "roomId_required" });
  if (!roomAccess(req, res, roomId)) return;
  const parsed = parseRoomGraphicsInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: "invalid_input", field: parsed.field, details: parsed.details });
  const baseRev = Number(req.body?.rev);
  if (!Number.isFinite(baseRev)) return res.status(400).json({ error: "invalid_input", field: "rev" });
  const next = parsed.value!;

  try {
    const ref = db.collection("rooms").doc(roomId);
    const first = await ref.get();
    if (!first.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
    const room = first.data() as any;

    // Adding, editing or showing graphics needs the OWNER's roomBranding;
    // hiding and deleting are always allowed.
    if (graphicsChangeNeedsFeature(normalizeRoomGraphics(room?.graphics), next)) {
      const check = checkFeature(await getEffectiveEntitlements(String(room?.ownerId || "")), "roomBranding");
      if (!check.allowed) {
        return res.status(403).json({
          error: check.code === LIMIT_ERRORS.FEATURE_DISABLED ? LIMIT_ERRORS.FEATURE_DISABLED : "room_branding_not_in_plan",
        });
      }
    }

    const outcome = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const stored = (snap.data() as any)?.graphics;
      const currentRev = revOf(stored);
      if (currentRev !== baseRev) {
        return { conflict: true as const, graphics: normalizeRoomGraphics(stored), rev: currentRev };
      }
      const rev = currentRev + 1;
      tx.set(ref, { graphics: { ...next, rev, updatedAt: Date.now() } }, { merge: true });
      return { conflict: false as const, graphics: next, rev, room: { ...(snap.data() as any), graphics: next } };
    });

    if (outcome.conflict) {
      return res.status(409).json({ error: "graphics_conflict", graphics: outcome.graphics, rev: outcome.rev });
    }
    // Outputs and the in-room stage pick it up through room metadata.
    await syncRoomProgramOverlay(roomId, outcome.room, { clearWhenNoKit: true });
    return res.json({ graphics: outcome.graphics, rev: outcome.rev });
  } catch (err) {
    console.error("[graphics] PUT error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
