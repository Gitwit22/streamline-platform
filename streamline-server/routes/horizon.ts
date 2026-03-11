/**
 * Horizon Bot Integration API
 *
 * Provides:
 *
 *   Inbound (Bot → StreamLine)
 *   ──────────────────────────
 *   POST /api/horizon/events
 *     • HMAC-SHA256 signature verification via X-Horizon-Signature header
 *     • Accepts bot commands/responses (support, monitoring, alerts)
 *
 *   Support API (Bot queries StreamLine)
 *   ────────────────────────────────────
 *   GET /api/horizon/support/status
 *     • Health check / connection test
 *
 *   GET /api/horizon/support/rooms
 *     • List active rooms (live/idle)
 *
 *   GET /api/horizon/support/rooms/:roomId
 *     • Room detail
 *
 *   GET /api/horizon/support/rooms/:roomId/chat
 *     • Recent chat messages for a room
 *
 * Auth
 * ────
 *   All endpoints require:
 *     Authorization: Bearer <HORIZON_BEARER_TOKEN>
 *
 *   Inbound POST also requires:
 *     X-Horizon-Signature: sha256=<HMAC-SHA256 of raw body>
 *
 * Environment variables
 * ─────────────────────
 *   HORIZON_BEARER_TOKEN    – shared secret for Bearer auth
 *   HORIZON_WEBHOOK_SECRET  – shared secret for HMAC signatures
 *   HORIZON_WEBHOOK_URL     – (outbound) URL where StreamLine POSTs events
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import express from "express";
import { verifySignature } from "../lib/hmac";
import { firestore } from "../firebaseAdmin";

const router = Router();

// ============================================================================
// Middleware: Bearer token authentication
// ============================================================================

function requireHorizonAuth(req: Request, res: Response, next: NextFunction) {
  const expected = (process.env.HORIZON_BEARER_TOKEN || "").trim();
  if (!expected) {
    console.error("[horizon] HORIZON_BEARER_TOKEN not configured");
    return res.status(503).json({ error: "integration_not_configured" });
  }

  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!token || token !== expected) {
    return res.status(401).json({ error: "unauthorized" });
  }

  next();
}

// ============================================================================
// POST /events  — Inbound webhook (Bot → StreamLine)
// ============================================================================
// Body is parsed as raw buffer first so we can verify the HMAC, then parsed
// as JSON in-handler.

router.post(
  "/events",
  express.raw({ type: "application/json", limit: "256kb" }),
  requireHorizonAuth,
  async (req: Request, res: Response) => {
    try {
      const secret = (process.env.HORIZON_WEBHOOK_SECRET || "").trim();
      if (!secret) {
        console.error("[horizon] HORIZON_WEBHOOK_SECRET not configured");
        return res.status(503).json({ error: "integration_not_configured" });
      }

      const rawBody = req.body as Buffer;
      if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
        return res.status(400).json({ error: "empty_body" });
      }

      const signature = String(req.headers["x-horizon-signature"] || "").trim();
      if (!signature) {
        return res.status(401).json({ error: "missing_signature" });
      }

      if (!verifySignature(secret, rawBody, signature)) {
        console.warn("[horizon] Inbound signature verification failed");
        return res.status(401).json({ error: "invalid_signature" });
      }

      // Signature valid — parse JSON
      let payload: any;
      try {
        payload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        return res.status(400).json({ error: "invalid_json" });
      }

      const eventType = String(payload?.type || "").trim();
      const eventId = String(payload?.id || "").trim();

      console.log("[horizon] Inbound event:", { type: eventType, id: eventId });

      // ----- Phase 1 skill routing -----
      switch (eventType) {
        case "support.request": {
          // Bot is forwarding a support request — store for the dashboard
          const { roomId, message, userId } = payload.data || {};
          if (roomId && message) {
            await firestore.collection("horizon_events").add({
              type: eventType,
              eventId,
              roomId: String(roomId),
              message: String(message).slice(0, 2000),
              userId: userId ? String(userId) : null,
              status: "pending",
              createdAt: Date.now(),
            });
          }
          return res.json({ ok: true, type: eventType });
        }

        case "monitoring.ack":
        case "alert.ack": {
          // Bot acknowledges a monitoring/alert event — log it
          console.log("[horizon] Ack received:", { type: eventType, id: eventId, data: payload.data });
          return res.json({ ok: true, type: eventType });
        }

        default:
          // Unknown event type — accept but flag as unhandled
          console.warn("[horizon] Unhandled inbound event type:", eventType);
          return res.json({ ok: true, unhandled: true, type: eventType });
      }
    } catch (err: any) {
      console.error("[horizon] Inbound event handler error:", err?.message || err);
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

// ============================================================================
// GET /support/status — Health / connection test
// ============================================================================

router.get("/support/status", requireHorizonAuth, (_req: Request, res: Response) => {
  return res.json({
    ok: true,
    service: "StreamLine Horizon Integration",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    capabilities: [
      "chat.message",
      "chat.session_start",
      "chat.session_end",
      "voice.participant_joined",
      "voice.participant_left",
      "voice.room_started",
      "voice.room_ended",
      "voice.egress_ended",
      "support.alert",
    ],
  });
});

// ============================================================================
// GET /support/rooms — List active rooms
// ============================================================================

router.get("/support/rooms", requireHorizonAuth, async (_req: Request, res: Response) => {
  try {
    const snap = await firestore
      .collection("rooms")
      .orderBy("updatedAt", "desc")
      .limit(100)
      .get();

    const rooms = snap.docs.map((doc) => {
      const d = doc.data() || {};
      return {
        roomId: doc.id,
        roomName: d.roomName || d.name || doc.id,
        status: d.status || "idle",
        ownerId: d.ownerId || null,
        visibility: d.visibility || "private",
        createdAt: d.createdAt?._seconds ? d.createdAt._seconds * 1000 : null,
        updatedAt: d.updatedAt?._seconds ? d.updatedAt._seconds * 1000 : null,
      };
    });

    return res.json({ ok: true, rooms });
  } catch (err: any) {
    console.error("[horizon] /support/rooms error:", err?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// ============================================================================
// GET /support/rooms/:roomId — Room detail
// ============================================================================

router.get("/support/rooms/:roomId", requireHorizonAuth, async (req: Request, res: Response) => {
  try {
    const roomId = String(req.params.roomId || "").trim();
    if (!roomId) return res.status(400).json({ error: "roomId_required" });

    const doc = await firestore.collection("rooms").doc(roomId).get();
    if (!doc.exists) return res.status(404).json({ error: "room_not_found" });

    const d = doc.data() || {};
    return res.json({
      ok: true,
      room: {
        roomId: doc.id,
        roomName: d.roomName || d.name || doc.id,
        status: d.status || "idle",
        ownerId: d.ownerId || null,
        visibility: d.visibility || "private",
        chat: d.chat || null,
        hls: d.hls ? { status: d.hls.status } : null,
        createdAt: d.createdAt?._seconds ? d.createdAt._seconds * 1000 : null,
        updatedAt: d.updatedAt?._seconds ? d.updatedAt._seconds * 1000 : null,
      },
    });
  } catch (err: any) {
    console.error("[horizon] /support/rooms/:roomId error:", err?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// ============================================================================
// GET /support/rooms/:roomId/chat — Recent chat messages
// ============================================================================

router.get(
  "/support/rooms/:roomId/chat",
  requireHorizonAuth,
  async (req: Request, res: Response) => {
    try {
      const roomId = String(req.params.roomId || "").trim();
      if (!roomId) return res.status(400).json({ error: "roomId_required" });

      const roomDoc = await firestore.collection("rooms").doc(roomId).get();
      if (!roomDoc.exists) return res.status(404).json({ error: "room_not_found" });

      const roomData = roomDoc.data() || {};
      const sessionId = roomData.chat?.activeSessionId;
      if (!sessionId) {
        return res.json({ ok: true, roomId, sessionId: null, messages: [] });
      }

      const limitParam = Number(req.query.limit) || 50;
      const limit = Math.min(Math.max(limitParam, 1), 200);

      const messagesSnap = await firestore
        .collection("rooms")
        .doc(roomId)
        .collection("chatSessions")
        .doc(sessionId)
        .collection("messages")
        .orderBy("createdAt", "desc")
        .limit(limit)
        .get();

      const messages = messagesSnap.docs
        .map((m) => {
          const md = m.data() || {};
          return {
            id: m.id,
            text: md.text || "",
            createdAt: md.createdAt?.toMillis?.() ?? md.createdAt ?? null,
            sender: {
              identity: md.senderIdentity || null,
              uid: md.senderUid || null,
              role: md.senderRole || null,
              name: md.senderName || null,
            },
          };
        })
        .reverse(); // oldest → newest

      return res.json({ ok: true, roomId, sessionId, messages });
    } catch (err: any) {
      console.error("[horizon] /support/rooms/:roomId/chat error:", err?.message || err);
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

export default router;
