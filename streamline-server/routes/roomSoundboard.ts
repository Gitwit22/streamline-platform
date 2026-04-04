import { Router } from "express";
import admin from "firebase-admin";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { assertRoomPerm, RoomPermissionError } from "../lib/rolePermissions";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import type { BuiltInRoomSfx } from "../types/roomCustomization";

const router = Router();

const VALID_EFFECTS: BuiltInRoomSfx[] = ["applause", "boo", "crickets", "airhorn"];

/** Minimum milliseconds between any two sfx triggers (server-enforced). */
const SFX_COOLDOWN_MS = 3_000;

function normalizeRoomId(raw: string | undefined): string {
  return String(raw || "").trim();
}

/**
 * POST /api/rooms/:roomId/sfx/trigger
 *
 * Host-only. Triggers a built-in sound effect for the room audience.
 *
 * Rules:
 * - Only built-in effects (applause, boo, crickets, airhorn) are allowed.
 * - The room's customization.roomSfx.allowedEffects list further restricts
 *   which effects can fire (defaults to all 4 if list is absent/empty).
 * - Server-enforced cooldown of SFX_COOLDOWN_MS between triggers.
 * - One effect at a time: if a concurrent trigger arrives within cooldown,
 *   it is rejected with 429.
 * - If the soundboard feature is disabled or plan doesn't allow it, returns 403.
 * - Effect failure (network, asset unavailable) must not affect room operation.
 *
 * Body: { effect: "applause" | "boo" | "crickets" | "airhorn" }
 *
 * Auth: requireAuth + canLayout (host/co-host).
 */
router.post("/:roomId/sfx/trigger", requireAuth as any, async (req: any, res) => {
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) return res.status(400).json({ error: "invalid_room_id" });

  const effect = String(req.body?.effect || "").trim().toLowerCase() as BuiltInRoomSfx;
  if (!VALID_EFFECTS.includes(effect)) {
    return res.status(400).json({
      error: "invalid_effect",
      details: `effect must be one of: ${VALID_EFFECTS.join(", ")}`,
    });
  }

  try {
    const ctx = await assertRoomPerm(req as any, roomId, "canLayout");

    const snap = await db.collection("rooms").doc(ctx.roomId).get();
    if (!snap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });

    const room = (snap.data() as any) || {};

    // Check room-level sfx config.
    const sfxConfig = room.settings?.customization?.roomSfx;
    if (sfxConfig && sfxConfig.enabled === false) {
      return res.status(403).json({ error: "sfx_disabled_for_room" });
    }

    // Restrict to allowed effects list when configured.
    const allowedEffects: string[] = Array.isArray(sfxConfig?.allowedEffects) && sfxConfig.allowedEffects.length > 0
      ? sfxConfig.allowedEffects
      : VALID_EFFECTS;
    if (!allowedEffects.includes(effect)) {
      return res.status(403).json({ error: "effect_not_allowed" });
    }

    // Server-side cooldown check.
    const lastTriggeredMs: number = room.runtime?.sfx?.lastTriggeredMs ?? 0;
    const now = Date.now();
    const msSinceLast = now - lastTriggeredMs;
    if (msSinceLast < SFX_COOLDOWN_MS) {
      const retryAfterMs = SFX_COOLDOWN_MS - msSinceLast;
      res.setHeader("Retry-After", String(Math.ceil(retryAfterMs / 1_000)));
      return res.status(429).json({
        error: "sfx_cooldown_active",
        retryAfterMs,
      });
    }

    // Record the trigger in runtime state and event log atomically.
    const triggeredAt = admin.firestore.Timestamp.now();
    const logEntry = {
      effect,
      triggeredAt,
      triggeredBy: ctx.uid || "unknown",
    };

    const roomRef = db.collection("rooms").doc(ctx.roomId);
    const logRef = roomRef.collection("sfxLog").doc();

    await db.runTransaction(async (tx) => {
      // Re-check cooldown inside transaction to guard race.
      const freshSnap = await tx.get(roomRef);
      const freshRoom = (freshSnap.data() as any) || {};
      const freshLast: number = freshRoom.runtime?.sfx?.lastTriggeredMs ?? 0;
      const freshNow = Date.now();
      if (freshNow - freshLast < SFX_COOLDOWN_MS) {
        throw Object.assign(new Error("sfx_cooldown_active"), { code: 429 });
      }

      tx.set(
        roomRef,
        { runtime: { sfx: { lastTriggeredMs: freshNow, lastEffect: effect } } },
        { merge: true }
      );
      tx.set(logRef, logEntry);
    });

    return res.json({
      ok: true,
      roomId: ctx.roomId,
      effect,
      triggeredAt: triggeredAt.toMillis(),
    });
  } catch (err: any) {
    if (err instanceof RoomPermissionError) {
      return res.status(err.status).json({ error: err.code });
    }
    if (err?.code === 429 || err?.message === "sfx_cooldown_active") {
      return res.status(429).json({ error: "sfx_cooldown_active" });
    }
    console.error("POST /api/rooms/:roomId/sfx/trigger error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
