/**
 * Horizon ↔ StreamLine room hooks.
 *
 * Three endpoints mounted under /api/rooms:
 *
 *   POST /:roomId/chat-events    — outbound chat-event webhook forwarding
 *   POST /:roomId/voice-stream   — outbound audio-chunk webhook forwarding
 *   POST /:roomId/chat           — inbound Horizon agent response posting
 */
import { Router, raw as expressRaw } from "express";
import admin from "firebase-admin";
import { firestore } from "../../firebaseAdmin";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middleware/requireAuth";
import { requireRoomAccessToken, getRoomAccess } from "../../middleware/roomAccessToken";
import { PERMISSION_ERRORS } from "../../lib/permissionErrors";
import { sanitizeDisplayName } from "../../lib/sanitizeDisplayName";
import { parseCommand, DEFAULT_TRIGGER_CONFIG } from "../../lib/horizon/commandParser";
import { forwardChatEvent, forwardVoiceEvent } from "../../lib/horizon/webhookForwarder";
import { verifyHorizonSecret } from "../../lib/horizon/webhookConfig";

const router = Router();

/* ── Constants ────────────────────────────────────────────────────────── */

const MAX_MESSAGE_LEN = 2_000;
const MAX_AUDIO_CHUNK = 5 * 1024 * 1024; // 5 MB per chunk
const AGENT_USER_ID = "horizon-agent";
const AGENT_USERNAME = "Horizon";

const ALLOWED_AUDIO_TYPES = new Set([
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "application/octet-stream",
]);

/* ── Helpers ──────────────────────────────────────────────────────────── */

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function tsMillis(ts: any): number | null {
  if (!ts) return null;
  if (typeof ts === "number") return ts;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.toDate === "function") return ts.toDate().getTime();
  const d = new Date(ts);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : null;
}

async function roomExists(roomId: string): Promise<boolean> {
  const snap = await firestore.collection("rooms").doc(roomId).get();
  return snap.exists;
}

/* ═══════════════════════════════════════════════════════════════════════
 * 1. POST /:roomId/chat-events — outbound chat-event hook
 * ═══════════════════════════════════════════════════════════════════════ */

router.post(
  "/:roomId/chat-events",
  requireAuth,
  requireRoomAccessToken as any,
  async (req: any, res) => {
    const requestId = req.id ?? "no-req-id";
    const roomIdParam = trimStr(req.params.roomId);

    try {
      // Validate room access token matches roomId param
      const { access, roomId: tokenRoomId } = getRoomAccess(req);
      if (roomIdParam && roomIdParam !== tokenRoomId) {
        return res.status(400).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });
      }

      const roomId = tokenRoomId;

      // Extract payload fields (allow caller to provide or derive from token)
      const userId = trimStr(req.body?.userId) || req.user?.uid || access.identity || "";
      const username =
        trimStr(req.body?.username) ||
        sanitizeDisplayName(String(req.user?.displayName || "")).trim() ||
        access.identity ||
        "unknown";
      const message = trimStr(req.body?.message);
      const timestamp = trimStr(req.body?.timestamp) || new Date().toISOString();

      if (!message) {
        return res.status(400).json({ error: "message_required" });
      }
      if (message.length > MAX_MESSAGE_LEN) {
        return res.status(400).json({ error: "message_too_long", max: MAX_MESSAGE_LEN });
      }

      // Validate room exists
      if (!(await roomExists(roomId))) {
        return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
      }

      // Parse for Horizon command triggers + mentions
      const parsed = parseCommand(message, DEFAULT_TRIGGER_CONFIG);

      // Build the outbound webhook payload
      const payload: Record<string, unknown> = {
        event: "message",
        roomId,
        userId,
        username,
        message,
        timestamp,
        mentions: parsed.mentions,
        // Command parsing enrichment
        isCommand: parsed.isCommand,
        matchedTrigger: parsed.matchedTrigger,
        commandText: parsed.commandText,
        originalText: parsed.originalText,
      };

      // Fire-and-forget (non-blocking) — chat continues even if Horizon is down
      forwardChatEvent(payload, requestId);

      logger.info(
        { requestId, roomId, userId, isCommand: parsed.isCommand, trigger: parsed.matchedTrigger },
        "chat-event hook fired",
      );

      return res.json({
        ok: true,
        forwarded: true,
        isCommand: parsed.isCommand,
        matchedTrigger: parsed.matchedTrigger,
      });
    } catch (err: any) {
      logger.error({ requestId, roomId: roomIdParam, err: err?.message }, "chat-events route error");
      return res.status(500).json({ error: "internal_error" });
    }
  },
);

/* ═══════════════════════════════════════════════════════════════════════
 * 2. POST /:roomId/voice-stream — outbound voice-event hook
 * ═══════════════════════════════════════════════════════════════════════ */

router.post(
  "/:roomId/voice-stream",
  requireAuth,
  requireRoomAccessToken as any,
  // Parse raw binary body (up to 5 MB)
  expressRaw({ type: ["audio/*", "application/octet-stream"], limit: "5mb" }),
  async (req: any, res) => {
    const requestId = req.id ?? "no-req-id";
    const roomIdParam = trimStr(req.params.roomId);

    try {
      // Validate room access
      const { access, roomId: tokenRoomId } = getRoomAccess(req);
      if (roomIdParam && roomIdParam !== tokenRoomId) {
        return res.status(400).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });
      }

      const roomId = tokenRoomId;

      // Only hosts/cohosts/participants can stream voice (not viewers)
      const role = String(access.role || "").toLowerCase();
      if (role === "viewer") {
        return res.status(403).json({ error: "viewers_cannot_stream_voice" });
      }

      // Content-Type validation
      const contentType = trimStr(req.headers["content-type"]).toLowerCase().split(";")[0].trim();
      if (!ALLOWED_AUDIO_TYPES.has(contentType)) {
        return res.status(415).json({
          error: "unsupported_content_type",
          allowed: [...ALLOWED_AUDIO_TYPES],
        });
      }

      // Extract speaker identity from headers or token
      const userId = trimStr(req.headers["x-user-id"]) || req.user?.uid || access.identity || "";
      const username =
        trimStr(req.headers["x-username"]) ||
        sanitizeDisplayName(String(req.user?.displayName || "")).trim() ||
        access.identity ||
        "unknown";

      // Body must be a Buffer
      const audioBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
      if (audioBuffer.length === 0) {
        return res.status(400).json({ error: "empty_audio_payload" });
      }
      if (audioBuffer.length > MAX_AUDIO_CHUNK) {
        return res.status(413).json({ error: "audio_chunk_too_large", maxBytes: MAX_AUDIO_CHUNK });
      }

      // Validate room exists
      if (!(await roomExists(roomId))) {
        return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
      }

      // Fire-and-forget forward to Horizon voice receiver
      forwardVoiceEvent(audioBuffer, {
        contentType,
        roomId,
        userId,
        username,
        requestId,
      });

      logger.info(
        { requestId, roomId, userId, bytes: audioBuffer.length, contentType },
        "voice-stream hook fired",
      );

      return res.json({ ok: true, forwarded: true, bytes: audioBuffer.length });
    } catch (err: any) {
      logger.error({ requestId, roomId: roomIdParam, err: err?.message }, "voice-stream route error");
      return res.status(500).json({ error: "internal_error" });
    }
  },
);

/* ═══════════════════════════════════════════════════════════════════════
 * 3. POST /:roomId/chat — inbound Horizon agent response posting
 * ═══════════════════════════════════════════════════════════════════════ */

router.post("/:roomId/chat", async (req: any, res) => {
  const requestId = req.id ?? "no-req-id";
  const roomId = trimStr(req.params.roomId);

  try {
    // ── Auth: require shared secret (Horizon → StreamLine trust) ──
    const authHeader = trimStr(req.headers?.authorization);
    if (!verifyHorizonSecret(authHeader)) {
      logger.warn({ requestId, roomId }, "agent chat post — invalid/missing webhook secret");
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    // ── Validate payload ───────────────────────────────────────────
    const userId = trimStr(req.body?.userId);
    const username = trimStr(req.body?.username);
    const message = trimStr(req.body?.message);

    if (!roomId) {
      return res.status(400).json({ error: "roomId_required" });
    }
    if (!message) {
      return res.status(400).json({ error: "message_required" });
    }
    if (message.length > MAX_MESSAGE_LEN) {
      return res.status(400).json({ error: "message_too_long", max: MAX_MESSAGE_LEN });
    }

    // Only the reserved agent identity may use this route.
    // Allow "horizon-agent" or any identifier that starts with "horizon-".
    const effectiveUserId = userId || AGENT_USER_ID;
    const effectiveUsername = username || AGENT_USERNAME;

    if (!effectiveUserId.startsWith("horizon-")) {
      logger.warn({ requestId, roomId, userId: effectiveUserId }, "agent chat post — non-horizon userId rejected");
      return res.status(403).json({ error: "only_horizon_agents_allowed" });
    }

    // ── Room existence check ───────────────────────────────────────
    const roomRef = firestore.collection("rooms").doc(roomId);
    const roomSnap = await roomRef.get();
    if (!roomSnap.exists) {
      return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
    }

    // ── Find active chat session ───────────────────────────────────
    const roomData = (roomSnap.data() as any) || {};
    const chat = roomData.chat || {};
    const activeSessionId = typeof chat.activeSessionId === "string" ? chat.activeSessionId.trim() : "";

    if (!activeSessionId) {
      return res.status(409).json({ error: "no_active_chat_session" });
    }

    // ── Insert agent message into Firestore ────────────────────────
    const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();
    const messageRef = roomRef
      .collection("chatSessions")
      .doc(activeSessionId)
      .collection("messages")
      .doc();

    await messageRef.set(
      {
        text: message,
        createdAt: serverTimestamp,
        senderIdentity: effectiveUserId,
        senderUid: effectiveUserId,
        senderRole: "agent",
        senderName: effectiveUsername,
        isAgent: true,
      },
      { merge: false },
    );

    logger.info(
      { requestId, roomId, sessionId: activeSessionId, messageId: messageRef.id, agentId: effectiveUserId },
      "horizon agent message posted to room chat",
    );

    // NOTE: The existing SSE /chat/stream endpoint (roomChat.ts) listens via
    // Firestore onSnapshot, so connected participants will receive this message
    // in real time automatically — no separate broadcast needed.

    return res.json({
      ok: true,
      roomId,
      sessionId: activeSessionId,
      message: {
        id: messageRef.id,
        text: message,
        sender: {
          identity: effectiveUserId,
          uid: effectiveUserId,
          role: "agent",
          name: effectiveUsername,
        },
      },
    });
  } catch (err: any) {
    logger.error({ requestId, roomId, err: err?.message }, "agent chat post route error");
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
