import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { firestore as db } from "../firebaseAdmin";
import { assertRoomPerm, RoomPermissionError } from "../lib/rolePermissions";
import type { RoomHlsConfig } from "../services/rooms";
import { DEFAULT_ROOM_HLS_CONFIG } from "../services/rooms";

const router = Router();

function normalizeRoomId(raw: string | undefined): string {
  return String(raw || "").trim();
}

// GET /api/rooms/:roomId/hls-config
router.get("/:roomId/hls-config", requireAuth as any, async (req: any, res) => {
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) {
    return res.status(400).json({ error: "invalid_room_id" });
  }

  try {
    const ctx = await assertRoomPerm(req as any, roomId, "canLayout");
    const raw = (ctx.room as any).hlsConfig as RoomHlsConfig | undefined;
    const hlsConfig: RoomHlsConfig = raw && typeof raw === "object" ? raw : DEFAULT_ROOM_HLS_CONFIG;

    return res.json({
      roomId: ctx.roomId,
      hlsConfig,
    });
  } catch (err: any) {
    if (err instanceof RoomPermissionError) {
      return res.status(err.status).json({ error: err.code });
    }
    console.error("GET /api/rooms/:roomId/hls-config error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

// PUT /api/rooms/:roomId/hls-config
router.put("/:roomId/hls-config", requireAuth as any, async (req: any, res) => {
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) {
    return res.status(400).json({ error: "invalid_room_id" });
  }

  const { enabled, title, subtitle, logoUrl, offlineMessage, theme } = req.body || {};

  // Minimal validation and safe defaults
  if (typeof enabled !== "boolean") {
    return res.status(400).json({
      error: "invalid_input",
      details: "enabled (boolean) is required",
    });
  }
  if (title !== undefined && typeof title !== "string") {
    return res.status(400).json({ error: "invalid_input", details: "title must be a string" });
  }
  if (subtitle !== undefined && typeof subtitle !== "string") {
    return res.status(400).json({ error: "invalid_input", details: "subtitle must be a string" });
  }
  if (logoUrl !== undefined && typeof logoUrl !== "string") {
    return res.status(400).json({ error: "invalid_input", details: "logoUrl must be a string" });
  }
  if (offlineMessage !== undefined && typeof offlineMessage !== "string") {
    return res.status(400).json({ error: "invalid_input", details: "offlineMessage must be a string" });
  }
  if (theme !== undefined && theme !== "light" && theme !== "dark") {
    return res.status(400).json({
      error: "invalid_input",
      details: 'theme must be "light" or "dark" if provided',
    });
  }

  try {
    const ctx = await assertRoomPerm(req as any, roomId, "canLayout");

    const existing = ((ctx.room as any).hlsConfig || {}) as RoomHlsConfig;

    const nextConfig: RoomHlsConfig = {
      ...existing,
      enabled,
      updatedAt: new Date().toISOString(),
    };

    if (title !== undefined) nextConfig.title = title;
    if (subtitle !== undefined) nextConfig.subtitle = subtitle;
    if (logoUrl !== undefined) nextConfig.logoUrl = logoUrl;
    if (offlineMessage !== undefined) nextConfig.offlineMessage = offlineMessage;
    if (theme !== undefined) nextConfig.theme = theme;

    // Merge update to rooms/{roomId}.hlsConfig ONLY (no runtime hls state).
    await db.collection("rooms").doc(ctx.roomId).set(
      {
        hlsConfig: nextConfig,
      },
      { merge: true },
    );

    return res.json({
      success: true,
      roomId: ctx.roomId,
      hlsConfig: nextConfig,
    });
  } catch (err: any) {
    if (err instanceof RoomPermissionError) {
      // includes 403 forbidden, 404 room_not_found
      return res.status(err.status).json({ error: err.code });
    }
    console.error("PUT /api/rooms/:roomId/hls-config error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
