import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { firestore as db } from "../firebaseAdmin";
import { assertRoomPerm, RoomPermissionError } from "../lib/rolePermissions";
import { isGreenroomHlsEnabled } from "../lib/platformFeatureFlags";
import type { RoomSettingsPolicy } from "../types/roomCustomization";

const router = Router();

function normalizeRoomId(raw: string | undefined): string {
  return String(raw || "").trim();
}

/**
 * Reads and normalizes the greenroom policy stored at
 * rooms/{roomId}.settings.greenroom.
 * Returns a safe default when the policy has not been configured.
 */
function readGreenroomPolicy(room: any): RoomSettingsPolicy["greenroom"] {
  const raw = room?.settings?.greenroom || {};

  const rawMode = raw.mode;
  const mode: "off" | "prejoin" | "hls_waiting" =
    rawMode === "prejoin" || rawMode === "hls_waiting" ? rawMode : "off";

  return {
    mode,
    requireApproval: raw.requireApproval === true,
    autoAdmit: raw.autoAdmit === true,
    vipBypass: raw.vipBypass === true,
    vipList: Array.isArray(raw.vipList) ? (raw.vipList as string[]).filter((v) => typeof v === "string") : [],
    blockedList: Array.isArray(raw.blockedList) ? (raw.blockedList as string[]).filter((v) => typeof v === "string") : [],
  };
}

/**
 * GET /api/rooms/:roomId/greenroom-policy
 *
 * Returns the current greenroom policy for a room.
 * Requires: authenticated host or co-host with canLayout permission.
 *
 * Security: vipList and blockedList are sensitive; this endpoint is
 * restricted to privileged room actors only.
 */
router.get("/:roomId/greenroom-policy", requireAuth as any, async (req: any, res) => {
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) return res.status(400).json({ error: "invalid_room_id" });

  try {
    const platformEnabled = await isGreenroomHlsEnabled();
    if (!platformEnabled) {
      return res.status(409).json({
        error: "feature_disabled",
        feature: "greenroomHlsEnabled",
      });
    }

    const ctx = await assertRoomPerm(req as any, roomId, "canLayout");
    const policy = readGreenroomPolicy(ctx.room);

    return res.json({
      ok: true,
      roomId: ctx.roomId,
      greenroom: policy,
    });
  } catch (err: any) {
    if (err instanceof RoomPermissionError) {
      return res.status(err.status).json({ error: err.code });
    }
    console.error("GET /api/rooms/:roomId/greenroom-policy error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

/**
 * PUT /api/rooms/:roomId/greenroom-policy
 *
 * Updates the greenroom policy at rooms/{roomId}.settings.greenroom.
 * Only supplied fields are updated; omitted fields retain existing values.
 *
 * Requires: authenticated host or co-host with canLayout permission.
 *
 * Body may include any subset of:
 *   mode: "off" | "prejoin" | "hls_waiting"
 *   requireApproval: boolean
 *   autoAdmit: boolean
 *   vipBypass: boolean
 *   vipList: string[]         — replaces existing list when provided
 *   blockedList: string[]     — replaces existing list when provided
 */
router.put("/:roomId/greenroom-policy", requireAuth as any, async (req: any, res) => {
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) return res.status(400).json({ error: "invalid_room_id" });

  const body = req.body || {};

  // Validate mode when provided.
  if (body.mode !== undefined) {
    if (body.mode !== "off" && body.mode !== "prejoin" && body.mode !== "hls_waiting") {
      return res.status(400).json({
        error: "invalid_input",
        details: 'mode must be "off", "prejoin", or "hls_waiting"',
      });
    }
  }

  // Validate boolean fields.
  for (const boolField of ["requireApproval", "autoAdmit", "vipBypass"] as const) {
    if (body[boolField] !== undefined && typeof body[boolField] !== "boolean") {
      return res.status(400).json({
        error: "invalid_input",
        details: `${boolField} must be a boolean`,
      });
    }
  }

  // Validate list fields.
  for (const listField of ["vipList", "blockedList"] as const) {
    if (body[listField] !== undefined) {
      if (!Array.isArray(body[listField])) {
        return res.status(400).json({
          error: "invalid_input",
          details: `${listField} must be an array of strings`,
        });
      }
      if ((body[listField] as any[]).some((v) => typeof v !== "string")) {
        return res.status(400).json({
          error: "invalid_input",
          details: `${listField} entries must all be strings`,
        });
      }
    }
  }

  try {
    const platformEnabled = await isGreenroomHlsEnabled();
    if (!platformEnabled) {
      return res.status(409).json({
        error: "feature_disabled",
        feature: "greenroomHlsEnabled",
      });
    }

    const ctx = await assertRoomPerm(req as any, roomId, "canLayout");

    // Merge incoming fields onto the existing policy.
    const existing = readGreenroomPolicy(ctx.room);
    const next: RoomSettingsPolicy["greenroom"] = { ...existing };

    if (body.mode !== undefined) next.mode = body.mode;
    if (typeof body.requireApproval === "boolean") next.requireApproval = body.requireApproval;
    if (typeof body.autoAdmit === "boolean") next.autoAdmit = body.autoAdmit;
    if (typeof body.vipBypass === "boolean") next.vipBypass = body.vipBypass;
    if (Array.isArray(body.vipList)) next.vipList = body.vipList as string[];
    if (Array.isArray(body.blockedList)) next.blockedList = body.blockedList as string[];

    await db.collection("rooms").doc(ctx.roomId).set(
      { settings: { greenroom: next } },
      { merge: true }
    );

    return res.json({
      ok: true,
      roomId: ctx.roomId,
      greenroom: next,
    });
  } catch (err: any) {
    if (err instanceof RoomPermissionError) {
      return res.status(err.status).json({ error: err.code });
    }
    console.error("PUT /api/rooms/:roomId/greenroom-policy error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
