import { Router } from "express";
import admin from "firebase-admin";
import { firestore } from "../firebaseAdmin";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { sanitizeDisplayName } from "../lib/sanitizeDisplayName";
import { getRoomAccess, requireRoomAccessToken } from "../middleware/roomAccessToken";
import { chatMessageEvent, chatSessionStartEvent, chatSessionEndEvent } from "../lib/horizonEvents";
import { emitChatMessageCreated } from "../events/emitters/chatEmitter";
import { createDiskUpload, cleanupUploadedFile, type UploadedDiskFile } from "../lib/diskUpload";
import {
  deleteFile,
  isR2Configured,
  presignDownloadWithDisposition,
  uploadFileFromPath,
} from "../lib/storageClient";
import { rateLimit, SlidingWindowLimiter } from "../lib/rateLimit";
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_URL_TTL_SECONDS,
  attachmentContentDisposition,
  buildAttachmentKey,
  publicAttachment,
  resolveAttachmentContentType,
  sanitizeAttachmentName,
} from "../lib/chatAttachmentsPure";

const router = Router();

const ACTIVE_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 500;
const MAX_MESSAGE_LEN = 800;

function asTrimmedString(v: any): string {
  if (typeof v !== "string") return "";
  return v.trim();
}

function clampInt(n: any, fallback: number, min: number, max: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function timestampToMillis(ts: any): number | null {
  if (!ts) return null;
  if (typeof ts === "number") return ts;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.toDate === "function") return ts.toDate().getTime();
  const d = new Date(ts);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function sanitizeMessageText(input: any): string {
  if (typeof input !== "string") return "";
  const trimmed = input.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  if (!trimmed) return "";
  // Collapse extreme whitespace spam but preserve intent.
  const collapsed = trimmed.replace(/\s{3,}/g, "  ");
  return collapsed.slice(0, MAX_MESSAGE_LEN);
}

/** Wire shape of a chat message (list + SSE). Storage keys are never exposed. */
function serializeMessage(id: string, raw: any) {
  const data = raw || {};
  const attachment = publicAttachment(data.attachment);
  return {
    id,
    text: typeof data.text === "string" ? data.text : "",
    createdAtMs: timestampToMillis(data.createdAt),
    sender: {
      identity: typeof data.senderIdentity === "string" ? data.senderIdentity : null,
      uid: typeof data.senderUid === "string" ? data.senderUid : null,
      role: typeof data.senderRole === "string" ? data.senderRole : null,
      name: typeof data.senderName === "string" ? data.senderName : null,
    },
    ...(attachment ? { attachment } : {}),
  };
}

async function ensureRoomExists(roomId: string) {
  const roomRef = firestore.collection("rooms").doc(roomId);
  const snap = await roomRef.get();
  if (!snap.exists) {
    throw new Error(PERMISSION_ERRORS.ROOM_NOT_FOUND);
  }
  return { roomRef, room: (snap.data() as any) || {} };
}

async function getOrStartActiveSession(params: {
  roomId: string;
  accessRole: string;
  accessIdentity: string;
  uid?: string | null;
  displayName?: string | null;
  allowAutoStart: boolean;
}): Promise<{
  sessionId: string | null;
  startedAtMs: number | null;
  endedAtMs: number | null;
}> {
  const { roomId, accessRole, accessIdentity, uid, displayName, allowAutoStart } = params;

  const roomRef = firestore.collection("rooms").doc(roomId);

  return await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists) {
      throw new Error(PERMISSION_ERRORS.ROOM_NOT_FOUND);
    }

    const room = (snap.data() as any) || {};
    const chat = (room.chat as any) || {};
    const activeSessionId = typeof chat.activeSessionId === "string" ? chat.activeSessionId.trim() : "";
    const startedAtMs = timestampToMillis(chat.activeSessionStartedAt);
    const endedAtMs = timestampToMillis(chat.activeSessionEndedAt);

    const activeFresh =
      !!activeSessionId &&
      !endedAtMs &&
      !!startedAtMs &&
      Date.now() - startedAtMs < ACTIVE_SESSION_TTL_MS;

    if (activeFresh) {
      return { sessionId: activeSessionId, startedAtMs, endedAtMs };
    }

    if (!allowAutoStart) {
      return { sessionId: null, startedAtMs: null, endedAtMs: null };
    }

    // Viewers can observe an existing session but should not start new ones.
    if (accessRole === "viewer") {
      return { sessionId: null, startedAtMs: null, endedAtMs: null };
    }

    const sessionRef = roomRef.collection("chatSessions").doc();
    const sessionId = sessionRef.id;
    const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

    tx.set(
      roomRef,
      {
        chat: {
          activeSessionId: sessionId,
          activeSessionStartedAt: serverTimestamp,
          activeSessionEndedAt: null,
          updatedAt: serverTimestamp,
        },
        updatedAt: serverTimestamp,
      },
      { merge: true }
    );

    tx.set(
      sessionRef,
      {
        roomId,
        createdAt: serverTimestamp,
        startedAt: serverTimestamp,
        endedAt: null,
        createdByIdentity: accessIdentity,
        createdByUid: uid || null,
        createdByRole: accessRole,
        createdByName: displayName || null,
      },
      { merge: false }
    );

    return { sessionId, startedAtMs: null, endedAtMs: null };
  });
}

router.get("/:roomId/chat/session", requireRoomAccessToken as any, async (req: any, res) => {
  try {
    const { access, roomId: canonicalRoomId } = getRoomAccess(req);

    const requestedRoomId = String(req.params.roomId || "").trim();
    if (requestedRoomId && requestedRoomId !== canonicalRoomId) {
      return res.status(400).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });
    }

    await ensureRoomExists(canonicalRoomId);

    const allowAutoStart = String((req.query as any)?.autostart || "1").trim() !== "0";

    const session = await getOrStartActiveSession({
      roomId: canonicalRoomId,
      accessRole: access.role,
      accessIdentity: access.identity,
      uid: (req as any).user?.uid || null,
      displayName: sanitizeDisplayName(String((req as any).user?.displayName || "")).trim() || null,
      allowAutoStart,
    });

    return res.json({
      roomId: canonicalRoomId,
      sessionId: session.sessionId,
      startedAtMs: session.startedAtMs,
      endedAtMs: session.endedAtMs,
    });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg === PERMISSION_ERRORS.ROOM_NOT_FOUND) {
      return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
    }
    return res.status(500).json({ error: "internal_error" });
  }
});

router.post("/:roomId/chat/session/end", requireRoomAccessToken as any, async (req: any, res) => {
  try {
    const { access, roomId: canonicalRoomId } = getRoomAccess(req);
    const requestedRoomId = String(req.params.roomId || "").trim();
    if (requestedRoomId && requestedRoomId !== canonicalRoomId) {
      return res.status(400).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });
    }

    if (access.role !== "host" && access.role !== "cohost") {
      return res.status(403).json({ error: "not_allowed" });
    }

    const roomRef = firestore.collection("rooms").doc(canonicalRoomId);
    const snap = await roomRef.get();
    if (!snap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });

    const room = (snap.data() as any) || {};
    const chat = (room.chat as any) || {};
    const activeSessionId = typeof chat.activeSessionId === "string" ? chat.activeSessionId.trim() : "";
    if (!activeSessionId) {
      return res.json({ ok: true, ended: false, reason: "no_active_session" });
    }

    const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

    await roomRef.set(
      {
        chat: {
          activeSessionEndedAt: serverTimestamp,
          updatedAt: serverTimestamp,
        },
        updatedAt: serverTimestamp,
      },
      { merge: true }
    );

    await roomRef
      .collection("chatSessions")
      .doc(activeSessionId)
      .set({ endedAt: serverTimestamp, updatedAt: serverTimestamp }, { merge: true });

    // Fire-and-forget: notify Horizon bot of chat session end
    chatSessionEndEvent({ roomId: canonicalRoomId, sessionId: activeSessionId });

    return res.json({ ok: true, ended: true, sessionId: activeSessionId });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg === PERMISSION_ERRORS.ROOM_NOT_FOUND) {
      return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
    }
    return res.status(500).json({ error: "internal_error" });
  }
});

router.get("/:roomId/chat/messages", requireRoomAccessToken as any, async (req: any, res) => {
  try {
    const { roomId: canonicalRoomId } = getRoomAccess(req);

    const requestedRoomId = String(req.params.roomId || "").trim();
    if (requestedRoomId && requestedRoomId !== canonicalRoomId) {
      return res.status(400).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });
    }

    const limit = clampInt((req.query as any)?.limit, DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT);

    const sessionIdRaw = asTrimmedString((req.query as any)?.sessionId);
    const sessionId = sessionIdRaw || null;

    // If sessionId not provided, return messages for the current active session if present.
    let effectiveSessionId = sessionId;
    if (!effectiveSessionId) {
      const roomRef = firestore.collection("rooms").doc(canonicalRoomId);
      const snap = await roomRef.get();
      if (!snap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
      const room = (snap.data() as any) || {};
      const chat = (room.chat as any) || {};
      const active = typeof chat.activeSessionId === "string" ? chat.activeSessionId.trim() : "";
      if (active) effectiveSessionId = active;
    }

    if (!effectiveSessionId) {
      return res.json({ roomId: canonicalRoomId, sessionId: null, messages: [] });
    }

    const messagesSnap = await firestore
      .collection("rooms")
      .doc(canonicalRoomId)
      .collection("chatSessions")
      .doc(effectiveSessionId)
      .collection("messages")
      // Query latest messages for pagination friendliness; we'll reverse for chronological UI.
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    const messages = messagesSnap.docs
      .slice()
      .reverse()
      .map((d) => serializeMessage(d.id, d.data()));

    return res.json({ roomId: canonicalRoomId, sessionId: effectiveSessionId, messages });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg === PERMISSION_ERRORS.ROOM_NOT_FOUND) {
      return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
    }
    return res.status(500).json({ error: "internal_error" });
  }
});

router.post("/:roomId/chat/messages", requireRoomAccessToken as any, async (req: any, res) => {
  try {
    const { access, roomId: canonicalRoomId } = getRoomAccess(req);

    const requestedRoomId = String(req.params.roomId || "").trim();
    if (requestedRoomId && requestedRoomId !== canonicalRoomId) {
      return res.status(400).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });
    }

    const text = sanitizeMessageText(req.body?.text);
    if (!text) {
      return res.status(400).json({ error: "text_required" });
    }

    const rawName = req.body?.displayName ?? req.body?.name;
    const senderName = sanitizeDisplayName(String(rawName || "")).trim() || null;

    await ensureRoomExists(canonicalRoomId);

    const session = await getOrStartActiveSession({
      roomId: canonicalRoomId,
      accessRole: access.role,
      accessIdentity: access.identity,
      uid: (req as any).user?.uid || null,
      displayName: senderName,
      allowAutoStart: true,
    });

    if (!session.sessionId) {
      return res.status(409).json({ error: "no_active_session" });
    }

    const roomRef = firestore.collection("rooms").doc(canonicalRoomId);
    const messageRef = roomRef
      .collection("chatSessions")
      .doc(session.sessionId)
      .collection("messages")
      .doc();

    const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

    await messageRef.set(
      {
        text,
        createdAt: serverTimestamp,
        senderIdentity: access.identity,
        senderUid: (req as any).user?.uid || null,
        senderRole: access.role,
        senderName,
      },
      { merge: false }
    );

    // Fire-and-forget: notify Horizon bot of new chat message
    chatMessageEvent({
      roomId: canonicalRoomId,
      sessionId: session.sessionId,
      messageId: messageRef.id,
      text,
      sender: { identity: access.identity, uid: (req as any).user?.uid || null, role: access.role, name: senderName },
    });

    // Fire-and-forget: emit standardized platform event
    emitChatMessageCreated({
      roomId: canonicalRoomId,
      entityId: messageRef.id,
      actor: {
        userId: (req as any).user?.uid || access.identity,
        username: senderName || access.identity,
        role: access.role,
      },
      data: { sessionId: session.sessionId, text },
    });

    return res.json({
      ok: true,
      roomId: canonicalRoomId,
      sessionId: session.sessionId,
      message: {
        id: messageRef.id,
        text,
        sender: { identity: access.identity, uid: (req as any).user?.uid || null, role: access.role, name: senderName },
      },
    });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg === PERMISSION_ERRORS.ROOM_NOT_FOUND) {
      return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
    }
    return res.status(500).json({ error: "internal_error" });
  }
});

// ── File attachments ────────────────────────────────────────────────────
// Upload: anyone in the room except viewers (host / cohost / participant).
// Download: anyone holding a room access token for this room (viewers too).
// Files go to R2 under room-chat/{roomId}/{sessionId}/{messageId}/; the
// message doc stores the key, clients only ever see name/size/type and get a
// short-lived signed URL that forces a download.

const attachmentUpload = createDiskUpload(CHAT_ATTACHMENT_MAX_BYTES, { defParamCharset: "utf8" });

// 20 files / 10 min per identity per room (per process).
const attachmentLimiter = new SlidingWindowLimiter({ windowMs: 10 * 60_000, max: 20 });

function rejectViewerOrNoStorage(req: any, res: any, next: any) {
  const access = (req as any).roomAccess;
  if (!access || access.role === "viewer") {
    return res.status(403).json({ error: "not_allowed" });
  }
  if (!isR2Configured()) {
    return res.status(503).json({ error: "storage_unavailable" });
  }
  return next();
}

function receiveAttachment(req: any, res: any, next: any) {
  attachmentUpload.single("file")(req, res, (err: any) => {
    if (!err) return next();
    if (err?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "file_too_large", maxBytes: CHAT_ATTACHMENT_MAX_BYTES });
    }
    return res.status(400).json({ error: "upload_failed" });
  });
}

router.post(
  "/:roomId/chat/attachments",
  requireRoomAccessToken as any,
  rejectViewerOrNoStorage,
  rateLimit([
    {
      limiter: attachmentLimiter,
      key: (req) => {
        const a = (req as any).roomAccess;
        return a?.roomId && a?.identity ? `chatfile:${a.roomId}:${a.identity}` : null;
      },
    },
  ]),
  receiveAttachment,
  async (req: any, res) => {
    const file = req.file as UploadedDiskFile | undefined;
    try {
      const { access, roomId: canonicalRoomId } = getRoomAccess(req);

      const requestedRoomId = String(req.params.roomId || "").trim();
      if (requestedRoomId && requestedRoomId !== canonicalRoomId) {
        return res.status(400).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });
      }

      if (!file) return res.status(400).json({ error: "file_required" });
      if (!(file.size > 0)) return res.status(400).json({ error: "empty_file" });

      const fileName = sanitizeAttachmentName(file.originalname);
      if (!fileName) return res.status(400).json({ error: "invalid_file_name" });

      // Content type comes from our allowlist, never from the client header.
      const contentType = resolveAttachmentContentType(fileName);
      if (!contentType) return res.status(415).json({ error: "file_type_not_allowed" });

      const caption = sanitizeMessageText(req.body?.text);
      const rawName = req.body?.displayName ?? req.body?.name;
      const senderName = sanitizeDisplayName(String(rawName || "")).trim() || null;
      const uid = (req as any).user?.uid || null;

      await ensureRoomExists(canonicalRoomId);

      const session = await getOrStartActiveSession({
        roomId: canonicalRoomId,
        accessRole: access.role,
        accessIdentity: access.identity,
        uid,
        displayName: senderName,
        allowAutoStart: true,
      });
      if (!session.sessionId) {
        return res.status(409).json({ error: "no_active_session" });
      }

      const messageRef = firestore
        .collection("rooms")
        .doc(canonicalRoomId)
        .collection("chatSessions")
        .doc(session.sessionId)
        .collection("messages")
        .doc();

      const key = buildAttachmentKey({
        roomId: canonicalRoomId,
        sessionId: session.sessionId,
        messageId: messageRef.id,
        fileName,
      });

      // Upload first: a message must never point at a file that isn't there.
      await uploadFileFromPath(file.path, key, contentType);

      const attachment = { key, name: fileName, size: file.size, contentType };
      try {
        await messageRef.set(
          {
            text: caption,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            senderIdentity: access.identity,
            senderUid: uid,
            senderRole: access.role,
            senderName,
            attachment,
          },
          { merge: false }
        );
      } catch (e) {
        // Don't leave an orphaned object behind if the message write failed.
        await deleteFile(key).catch(() => undefined);
        throw e;
      }

      const sender = { identity: access.identity, uid, role: access.role, name: senderName };
      const publicMeta = publicAttachment(attachment);
      const eventText = caption || `Shared a file: ${fileName}`;

      // Fire-and-forget: Horizon bot + platform events (same as text messages).
      chatMessageEvent({
        roomId: canonicalRoomId,
        sessionId: session.sessionId,
        messageId: messageRef.id,
        text: eventText,
        sender,
      });
      emitChatMessageCreated({
        roomId: canonicalRoomId,
        entityId: messageRef.id,
        actor: { userId: uid || access.identity, username: senderName || access.identity, role: access.role },
        data: { sessionId: session.sessionId, text: eventText, attachment: publicMeta },
      });

      return res.json({
        ok: true,
        roomId: canonicalRoomId,
        sessionId: session.sessionId,
        message: {
          id: messageRef.id,
          text: caption,
          createdAtMs: Date.now(),
          sender,
          attachment: publicMeta,
        },
      });
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg === PERMISSION_ERRORS.ROOM_NOT_FOUND) {
        return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
      }
      console.error("[roomChat] attachment upload failed", { error: msg });
      return res.status(500).json({ error: "internal_error" });
    } finally {
      await cleanupUploadedFile(file);
    }
  }
);

router.get(
  "/:roomId/chat/attachments/:sessionId/:messageId",
  requireRoomAccessToken as any,
  async (req: any, res) => {
    try {
      const { roomId: canonicalRoomId } = getRoomAccess(req);

      const requestedRoomId = String(req.params.roomId || "").trim();
      if (requestedRoomId && requestedRoomId !== canonicalRoomId) {
        return res.status(400).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });
      }

      const sessionId = asTrimmedString(req.params.sessionId);
      const messageId = asTrimmedString(req.params.messageId);
      if (!sessionId || !messageId || sessionId.includes("/") || messageId.includes("/")) {
        return res.status(400).json({ error: "invalid_attachment" });
      }

      // Always resolved under the token's room, so a token for room A can
      // never reach room B's files.
      const snap = await firestore
        .collection("rooms")
        .doc(canonicalRoomId)
        .collection("chatSessions")
        .doc(sessionId)
        .collection("messages")
        .doc(messageId)
        .get();

      const attachment = snap.exists ? (snap.data() as any)?.attachment : null;
      if (!attachment || typeof attachment.key !== "string" || !attachment.key) {
        return res.status(404).json({ error: "attachment_not_found" });
      }
      if (!isR2Configured()) {
        return res.status(503).json({ error: "storage_unavailable" });
      }

      const url = await presignDownloadWithDisposition(
        attachment.key,
        CHAT_ATTACHMENT_URL_TTL_SECONDS,
        attachmentContentDisposition(String(attachment.name || "file")),
        typeof attachment.contentType === "string" ? attachment.contentType : undefined
      );

      res.setHeader("Cache-Control", "no-store");
      return res.json({ url, expiresInSeconds: CHAT_ATTACHMENT_URL_TTL_SECONDS, ...publicAttachment(attachment) });
    } catch (e: any) {
      console.error("[roomChat] attachment url failed", { error: String(e?.message || e) });
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

router.get("/:roomId/chat/stream", requireRoomAccessToken as any, async (req: any, res) => {
  try {
    const { roomId: canonicalRoomId } = getRoomAccess(req);

    const requestedRoomId = String(req.params.roomId || "").trim();
    if (requestedRoomId && requestedRoomId !== canonicalRoomId) {
      res.status(400).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });
      return;
    }

    const sessionId = asTrimmedString((req.query as any)?.sessionId);
    if (!sessionId) {
      res.status(400).json({ error: "sessionId_required" });
      return;
    }

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const send = (event: string, data: any) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    send("ready", { ok: true, roomId: canonicalRoomId, sessionId });

    const query = firestore
      .collection("rooms")
      .doc(canonicalRoomId)
      .collection("chatSessions")
      .doc(sessionId)
      .collection("messages")
      // Tail the latest messages; new messages stay within the window.
      .orderBy("createdAt", "desc")
      .limit(50);

    let initialized = false;
    const unsubscribe = query.onSnapshot(
      (snap) => {
        const changes = snap.docChanges();

        if (!initialized) {
          initialized = true;
          // Initial snapshot: re-sort "added" docs oldest → newest to preserve message order.
          // Query is orderBy(createdAt, "desc"), so initial changes arrive newest → oldest.
          const added = changes
            .filter((c) => c.type === "added")
            .map((c) => c.doc)
            .sort((a, b) => {
              const at = (a.get("createdAt") as any)?.toMillis?.() ?? 0;
              const bt = (b.get("createdAt") as any)?.toMillis?.() ?? 0;
              return at - bt; // oldest → newest
            });

          for (const d of added) {
            send("message", serializeMessage(d.id, d.data()));
          }
          return; // After emitting ordered initial replay, exit this callback
        }

        // Non-initial: emit changes normally
        for (const change of changes) {
          if (change.type !== "added") continue;
          const d = change.doc;
          send("message", serializeMessage(d.id, d.data()));
        }
      },
      (err) => {
        send("error", { error: "firestore_listen_failed", message: String(err?.message || err) });
      }
    );

    const pingTimer = setInterval(() => {
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch {
        // ignore
      }
    }, 20000);

    req.on("close", () => {
      clearInterval(pingTimer);
      try {
        unsubscribe();
      } catch {
        // ignore
      }
      try {
        res.end();
      } catch {
        // ignore
      }
    });
  } catch (e: any) {
    res.status(500).json({ error: "internal_error" });
  }
});

export default router;
