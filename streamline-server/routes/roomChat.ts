import { Router } from "express";
import admin from "firebase-admin";
import { firestore } from "../firebaseAdmin";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { sanitizeDisplayName } from "../lib/sanitizeDisplayName";
import { getRoomAccess, requireRoomAccessToken } from "../middleware/roomAccessToken";

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
      .map((d) => {
      const data = (d.data() as any) || {};
      return {
        id: d.id,
        text: typeof data.text === "string" ? data.text : "",
        createdAtMs: timestampToMillis(data.createdAt),
        sender: {
          identity: typeof data.senderIdentity === "string" ? data.senderIdentity : null,
          uid: typeof data.senderUid === "string" ? data.senderUid : null,
          role: typeof data.senderRole === "string" ? data.senderRole : null,
          name: typeof data.senderName === "string" ? data.senderName : null,
        },
      };
    });

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
        if (!initialized) {
          initialized = true;
          return;
        }

        for (const change of snap.docChanges()) {
          if (change.type !== "added") continue;
          const d = change.doc;
          const data = (d.data() as any) || {};
          send("message", {
            id: d.id,
            text: typeof data.text === "string" ? data.text : "",
            createdAtMs: timestampToMillis(data.createdAt),
            sender: {
              identity: typeof data.senderIdentity === "string" ? data.senderIdentity : null,
              uid: typeof data.senderUid === "string" ? data.senderUid : null,
              role: typeof data.senderRole === "string" ? data.senderRole : null,
              name: typeof data.senderName === "string" ? data.senderName : null,
            },
          });
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
