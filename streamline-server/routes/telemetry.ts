import express from "express";
import { sanitizeDisplayName } from "../lib/sanitizeDisplayName";

const router = express.Router();

// Lightweight telemetry endpoint for client-side events
router.post("/event", (req, res) => {
  try {
    const { event, roomName, source, ts } = req.body || {};

    if (!event || typeof event !== "string") {
      return res.status(400).json({ error: "event_required" });
    }

    const numericTs =
      typeof ts === "number" && Number.isFinite(ts) ? ts : Date.now();

    const payload = {
      event,
      roomName:
        typeof roomName === "string"
          ? sanitizeDisplayName(roomName).trim() || undefined
          : undefined,
      source: typeof source === "string" ? source : undefined,
      ts: new Date(numericTs).toISOString(),
      receivedAt: new Date().toISOString(),
      userAgent: req.get("user-agent") || undefined,
      ip:
        (req.headers["x-forwarded-for"] as string) ||
        req.socket.remoteAddress ||
        undefined,
    };

    console.log("[telemetry:event]", payload);

    return res.json({ ok: true });
  } catch (err) {
    console.error("telemetry/event error", err);
    return res.status(500).json({ error: "telemetry_error" });
  }
});

export default router;
