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

// Guest invite flow telemetry endpoint
router.post("/guest", (req, res) => {
  try {
    const { event, roomId, durationMs, guestSessionToken, ts } = req.body || {};

    if (!event || typeof event !== "string") {
      return res.status(400).json({ error: "event_required" });
    }

    const numericTs =
      typeof ts === "number" && Number.isFinite(ts) ? ts : Date.now();

    const payload = {
      event,
      roomId: typeof roomId === "string" ? roomId : undefined,
      durationMs: typeof durationMs === "number" && Number.isFinite(durationMs) ? durationMs : undefined,
      guestSessionToken: typeof guestSessionToken === "string" ? guestSessionToken.substring(0, 16) + "..." : undefined,
      ts: new Date(numericTs).toISOString(),
      receivedAt: new Date().toISOString(),
      userAgent: req.get("user-agent") || undefined,
      ip:
        (req.headers["x-forwarded-for"] as string) ||
        req.socket.remoteAddress ||
        undefined,
    };

    console.log("[telemetry:guest]", payload);

    // TODO: Store in Firestore for analytics dashboard
    // Example: admin.firestore().collection('guestTelemetry').add(payload);

    return res.json({ ok: true });
  } catch (err) {
    console.error("telemetry/guest error", err);
    return res.status(500).json({ error: "telemetry_error" });
  }
});

export default router;
