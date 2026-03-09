/**
 * Horizon Support Actions routes — admin support utilities.
 *
 * Mounted at `/api/horizon/support/actions` in index.ts.
 * requireAdmin is applied at the mount point.
 *
 * Routes:
 *   GET  /                   List available actions
 *   POST /resend-invite      Resend a room invite
 *   POST /broadcast-message  Send a system message to a room
 *   POST /snapshot           Capture a room state snapshot
 */
import { Router } from "express";
import { logger } from "../../lib/logger";
import { monitoringBus } from "../../lib/horizon/monitoringBus";

const router = Router();

/* ── GET / — List available support actions ───────────────────────── */

router.get("/", (_req, res) => {
  return res.json({
    ok: true,
    actions: [
      { id: "resend-invite", label: "Resend invite", method: "POST", path: "/resend-invite" },
      { id: "broadcast-message", label: "Broadcast message", method: "POST", path: "/broadcast-message" },
      { id: "snapshot", label: "Room snapshot", method: "POST", path: "/snapshot" },
    ],
  });
});

/* ── POST /resend-invite ──────────────────────────────────────────── */

router.post("/resend-invite", async (req, res) => {
  try {
    const { roomId, email, userId } = req.body || {};
    if (!roomId) {
      return res.status(400).json({ error: "MISSING_ROOM_ID" });
    }

    // TODO: integrate with invite system to actually resend
    logger.info({ roomId, email, userId }, "Support action: resend-invite");

    monitoringBus.send("system.log", "support-action", {
      action: "resend-invite",
      roomId,
      email,
      userId,
    });

    return res.json({ ok: true, message: "Invite resend queued", roomId });
  } catch (err: any) {
    logger.error({ err: err?.message }, "resend-invite action failed");
    return res.status(500).json({ error: "ACTION_FAILED" });
  }
});

/* ── POST /broadcast-message ──────────────────────────────────────── */

router.post("/broadcast-message", async (req, res) => {
  try {
    const { roomId, message } = req.body || {};
    if (!roomId || !message) {
      return res.status(400).json({ error: "MISSING_FIELDS", message: "roomId and message required" });
    }

    // TODO: integrate with room chat to deliver message
    logger.info({ roomId, messageLength: message.length }, "Support action: broadcast-message");

    monitoringBus.send("system.log", "support-action", {
      action: "broadcast-message",
      roomId,
      messageLength: String(message).length,
    });

    return res.json({ ok: true, message: "Message broadcast queued", roomId });
  } catch (err: any) {
    logger.error({ err: err?.message }, "broadcast-message action failed");
    return res.status(500).json({ error: "ACTION_FAILED" });
  }
});

/* ── POST /snapshot ───────────────────────────────────────────────── */

router.post("/snapshot", async (req, res) => {
  try {
    const { roomId } = req.body || {};
    if (!roomId) {
      return res.status(400).json({ error: "MISSING_ROOM_ID" });
    }

    // Room state snapshot: memory + uptime context
    const snapshot = {
      roomId,
      ts: new Date().toISOString(),
      serverUptime: process.uptime(),
      memory: process.memoryUsage(),
    };

    logger.info({ roomId }, "Support action: room snapshot");

    monitoringBus.send("system.log", "support-action", {
      action: "snapshot",
      roomId,
    });

    return res.json({ ok: true, snapshot });
  } catch (err: any) {
    logger.error({ err: err?.message }, "snapshot action failed");
    return res.status(500).json({ error: "ACTION_FAILED" });
  }
});

export default router;
