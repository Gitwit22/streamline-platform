/**
 * Horizon Bot API — bot-accessible endpoints (bearer-token auth).
 *
 * These routes are NOT admin-only — they use the shared HORIZON_WEBHOOK_SECRET
 * for authentication so the Horizon bot can call them directly.
 *
 * Mounted at /api/horizon/bot in index.ts.
 *
 *   Inbound Webhook
 *   ───────────────
 *   POST /events
 *     • HMAC-SHA256 signature verification via X-Horizon-Signature header
 *     • Rate-limited (60 req / 60s per IP)
 *     • Accepts bot commands/responses (support.alert, chat.response, monitoring.heartbeat, etc.)
 *
 *   Support API (Bot queries StreamLine)
 *   ────────────────────────────────────
 *   GET /support/status
 *     • Health check / connection test
 *
 *   GET /support/rooms
 *     • List active rooms (with optional ?status filter)
 *
 *   GET /support/rooms/:roomId
 *     • Room detail
 *
 *   GET /support/rooms/:roomId/chat
 *     • Recent chat messages for a room (with ?limit and ?sessionId params)
 *
 * Auth
 * ────
 *   All endpoints require:  Authorization: Bearer <HORIZON_WEBHOOK_SECRET>
 *   POST /events also requires:  X-Horizon-Signature: sha256=<HMAC of body>
 */
import { Router, Request, Response, NextFunction } from "express";
import express from "express";
import { firestore } from "../../firebaseAdmin";
import { logger } from "../../lib/logger";
import { verifyHorizonSecret, getHorizonWebhookConfig } from "../../lib/horizon/webhookConfig";
import { verifySignature } from "../../lib/horizon/hmacVerify";
import { PERMISSION_ERRORS } from "../../lib/permissionErrors";

const router = Router();

/* ── Constants ────────────────────────────────────────────────────────── */

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const MAX_CHAT_LIMIT = 100;
const DEFAULT_CHAT_LIMIT = 50;
const BOT_API_VERSION = "1.0.0";

type SupportRoomStatus = "idle" | "live" | "ended";

/* ── Rate Limiter ─────────────────────────────────────────────────────── */

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

function horizonRateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  if (bucket.count > RATE_LIMIT_MAX) {
    res.status(429).json({ error: "rate_limit_exceeded", retryAfterMs: bucket.resetAt - now });
    return;
  }
  next();
}

// Periodic cleanup of stale rate-limit buckets (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    if (now >= bucket.resetAt) rateBuckets.delete(ip);
  }
}, 5 * 60_000).unref();

/* ── Middleware: Bearer token authentication ───────────────────────────── */

function requireBotAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
  if (!verifyHorizonSecret(authHeader)) {
    res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    return;
  }
  next();
}

// Apply rate limiting to ALL bot API routes
router.use(horizonRateLimit);

/* ═══════════════════════════════════════════════════════════════════════
 * POST /events — Inbound webhook (Bot → StreamLine)
 * ═══════════════════════════════════════════════════════════════════════ */

router.post(
  "/events",
  express.raw({ type: "application/json", limit: "256kb" }),
  requireBotAuth,
  async (req: Request, res: Response) => {
    const requestId = (req as any).id ?? "no-req-id";

    try {
      // ── HMAC signature verification ──────────────────────────────
      const cfg = getHorizonWebhookConfig();
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body));
      if (cfg.webhookSecret) {
        const sigHeader = req.headers["x-horizon-signature"] as string | undefined;
        if (!verifySignature(cfg.webhookSecret, rawBody, sigHeader)) {
          logger.warn({ requestId }, "horizon inbound event — HMAC verification failed");
          res.status(401).json({ error: "invalid_signature" });
          return;
        }
      }

      // ── Parse JSON body ──────────────────────────────────────────
      let payload: any;
      try {
        payload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        res.status(400).json({ error: "invalid_json" });
        return;
      }

      const eventType = typeof payload?.type === "string" ? payload.type.trim() : "";
      const eventId = typeof payload?.id === "string" ? payload.id.trim() : "";

      if (!eventType) {
        res.status(400).json({ error: "missing_event_type" });
        return;
      }

      logger.info({ requestId, eventType, eventId }, "horizon inbound event received");

      // ── Route by event type ──────────────────────────────────────
      switch (eventType) {
        case "support.alert": {
          logger.info({ requestId, eventId, data: payload.data }, "support alert received");
          res.json({ ok: true, type: eventType, id: eventId });
          return;
        }

        case "chat.response": {
          logger.info({ requestId, eventId, data: payload.data }, "chat response received");
          res.json({ ok: true, type: eventType, id: eventId });
          return;
        }

        case "monitoring.heartbeat": {
          logger.info({ requestId, eventId }, "monitoring heartbeat received");
          res.json({ ok: true, type: eventType, id: eventId });
          return;
        }

        case "skill.result": {
          logger.info({ requestId, eventId, data: payload.data }, "skill result received");
          res.json({ ok: true, type: eventType, id: eventId });
          return;
        }

        case "ack": {
          logger.info({ requestId, eventId, data: payload.data }, "ack received");
          res.json({ ok: true, type: eventType, id: eventId });
          return;
        }

        default: {
          // Unknown event type — accept but flag as unhandled
          logger.warn({ requestId, eventType, eventId }, "unhandled inbound event type");
          res.json({ ok: true, unhandled: true, type: eventType });
          return;
        }
      }
    } catch (err: any) {
      logger.error({ requestId, err: err?.message }, "horizon inbound event handler error");
      res.status(500).json({ error: "internal_error" });
    }
  },
);

/* ═══════════════════════════════════════════════════════════════════════
 * GET /support/status — Health / connection test
 * ═══════════════════════════════════════════════════════════════════════ */

router.get("/support/status", requireBotAuth, (_req: Request, res: Response) => {
  const responsePayload = {
    ok: true,
    timestamp: new Date().toISOString(),
    service: "StreamLine Horizon Integration",
    version: BOT_API_VERSION,
  };

  logSupportPayload("status", responsePayload);
  res.json(responsePayload);
});

/* ═══════════════════════════════════════════════════════════════════════
 * GET /support/rooms — List active rooms
 * ═══════════════════════════════════════════════════════════════════════ */

router.get("/support/rooms", requireBotAuth, async (req: Request, res: Response) => {
  const requestId = (req as any).id ?? "no-req-id";

  try {
    const statusFilter = typeof req.query.status === "string" ? req.query.status.trim().toLowerCase() : "";
    const effectiveLimit = Math.min(Math.max(parseInt(String(req.query.limit), 10) || 50, 1), 100);

    let query: FirebaseFirestore.Query = firestore.collection("rooms").orderBy("updatedAt", "desc").limit(effectiveLimit);

    // Optional status filter (e.g. "live", "idle", "ended")
    if (statusFilter) {
      query = query.where("status", "==", statusFilter);
    }

    const snap = await query.get();
    const rooms = snap.docs.map((doc) => normalizeSupportRoom(doc.id, doc.data()));

    logger.info({ requestId, count: rooms.length, statusFilter: statusFilter || "all" }, "horizon support rooms listed");
    logSupportPayload("rooms", rooms, { requestId, count: rooms.length, statusFilter: statusFilter || "all" });
    res.json(rooms);
  } catch (err: any) {
    logger.error({ requestId, err: err?.message }, "support rooms list error");
    res.status(500).json({ error: "internal_error" });
  }
});

/* ═══════════════════════════════════════════════════════════════════════
 * GET /support/rooms/:roomId — Room detail
 * ═══════════════════════════════════════════════════════════════════════ */

router.get("/support/rooms/:roomId", requireBotAuth, async (req: Request, res: Response) => {
  const requestId = (req as any).id ?? "no-req-id";
  const roomId = typeof req.params.roomId === "string" ? req.params.roomId.trim() : "";

  if (!roomId) {
    res.status(400).json({ error: "roomId_required" });
    return;
  }

  try {
    const roomSnap = await firestore.collection("rooms").doc(roomId).get();
    if (!roomSnap.exists) {
      res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
      return;
    }

    const room = normalizeSupportRoomDetail(roomSnap.id, roomSnap.data());

    logger.info({ requestId, roomId }, "horizon support room detail fetched");
    logSupportPayload("room-detail", room, { requestId, roomId });
    res.json(room);
  } catch (err: any) {
    logger.error({ requestId, roomId, err: err?.message }, "support room detail error");
    res.status(500).json({ error: "internal_error" });
  }
});

/* ═══════════════════════════════════════════════════════════════════════
 * GET /support/rooms/:roomId/chat — Recent chat messages
 * ═══════════════════════════════════════════════════════════════════════ */

router.get("/support/rooms/:roomId/chat", requireBotAuth, async (req: Request, res: Response) => {
  const requestId = (req as any).id ?? "no-req-id";
  const roomId = typeof req.params.roomId === "string" ? req.params.roomId.trim() : "";

  if (!roomId) {
    res.status(400).json({ error: "roomId_required" });
    return;
  }

  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit), 10) || DEFAULT_CHAT_LIMIT, 1), MAX_CHAT_LIMIT);

    // Determine which chat session to query
    let sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId.trim() : "";

    if (!sessionId) {
      // Use the active session from the room doc
      const roomSnap = await firestore.collection("rooms").doc(roomId).get();
      if (!roomSnap.exists) {
        res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
        return;
      }
      const roomData = (roomSnap.data() as any) || {};
      sessionId = roomData.chat?.activeSessionId || "";
    }

    if (!sessionId) {
      const messages: any[] = [];
      logSupportPayload("room-chat", messages, { requestId, roomId, sessionId: null, count: 0 });
      res.json(messages);
      return;
    }

    const msgSnap = await firestore
      .collection("rooms")
      .doc(roomId)
      .collection("chatSessions")
      .doc(sessionId)
      .collection("messages")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    const messages = msgSnap.docs.map((doc) => normalizeSupportChatMessage(doc.id, doc.data()));

    // Return in chronological order (oldest first)
    messages.reverse();

    logger.info({ requestId, roomId, sessionId, count: messages.length }, "horizon support room chat fetched");
    logSupportPayload("room-chat", messages, { requestId, roomId, sessionId, count: messages.length });
    res.json(messages);
  } catch (err: any) {
    logger.error({ requestId, roomId, err: err?.message }, "support room chat error");
    res.status(500).json({ error: "internal_error" });
  }
});

/* ── Helpers ──────────────────────────────────────────────────────────── */

/**
 * Convert a Firestore timestamp (or Date/ISO string) to ISO-8601 string.
 */
function tsIso(ts: any): string | null {
  if (!ts) return null;
  if (typeof ts === "string") return ts;
  if (typeof ts.toDate === "function") return ts.toDate().toISOString();
  if (ts instanceof Date) return ts.toISOString();
  if (typeof ts === "number") return new Date(ts).toISOString();
  return null;
}

function normalizeSupportRoom(roomId: string, data: any) {
  const status = normalizeSupportRoomStatus(data);

  return {
    id: roomId,
    name: toRequiredString(data?.name),
    status,
    hostUid: toNullableString(data?.hostUid),
    participantCount: toNumber(data?.participantCount),
    createdAt: tsIso(data?.createdAt),
    updatedAt: tsIso(data?.updatedAt),
    isLive: status === "live",
  };
}

function normalizeSupportRoomDetail(roomId: string, data: any) {
  const status = normalizeSupportRoomStatus(data);

  return {
    id: roomId,
    name: toRequiredString(data?.name),
    status,
    hostUid: toNullableString(data?.hostUid),
    participantCount: toNumber(data?.participantCount),
    createdAt: tsIso(data?.createdAt),
    updatedAt: tsIso(data?.updatedAt),
    isLive: status === "live",
    chat: {
      enabled: toBoolean(data?.chat?.enabled),
      activeSessionId: toNullableString(data?.chat?.activeSessionId),
    },
  };
}

function normalizeSupportChatMessage(messageId: string, data: any) {
  return {
    id: messageId,
    text: toRequiredString(data?.text),
    senderIdentity: toRequiredString(data?.senderIdentity),
    senderName: toRequiredString(data?.senderName),
    senderRole: toRequiredString(data?.senderRole),
    isAgent: toBoolean(data?.isAgent),
    createdAt: tsIso(data?.createdAt) ?? "",
  };
}

function normalizeSupportRoomStatus(data: any): SupportRoomStatus {
  const raw = typeof data?.status === "string" ? data.status.trim().toLowerCase() : "";

  if (raw === "live" || toBoolean(data?.isLive)) return "live";
  if (raw === "ended" || raw === "closed" || raw === "archived") return "ended";
  return "idle";
}

function toRequiredString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function toNullableString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value == null) return null;
  return String(value);
}

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1";
  }
  if (typeof value === "number") return value !== 0;
  return false;
}

function summarizePayloadTypes(value: any): any {
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      itemShape: value.length > 0 ? summarizePayloadTypes(value[0]) : "empty",
    };
  }

  if (value === null) return "null";

  if (value instanceof Date) return "date";

  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [key, summarizePayloadTypes(nestedValue)]));
  }

  return typeof value;
}

function logSupportPayload(endpoint: string, payload: unknown, context: Record<string, unknown> = {}): void {
  const fieldTypes = summarizePayloadTypes(payload);
  console.log(`[support-api:${endpoint}]`, JSON.stringify(payload, null, 2));
  console.log(`[support-api:${endpoint}:types]`, JSON.stringify(fieldTypes, null, 2));
  logger.info({ endpoint, ...context, payload, fieldTypes }, "support api response payload");
}

export default router;
