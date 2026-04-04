import { Router } from "express";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { assertRoomPerm, RoomPermissionError } from "../lib/rolePermissions";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import type { RoomLifecycleState } from "../types/roomCustomization";

const router = Router();

function normalizeRoomId(raw: string | undefined): string {
  return String(raw || "").trim();
}

/**
 * Allowed lifecycle transitions.
 * Key = current state, value = allowed next states.
 *
 * Standard path:  draft → setup → greenroom → intro_playing → live → ending → ended
 * Skip paths:
 *   - setup → live        (skip greenroom + intro, e.g. greenroom off)
 *   - greenroom → live    (skip intro, e.g. no intro configured)
 *   - intro_playing → live (intro complete / skip)
 *   - live → ended        (immediate end without separate "ending" phase)
 * Terminal: "ended" and "error" have no outgoing transitions.
 */
const ALLOWED_TRANSITIONS: Record<RoomLifecycleState, RoomLifecycleState[]> = {
  draft:          ["setup", "greenroom", "live"],
  setup:          ["greenroom", "intro_playing", "live"],
  greenroom:      ["intro_playing", "live"],
  intro_playing:  ["live"],
  live:           ["ending", "ended"],
  ending:         ["ended"],
  ended:          [],
  error:          [],
};

function isValidTransition(from: RoomLifecycleState | undefined, to: RoomLifecycleState): boolean {
  const effective: RoomLifecycleState = from ?? "draft";
  return (ALLOWED_TRANSITIONS[effective] ?? []).includes(to);
}

function normalizeLifecycleState(raw: unknown): RoomLifecycleState | undefined {
  const valid: RoomLifecycleState[] = [
    "draft", "setup", "greenroom", "intro_playing", "live", "ending", "ended", "error",
  ];
  return valid.includes(raw as any) ? (raw as RoomLifecycleState) : undefined;
}

/**
 * POST /api/rooms/:roomId/lifecycle/advance
 *
 * Advances the room lifecycle state machine to a new state.
 * Writes rooms/{roomId}.runtime.lifecycleState.
 *
 * Body: { to: RoomLifecycleState }
 *
 * Auth: requireAuth + canLayout (host/co-host with layout permission).
 *
 * Side effects:
 * - Advancing to "ended" while intro is playing automatically skips the intro
 *   by writing runtime.intro.status = "skipped".
 *
 * Returns: { ok, roomId, previous, current }
 */
router.post("/:roomId/lifecycle/advance", requireAuth as any, async (req: any, res) => {
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) return res.status(400).json({ error: "invalid_room_id" });

  const to = normalizeLifecycleState(req.body?.to);
  if (!to) {
    return res.status(400).json({
      error: "invalid_lifecycle_state",
      details: `'to' must be one of: draft, setup, greenroom, intro_playing, live, ending, ended`,
    });
  }

  try {
    const ctx = await assertRoomPerm(req as any, roomId, "canLayout");

    const snap = await db.collection("rooms").doc(ctx.roomId).get();
    if (!snap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });

    const room = (snap.data() as any) || {};
    const current = normalizeLifecycleState(room.runtime?.lifecycleState);

    if (!isValidTransition(current, to)) {
      return res.status(400).json({
        error: "invalid_lifecycle_transition",
        details: `Cannot advance from '${current ?? "draft"}' to '${to}'.`,
        current: current ?? "draft",
        to,
      });
    }

    // Build the runtime update.
    const runtimeUpdate: Record<string, unknown> = { lifecycleState: to };

    // Side effect: if ending/ended while intro is still playing, skip the intro.
    if ((to === "ending" || to === "ended") && room.runtime?.intro?.status === "playing") {
      runtimeUpdate["intro"] = {
        ...(room.runtime.intro || {}),
        status: "skipped",
      };
    }

    await db.collection("rooms").doc(ctx.roomId).set(
      { runtime: runtimeUpdate },
      { merge: true }
    );

    return res.json({
      ok: true,
      roomId: ctx.roomId,
      previous: current ?? "draft",
      current: to,
    });
  } catch (err: any) {
    if (err instanceof RoomPermissionError) {
      return res.status(err.status).json({ error: err.code });
    }
    console.error("POST /api/rooms/:roomId/lifecycle/advance error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

/**
 * GET /api/rooms/:roomId/lifecycle
 *
 * Returns the current lifecycle state.
 * Auth: requireAuth + canLayout.
 */
router.get("/:roomId/lifecycle", requireAuth as any, async (req: any, res) => {
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) return res.status(400).json({ error: "invalid_room_id" });

  try {
    const ctx = await assertRoomPerm(req as any, roomId, "canLayout");

    const snap = await db.collection("rooms").doc(ctx.roomId).get();
    if (!snap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });

    const room = (snap.data() as any) || {};
    const current = normalizeLifecycleState(room.runtime?.lifecycleState) ?? "draft";

    return res.json({
      ok: true,
      roomId: ctx.roomId,
      current,
      allowedNext: ALLOWED_TRANSITIONS[current] ?? [],
    });
  } catch (err: any) {
    if (err instanceof RoomPermissionError) {
      return res.status(err.status).json({ error: err.code });
    }
    console.error("GET /api/rooms/:roomId/lifecycle error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
