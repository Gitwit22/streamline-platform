import { Router } from "express";
import admin from "firebase-admin";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { assertRoomPerm, RoomPermissionError } from "../lib/rolePermissions";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import type { RoomIntroRuntime } from "../types/roomCustomization";

const router = Router();

/** Maximum intro clip duration enforced server-side (in seconds). */
const MAX_INTRO_DURATION_S = 300; // 5 minutes

/** Hard auto-expire timeout: intro is marked failed after this many ms
 *  regardless of the configured duration, guarding against hung playback. */
const INTRO_HARD_EXPIRE_MS = MAX_INTRO_DURATION_S * 1_000 + 30_000;

function normalizeRoomId(raw: string | undefined): string {
  return String(raw || "").trim();
}

/**
 * GET /api/rooms/:roomId/intro/status
 *
 * Returns the current intro runtime state.
 * Auth: requireAuth (host or co-host only).
 */
router.get("/:roomId/intro/status", requireAuth as any, async (req: any, res) => {
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) return res.status(400).json({ error: "invalid_room_id" });

  try {
    const ctx = await assertRoomPerm(req as any, roomId, "canLayout");

    const snap = await db.collection("rooms").doc(ctx.roomId).get();
    if (!snap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });

    const room = (snap.data() as any) || {};
    const intro: RoomIntroRuntime = room.runtime?.intro || { status: "idle" };
    const config = room.settings?.customization?.introClip || null;

    return res.json({
      ok: true,
      roomId: ctx.roomId,
      intro,
      config,
    });
  } catch (err: any) {
    if (err instanceof RoomPermissionError) {
      return res.status(err.status).json({ error: err.code });
    }
    console.error("GET /api/rooms/:roomId/intro/status error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

/**
 * POST /api/rooms/:roomId/intro/play
 *
 * Host-only. Starts the intro clip.
 * Sets runtime.intro.status = "playing" and runtime.intro.startedAt.
 *
 * Safety rules:
 * - Requires introClip.enabled === true in the room's customization config.
 * - If intro clip has no assetId, falls through as a no-op (returns ok:true but
 *   status:"skipped") so the caller can proceed to live immediately.
 * - Duration capped at MAX_INTRO_DURATION_S server-side.
 *
 * Auth: requireAuth + canLayout (host/co-host with layout permission).
 */
router.post("/:roomId/intro/play", requireAuth as any, async (req: any, res) => {
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) return res.status(400).json({ error: "invalid_room_id" });

  try {
    const ctx = await assertRoomPerm(req as any, roomId, "canLayout");

    const snap = await db.collection("rooms").doc(ctx.roomId).get();
    if (!snap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });

    const room = (snap.data() as any) || {};
    const introConfig = room.settings?.customization?.introClip;

    // If intro clip is not configured or disabled, skip directly (safe fallback).
    if (!introConfig?.enabled || !introConfig?.assetId) {
      const fallbackState: RoomIntroRuntime = {
        status: "skipped",
        endedAt: admin.firestore.Timestamp.now() as any,
      };
      await db.collection("rooms").doc(ctx.roomId).set(
        { runtime: { intro: fallbackState } },
        { merge: true }
      );
      return res.json({ ok: true, roomId: ctx.roomId, intro: fallbackState, skipped: true });
    }

    // Cap duration at hard maximum.
    const rawDuration = typeof introConfig.durationSeconds === "number"
      ? introConfig.durationSeconds
      : MAX_INTRO_DURATION_S;
    const durationSeconds = Math.min(Math.max(1, rawDuration), MAX_INTRO_DURATION_S);

    // Guard against double-play: don't restart if already playing.
    const current: RoomIntroRuntime = room.runtime?.intro || { status: "idle" };
    if (current.status === "playing") {
      return res.json({ ok: true, roomId: ctx.roomId, intro: current, alreadyPlaying: true });
    }

    const now = admin.firestore.Timestamp.now();
    const introState: RoomIntroRuntime = {
      status: "playing",
      assetId: introConfig.assetId,
      startedAt: now as any,
    };

    await db.collection("rooms").doc(ctx.roomId).set(
      { runtime: { intro: introState } },
      { merge: true }
    );

    // Schedule server-side auto-expire so a hung intro never blocks room start.
    // We use a lightweight setTimeout — acceptable for V1; production can
    // use Cloud Tasks/Scheduler for durability.
    const expireAfterMs = durationSeconds * 1_000 + 5_000; // +5s grace
    const safeExpireMs = Math.min(expireAfterMs, INTRO_HARD_EXPIRE_MS);

    setTimeout(async () => {
      try {
        const check = await db.collection("rooms").doc(ctx.roomId).get();
        if (!check.exists) return;
        const d = (check.data() as any) || {};
        // Only expire if still in "playing" state and started from the same timestamp.
        const live: RoomIntroRuntime = d.runtime?.intro || {};
        if (live.status === "playing" && (live.startedAt as any)?.toMillis?.() === (now as any).toMillis?.()) {
          await db.collection("rooms").doc(ctx.roomId).set(
            { runtime: { intro: { status: "completed", endedAt: admin.firestore.Timestamp.now() } } },
            { merge: true }
          );
        }
      } catch (e) {
        console.error("[roomIntro] auto-expire failed", e);
      }
    }, safeExpireMs);

    return res.json({
      ok: true,
      roomId: ctx.roomId,
      intro: introState,
      durationSeconds,
    });
  } catch (err: any) {
    if (err instanceof RoomPermissionError) {
      return res.status(err.status).json({ error: err.code });
    }
    console.error("POST /api/rooms/:roomId/intro/play error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

/**
 * POST /api/rooms/:roomId/intro/skip
 *
 * Host-only. Skips (or ends) the intro clip immediately.
 * Always succeeds — skip must never block room start.
 *
 * Auth: requireAuth + canLayout (host/co-host).
 */
router.post("/:roomId/intro/skip", requireAuth as any, async (req: any, res) => {
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) return res.status(400).json({ error: "invalid_room_id" });

  try {
    const ctx = await assertRoomPerm(req as any, roomId, "canLayout");

    const skippedState: RoomIntroRuntime = {
      status: "skipped",
      endedAt: admin.firestore.Timestamp.now() as any,
    };

    await db.collection("rooms").doc(ctx.roomId).set(
      { runtime: { intro: skippedState } },
      { merge: true }
    );

    return res.json({ ok: true, roomId: ctx.roomId, intro: skippedState });
  } catch (err: any) {
    if (err instanceof RoomPermissionError) {
      return res.status(err.status).json({ error: err.code });
    }
    console.error("POST /api/rooms/:roomId/intro/skip error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
