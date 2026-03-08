/**
 * eduChat — Faculty chat rooms & messages for Edu organisations.
 *
 * Routes (mounted at /api/edu):
 *   GET    /chat/rooms                     → list chat rooms for the org
 *   POST   /chat/rooms                     → create a new chat room
 *   GET    /chat/rooms/:id/messages        → list messages for a room
 *   POST   /chat/rooms/:id/messages        → send a message to a room
 */

import express from "express";
import { requireAuth } from "../middleware/requireAuth";
import { tenantCol, globalCol } from "../lib/dbPaths";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";

const router = express.Router();

/* ── Helpers ───────────────────────────────────────────────────── */

function asString(v: any): string {
  return typeof v === "string" ? v : "";
}

function coerceMillis(value: any): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Resolve orgId + orgRole + userName from the authenticated user's uid. */
async function getEduContext(uid: string): Promise<{
  orgId: string;
  orgRole: string;
  userName: string;
} | null> {
  const userSnap = await globalCol("users").doc(uid).get().catch(() => null as any);
  const user = userSnap && userSnap.exists ? (userSnap.data() as any) : null;
  if (!user) return null;

  const rawOrgId = user?.orgId ?? user?.org?.id ?? user?.org?.orgId;
  const orgId = typeof rawOrgId === "string" && rawOrgId.trim() ? rawOrgId.trim() : "";
  if (!orgId) return null;

  const memberId = `${orgId}_${uid}`;
  const memberSnap = await tenantCol("orgMembers").doc(memberId).get().catch(() => null as any);
  const member = memberSnap && memberSnap.exists ? (memberSnap.data() as any) : null;
  const orgRole = asString(member?.role || user?.orgRole).trim() || "faculty_teacher";

  const userName =
    typeof user?.name === "string" && user.name.trim()
      ? user.name.trim()
      : typeof user?.displayName === "string" && user.displayName.trim()
        ? user.displayName.trim()
        : typeof user?.email === "string"
          ? user.email
          : "User";

  return { orgId, orgRole, userName };
}

/* ── Normalizers ───────────────────────────────────────────────── */

function normalizeRoom(docId: string, data: any) {
  return {
    id: docId,
    name: asString(data?.name),
    section: asString(data?.section || "general"),
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

/* ── GET /chat/rooms ─ list chat rooms for the org ─────────────── */

router.get("/chat/rooms", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getEduContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    let rooms: ReturnType<typeof normalizeRoom>[] = [];
    try {
      // Try compound query (requires composite index: orgId ASC + lastMessageAt DESC)
      const snap = await tenantCol("eduChatRooms")
        .where("orgId", "==", ctx.orgId)
        .orderBy("lastMessageAt", "desc")
        .limit(100)
        .get();
      rooms = snap.docs.map((d) => normalizeRoom(d.id, d.data()));
    } catch (indexErr: any) {
      // Compound query failed (likely missing composite index) — fall back
      // to a simple equality filter and sort in memory.
      console.warn("[edu/chat] compound query failed, falling back to simple query:", indexErr?.message);
      const snap = await tenantCol("eduChatRooms")
        .where("orgId", "==", ctx.orgId)
        .limit(100)
        .get();
      rooms = snap.docs
        .map((d) => normalizeRoom(d.id, d.data()))
        .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
    }

    return res.json({ rooms });
  } catch (err: any) {
    console.error("[edu/chat] rooms error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── POST /chat/rooms ─ create a new chat room ─────────────────── */

router.post("/chat/rooms", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getEduContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    // Only faculty_admin and faculty_teacher can create rooms
    if (ctx.orgRole !== "faculty_admin" && ctx.orgRole !== "faculty_teacher") {
      return res.status(403).json({ error: "faculty_only" });
    }

    const name = asString(req.body.name).trim();
    if (!name) return res.status(400).json({ error: "name_required" });

    const now = Date.now();
    const roomId = `${ctx.orgId}_eduroom_${now}_${Math.random().toString(36).slice(2, 8)}`;

    const doc = {
      orgId: ctx.orgId,
      name,
      section: asString(req.body.section || "general").trim(),
      isPrivate: !!req.body.isPrivate,
      unreadCount: 0,
      lastMessage: "",
      lastMessageAt: now,
      memberCount: 1,
      createdAt: now,
      createdBy: uid,
    };

    await tenantCol("eduChatRooms").doc(roomId).set(doc, { merge: true });

    return res.json({ room: normalizeRoom(roomId, doc) });
  } catch (err: any) {
    console.error("[edu/chat] create room error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── GET /chat/rooms/:id/messages ─ list messages ──────────────── */

router.get("/chat/rooms/:id/messages", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getEduContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    const roomId = req.params.id;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 50, 1), 200);

    // Verify room belongs to this org
    const roomSnap = await tenantCol("eduChatRooms").doc(roomId).get();
    if (!roomSnap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
    const room = roomSnap.data() as any;
    if (room.orgId !== ctx.orgId) return res.status(403).json({ error: "wrong_org" });

    let messages: ReturnType<typeof normalizeMessage>[] = [];
    try {
      // Compound query (requires composite index: roomId ASC + createdAt DESC)
      let query = tenantCol("eduChatMessages")
        .where("roomId", "==", roomId)
        .orderBy("createdAt", "desc")
        .limit(limit);

      const before = coerceMillis(req.query.before as string);
      if (before) {
        query = query.where("createdAt", "<", before);
      }

      const snap = await query.get();
      messages = snap.docs.map((d) => normalizeMessage(d.id, d.data())).reverse();
    } catch (indexErr: any) {
      // Fallback: simple query + in-memory sort
      console.warn("[edu/chat] messages compound query failed, falling back:", indexErr?.message);
      const snap = await tenantCol("eduChatMessages")
        .where("roomId", "==", roomId)
        .limit(limit)
        .get();
      messages = snap.docs
        .map((d) => normalizeMessage(d.id, d.data()))
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

      // Apply 'before' filter in memory
      const before = coerceMillis(req.query.before as string);
      if (before) {
        messages = messages.filter((m) => (m.createdAt ?? 0) < before);
      }
      messages = messages.slice(-limit);
    }

    return res.json({ messages });
  } catch (err: any) {
    console.error("[edu/chat] messages error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── POST /chat/rooms/:id/messages ─ send a message ────────────── */

router.post("/chat/rooms/:id/messages", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getEduContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    const roomId = req.params.id;
    const content = asString(req.body.content).trim();
    if (!content) return res.status(400).json({ error: "content_required" });

    // Verify room belongs to this org
    const roomSnap = await tenantCol("eduChatRooms").doc(roomId).get();
    if (!roomSnap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
    const room = roomSnap.data() as any;
    if (room.orgId !== ctx.orgId) return res.status(403).json({ error: "wrong_org" });

    const now = Date.now();
    const msgId = `${roomId}_msg_${now}_${Math.random().toString(36).slice(2, 8)}`;

    const doc = {
      roomId,
      senderUid: uid,
      senderName: ctx.userName,
      content,
      type: asString(req.body.type || "text"),
      attachmentUrl: asString(req.body.attachmentUrl),
      createdAt: now,
    };

    await tenantCol("eduChatMessages").doc(msgId).set(doc, { merge: true });

    // Update room's last message
    await tenantCol("eduChatRooms").doc(roomId).set(
      {
        lastMessage: `${doc.senderName}: ${content.slice(0, 100)}`,
        lastMessageAt: now,
      },
      { merge: true },
    );

    return res.json({ message: normalizeMessage(msgId, doc) });
  } catch (err: any) {
    console.error("[edu/chat] send error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
