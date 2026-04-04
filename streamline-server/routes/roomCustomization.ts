import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { firestore as db } from "../firebaseAdmin";
import { assertRoomPerm, RoomPermissionError } from "../lib/rolePermissions";
import type { RoomCustomizationConfig } from "../types/roomCustomization";

const router = Router();

function normalizeRoomId(raw: string | undefined): string {
  return String(raw || "").trim();
}

/**
 * GET /api/rooms/:roomId/customization
 *
 * Returns the current room customization config stored at
 * rooms/{roomId}.settings.customization.
 *
 * Requires: authenticated host or co-host with canLayout permission.
 */
router.get("/:roomId/customization", requireAuth as any, async (req: any, res) => {
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) {
    return res.status(400).json({ error: "invalid_room_id" });
  }

  try {
    const ctx = await assertRoomPerm(req as any, roomId, "canLayout");
    const settings = (ctx.room as any).settings || {};
    const customization: RoomCustomizationConfig = settings.customization || {};

    return res.json({
      ok: true,
      roomId: ctx.roomId,
      customization,
    });
  } catch (err: any) {
    if (err instanceof RoomPermissionError) {
      return res.status(err.status).json({ error: err.code });
    }
    console.error("GET /api/rooms/:roomId/customization error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

/**
 * PUT /api/rooms/:roomId/customization
 *
 * Saves the room customization config to rooms/{roomId}.settings.customization.
 * Only updates the fields present in the request body (shallow merge).
 *
 * Requires: authenticated host or co-host with canLayout permission.
 *
 * Security: these are presentation-only fields.
 * Access control / greenroom policy is handled separately via roomsPolicy routes.
 */
router.put("/:roomId/customization", requireAuth as any, async (req: any, res) => {
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) {
    return res.status(400).json({ error: "invalid_room_id" });
  }

  const body = req.body || {};

  // Validate top-level shape — we accept only known keys.
  const allowedKeys: Array<keyof RoomCustomizationConfig> = [
    "banner",
    "roomBackground",
    "placeholderMedia",
    "layoutStyle",
    "introClip",
    "roomSfx",
    "greenroom",
  ];

  const unknownKeys = Object.keys(body).filter((k) => !allowedKeys.includes(k as any));
  if (unknownKeys.length > 0) {
    return res.status(400).json({
      error: "invalid_input",
      details: `Unknown customization keys: ${unknownKeys.join(", ")}`,
    });
  }

  // Validate layoutStyle when provided.
  if (body.layoutStyle !== undefined) {
    const validLayouts = ["default", "speaker", "grid", "host-focus"];
    if (!validLayouts.includes(body.layoutStyle)) {
      return res.status(400).json({
        error: "invalid_input",
        details: `layoutStyle must be one of: ${validLayouts.join(", ")}`,
      });
    }
  }

  // Validate roomSfx.allowedEffects when provided.
  if (body.roomSfx?.allowedEffects !== undefined) {
    const validEffects = ["applause", "boo", "crickets", "airhorn"];
    const effects: any[] = Array.isArray(body.roomSfx.allowedEffects) ? body.roomSfx.allowedEffects : [];
    const invalidEffects = effects.filter((e) => !validEffects.includes(e));
    if (invalidEffects.length > 0) {
      return res.status(400).json({
        error: "invalid_input",
        details: `Invalid sound effects: ${invalidEffects.join(", ")}. Allowed: ${validEffects.join(", ")}`,
      });
    }
  }

  try {
    const ctx = await assertRoomPerm(req as any, roomId, "canLayout");

    // Merge the incoming fields onto the existing customization object.
    const existing: RoomCustomizationConfig = ((ctx.room as any).settings?.customization) || {};
    const next: RoomCustomizationConfig = { ...existing };

    for (const key of allowedKeys) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        if (body[key] === null || body[key] === undefined) {
          // Explicit null/undefined removes the sub-key.
          delete (next as any)[key];
        } else {
          (next as any)[key] = body[key];
        }
      }
    }

    await db.collection("rooms").doc(ctx.roomId).set(
      { settings: { customization: next } },
      { merge: true }
    );

    return res.json({
      ok: true,
      roomId: ctx.roomId,
      customization: next,
    });
  } catch (err: any) {
    if (err instanceof RoomPermissionError) {
      return res.status(err.status).json({ error: err.code });
    }
    console.error("PUT /api/rooms/:roomId/customization error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
