import express from "express";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { getCorpOrgContext, asString, coerceMillis } from "../lib/corpOrg";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";

const router = express.Router();

function normalizeRoom(docId: string, data: any) {
  return {
    id: docId,
    name: asString(data?.name),
    section: asString(data?.section || "department"),
    isPrivate: !!data?.isPrivate,
    unreadCount: typeof data?.unreadCount === "number" ? data.unreadCount : 0,
    lastMessage: asString(data?.lastMessage),
    lastMessageAt: coerceMillis(data?.lastMessageAt),
    memberCount: typeof data?.memberCount === "number" ? data.memberCount : 0,
    createdAt: coerceMillis(data?.createdAt),
  };
}

function normalizeMessage(docId: string, data: any) {
  return {
    id: docId,
    roomId: asString(data?.roomId),
    senderUid: asString(data?.senderUid),
    senderName: asString(data?.senderName),
    content: asString(data?.content),
    type: asString(data?.type || "text"),
    attachmentUrl: asString(data?.attachmentUrl),
    createdAt: coerceMillis(data?.createdAt),
  };
}

/**
 * GET /chat/rooms — list org chat rooms
 */
router.get("/chat/rooms", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });

    const snap = await db.collection("corpChatRooms")
      .where("orgId", "==", ctx.orgId)
      .orderBy("lastMessageAt", "desc")
      .limit(100)
      .get();

    const rooms = snap.docs.map(d => normalizeRoom(d.id, d.data()));
    return res.json({ rooms });
  } catch (err: any) {
    console.error("[corp/chat] rooms error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/**
 * GET /chat/rooms/:id/messages — get messages for a room
 * Query: ?limit=50&before=timestamp
 */
router.get("/chat/rooms/:id/messages", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });

    const roomId = req.params.id;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 50, 1), 200);

    // Verify room belongs to org
    const roomSnap = await db.collection("corpChatRooms").doc(roomId).get();
    if (!roomSnap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
    const room = roomSnap.data() as any;
    if (room.orgId !== ctx.orgId) return res.status(403).json({ error: "wrong_org" });

    let query = db.collection("corpChatMessages")
      .where("roomId", "==", roomId)
      .orderBy("createdAt", "desc")
      .limit(limit);

    const before = coerceMillis(req.query.before as string);
    if (before) {
      query = query.where("createdAt", "<", before);
    }

    const snap = await query.get();
    const messages = snap.docs.map(d => normalizeMessage(d.id, d.data())).reverse();

    return res.json({ messages });
  } catch (err: any) {
    console.error("[corp/chat] messages error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/**
 * POST /chat/rooms/:id/messages — send a message
 */
router.post("/chat/rooms/:id/messages", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });

    const roomId = req.params.id;
    const content = asString(req.body.content).trim();
    if (!content) return res.status(400).json({ error: "content_required" });

    // Verify room
    const roomSnap = await db.collection("corpChatRooms").doc(roomId).get();
    if (!roomSnap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
    const room = roomSnap.data() as any;
    if (room.orgId !== ctx.orgId) return res.status(403).json({ error: "wrong_org" });

    const now = Date.now();
    const msgId = `${roomId}_msg_${now}_${Math.random().toString(36).slice(2, 8)}`;
    const account = (req as any).account || {};

    const doc = {
      roomId,
      senderUid: uid,
      senderName: asString(account.displayName || account.name || "User"),
      content,
      type: asString(req.body.type || "text"),
      attachmentUrl: asString(req.body.attachmentUrl),
      createdAt: now,
    };

    await db.collection("corpChatMessages").doc(msgId).set(doc, { merge: true });

    // Update room's last message
    await db.collection("corpChatRooms").doc(roomId).set({
      lastMessage: `${doc.senderName}: ${content.slice(0, 100)}`,
      lastMessageAt: now,
    }, { merge: true });

    return res.json({ message: normalizeMessage(msgId, doc) });
  } catch (err: any) {
    console.error("[corp/chat] send error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/**
 * POST /chat/rooms — create a new chat room
 */
router.post("/chat/rooms", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });

    const name = asString(req.body.name).trim();
    if (!name) return res.status(400).json({ error: "name_required" });

    const now = Date.now();
    const roomId = `${ctx.orgId}_room_${now}_${Math.random().toString(36).slice(2, 8)}`;

    const doc = {
      orgId: ctx.orgId,
      name,
      section: asString(req.body.section || "department").trim(),
      isPrivate: !!req.body.isPrivate,
      unreadCount: 0,
      lastMessage: "",
      lastMessageAt: now,
      memberCount: 1,
      createdAt: now,
      createdBy: uid,
    };

    await db.collection("corpChatRooms").doc(roomId).set(doc, { merge: true });

    return res.json({ room: normalizeRoom(roomId, doc) });
  } catch (err: any) {
    console.error("[corp/chat] create room error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
