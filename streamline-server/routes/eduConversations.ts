/**
 * eduConversations — Unified conversations API for EDU organisations.
 *
 * Models two conversation types:
 *   • "dm"   — Private 1:1 thread between two staff members (deterministic ID)
 *   • "room" — Group chat room with named participants
 *
 * Firestore collections (tenant-scoped):
 *   conversations        — conversation metadata
 *   conversationMessages — individual messages (conversationId indexed)
 *
 * Routes (mounted at /api/edu):
 *   GET    /conversations                       → list all conversations for the user
 *   POST   /conversations/dm                    → get-or-create a DM with another user
 *   POST   /conversations/room                  → create a group chat room
 *   GET    /conversations/:id                   → get a single conversation
 *   GET    /conversations/:id/messages          → list messages (paginated)
 *   POST   /conversations/:id/messages          → send a message
 *   POST   /conversations/:id/typing            → broadcast typing indicator
 *   GET    /conversations/stream                → SSE stream for real-time updates
 *   GET    /conversations/:id/members           → list members of a conversation
 *   POST   /conversations/:id/members           → add members to a room
 *   DELETE /conversations/:id/members/:uid      → remove a member from a room
 */

import express from "express";
import { requireAuth } from "../middleware/requireAuth";
import { tenantCol, globalCol } from "../lib/dbPaths";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { createNotification, NOTIFICATION_TYPES } from "../services/notificationService";

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
  avatar: string | null;
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

  const avatar = typeof user?.avatar === "string" ? user.avatar : null;

  return { orgId, orgRole, userName, avatar };
}

/** Resolve a user's display name by uid. */
async function resolveUserName(uid: string): Promise<string> {
  try {
    const snap = await globalCol("users").doc(uid).get();
    if (!snap.exists) return "User";
    const data = snap.data() as any;
    return (
      (typeof data?.name === "string" && data.name.trim()) ||
      (typeof data?.displayName === "string" && data.displayName.trim()) ||
      "User"
    );
  } catch {
    return "User";
  }
}

/* ── Normalizers ───────────────────────────────────────────────── */

interface ConversationDoc {
  id: string;
  type: "dm" | "room";
  orgId: string;
  name: string;
  participants: string[];        // user UIDs
  participantNames: Record<string, string>; // uid → display name
  lastMessage: string;
  lastMessageAt: number | null;
  lastMessageSenderUid: string;
  unreadCounts: Record<string, number>;  // uid → unread count
  createdAt: number | null;
  createdBy: string;
  isPrivate: boolean;
}

function normalizeConversation(docId: string, data: any): ConversationDoc {
  return {
    id: docId,
    type: data?.type === "dm" ? "dm" : "room",
    orgId: asString(data?.orgId),
    name: asString(data?.name),
    participants: Array.isArray(data?.participants)
      ? data.participants.map((p: any) => asString(p)).filter(Boolean)
      : [],
    participantNames: typeof data?.participantNames === "object" && data.participantNames
      ? data.participantNames
      : {},
    lastMessage: asString(data?.lastMessage),
    lastMessageAt: coerceMillis(data?.lastMessageAt),
    lastMessageSenderUid: asString(data?.lastMessageSenderUid),
    unreadCounts: typeof data?.unreadCounts === "object" && data.unreadCounts
      ? data.unreadCounts
      : {},
    createdAt: coerceMillis(data?.createdAt),
    createdBy: asString(data?.createdBy),
    isPrivate: !!data?.isPrivate,
  };
}

interface MessageDoc {
  id: string;
  conversationId: string;
  senderUid: string;
  senderName: string;
  content: string;
  type: string;             // "text" | "image" | "file" | "system"
  attachmentUrl: string;
  createdAt: number | null;
}

function normalizeMessage(docId: string, data: any): MessageDoc {
  return {
    id: docId,
    conversationId: asString(data?.conversationId),
    senderUid: asString(data?.senderUid),
    senderName: asString(data?.senderName),
    content: asString(data?.content),
    type: asString(data?.type || "text"),
    attachmentUrl: asString(data?.attachmentUrl),
    createdAt: coerceMillis(data?.createdAt),
  };
}

/* ── SSE real-time hub ─────────────────────────────────────────── */

type SseClient = {
  uid: string;
  orgId: string;
  res: express.Response;
};

const sseClients: SseClient[] = [];

function broadcastToOrg(orgId: string, event: string, data: any, excludeUid?: string) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    if (client.orgId === orgId && client.uid !== excludeUid) {
      try {
        client.res.write(payload);
      } catch {
        // Client disconnected — will be cleaned up on close event
      }
    }
  }
}

function broadcastToUsers(orgId: string, uids: string[], event: string, data: any, excludeUid?: string) {
  const uidSet = new Set(uids);
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    if (client.orgId === orgId && uidSet.has(client.uid) && client.uid !== excludeUid) {
      try {
        client.res.write(payload);
      } catch {
        // Client disconnected
      }
    }
  }
}

/* ── GET /conversations/stream — SSE endpoint ─────────────────── */

router.get("/conversations/stream", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  const ctx = await getEduContext(uid);
  if (!ctx) return res.status(403).json({ error: "not_edu_member" });

  // Set SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // Disable nginx buffering
  });
  res.flushHeaders();

  // Send initial heartbeat
  res.write(`event: connected\ndata: ${JSON.stringify({ uid, orgId: ctx.orgId })}\n\n`);

  const client: SseClient = { uid, orgId: ctx.orgId, res };
  sseClients.push(client);

  // Heartbeat every 30s to keep the connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 30_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    const idx = sseClients.indexOf(client);
    if (idx >= 0) sseClients.splice(idx, 1);
  });
});

/* ── GET /conversations — list user's conversations ────────────── */

router.get("/conversations", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getEduContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    // Query conversations where this user is a participant
    const snap = await tenantCol("conversations")
      .where("orgId", "==", ctx.orgId)
      .where("participants", "array-contains", uid)
      .limit(200)
      .get();

    const conversations = snap.docs
      .map((d) => normalizeConversation(d.id, d.data()))
      .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));

    return res.json({ conversations });
  } catch (err: any) {
    console.error("[edu/conversations] list error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── POST /conversations/dm — get-or-create DM ────────────────── */

router.post("/conversations/dm", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getEduContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    const targetUserId = asString(req.body.targetUserId).trim();
    if (!targetUserId) return res.status(400).json({ error: "targetUserId_required" });
    if (targetUserId === uid) return res.status(400).json({ error: "cannot_dm_self" });

    // Deterministic conversation ID for DMs
    const pairKey = [uid, targetUserId].sort().join("_");
    const convoId = `${ctx.orgId}_dm_${pairKey}`;

    const convoRef = tenantCol("conversations").doc(convoId);
    const snap = await convoRef.get();

    if (snap.exists) {
      const convo = normalizeConversation(convoId, snap.data());
      return res.json({ conversation: convo, created: false });
    }

    // Resolve target user name
    const targetName = await resolveUserName(targetUserId);

    const now = Date.now();
    const doc = {
      type: "dm",
      orgId: ctx.orgId,
      name: `${ctx.userName} & ${targetName}`,
      participants: [uid, targetUserId],
      participantNames: {
        [uid]: ctx.userName,
        [targetUserId]: targetName,
      },
      lastMessage: "",
      lastMessageAt: now,
      lastMessageSenderUid: "",
      unreadCounts: { [uid]: 0, [targetUserId]: 0 },
      createdAt: now,
      createdBy: uid,
      isPrivate: true,
    };

    await convoRef.set(doc, { merge: true });

    const convo = normalizeConversation(convoId, doc);

    // Notify via SSE so the other user's sidebar updates
    broadcastToUsers(ctx.orgId, [targetUserId], "conversation:created", { conversation: convo });

    return res.json({ conversation: convo, created: true });
  } catch (err: any) {
    console.error("[edu/conversations] dm error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── POST /conversations/room — create a group chat ────────────── */

router.post("/conversations/room", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getEduContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    if (ctx.orgRole !== "faculty_admin" && ctx.orgRole !== "faculty_teacher") {
      return res.status(403).json({ error: "faculty_only" });
    }

    const name = asString(req.body.name).trim();
    if (!name) return res.status(400).json({ error: "name_required" });

    // Initial participants: creator + any specified members
    const rawMembers: string[] = Array.isArray(req.body.members)
      ? req.body.members.map((m: any) => asString(m).trim()).filter(Boolean)
      : [];
    const participantSet = new Set([uid, ...rawMembers]);
    const participants = Array.from(participantSet);

    // Resolve names for all participants
    const participantNames: Record<string, string> = { [uid]: ctx.userName };
    await Promise.all(
      participants
        .filter((p) => p !== uid)
        .map(async (p) => {
          participantNames[p] = await resolveUserName(p);
        }),
    );

    const now = Date.now();
    const convoId = `${ctx.orgId}_room_${now}_${Math.random().toString(36).slice(2, 8)}`;

    const unreadCounts: Record<string, number> = {};
    participants.forEach((p) => (unreadCounts[p] = 0));

    const doc = {
      type: "room",
      orgId: ctx.orgId,
      name,
      participants,
      participantNames,
      lastMessage: "",
      lastMessageAt: now,
      lastMessageSenderUid: "",
      unreadCounts,
      createdAt: now,
      createdBy: uid,
      isPrivate: !!req.body.isPrivate,
    };

    await tenantCol("conversations").doc(convoId).set(doc, { merge: true });

    const convo = normalizeConversation(convoId, doc);

    // Notify all members via SSE
    broadcastToUsers(
      ctx.orgId,
      participants.filter((p) => p !== uid),
      "conversation:created",
      { conversation: convo },
    );

    return res.json({ conversation: convo });
  } catch (err: any) {
    console.error("[edu/conversations] create room error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── GET /conversations/:id — get a single conversation ────────── */

router.get("/conversations/:id", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getEduContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    const convoId = req.params.id;
    const snap = await tenantCol("conversations").doc(convoId).get();
    if (!snap.exists) return res.status(404).json({ error: "not_found" });

    const convo = normalizeConversation(convoId, snap.data());
    if (convo.orgId !== ctx.orgId) return res.status(403).json({ error: "wrong_org" });
    if (!convo.participants.includes(uid)) return res.status(403).json({ error: "not_a_member" });

    return res.json({ conversation: convo });
  } catch (err: any) {
    console.error("[edu/conversations] get error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── GET /conversations/:id/messages — list messages ───────────── */

router.get("/conversations/:id/messages", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getEduContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    const convoId = req.params.id;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 50, 1), 200);

    // Verify user is a member
    const convoSnap = await tenantCol("conversations").doc(convoId).get();
    if (!convoSnap.exists) return res.status(404).json({ error: "not_found" });
    const convo = convoSnap.data() as any;
    if (convo.orgId !== ctx.orgId) return res.status(403).json({ error: "wrong_org" });
    if (!Array.isArray(convo.participants) || !convo.participants.includes(uid)) {
      return res.status(403).json({ error: "not_a_member" });
    }

    let messages: MessageDoc[] = [];
    try {
      let query = tenantCol("conversationMessages")
        .where("conversationId", "==", convoId)
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
      console.warn("[edu/conversations] messages compound query failed, falling back:", indexErr?.message);
      const snap = await tenantCol("conversationMessages")
        .where("conversationId", "==", convoId)
        .limit(limit)
        .get();
      messages = snap.docs
        .map((d) => normalizeMessage(d.id, d.data()))
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

      const before = coerceMillis(req.query.before as string);
      if (before) {
        messages = messages.filter((m) => (m.createdAt ?? 0) < before);
      }
      messages = messages.slice(-limit);
    }

    // Mark conversation as read for this user
    try {
      await tenantCol("conversations").doc(convoId).set(
        { unreadCounts: { [uid]: 0 } },
        { merge: true },
      );
    } catch { /* best-effort */ }

    return res.json({ messages });
  } catch (err: any) {
    console.error("[edu/conversations] messages error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── POST /conversations/:id/messages — send a message ─────────── */

router.post("/conversations/:id/messages", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getEduContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    const convoId = req.params.id;
    const content = asString(req.body.content).trim();
    if (!content) return res.status(400).json({ error: "content_required" });

    // Verify membership
    const convoSnap = await tenantCol("conversations").doc(convoId).get();
    if (!convoSnap.exists) return res.status(404).json({ error: "not_found" });
    const convo = convoSnap.data() as any;
    if (convo.orgId !== ctx.orgId) return res.status(403).json({ error: "wrong_org" });
    if (!Array.isArray(convo.participants) || !convo.participants.includes(uid)) {
      return res.status(403).json({ error: "not_a_member" });
    }

    const now = Date.now();
    const msgId = `${convoId}_msg_${now}_${Math.random().toString(36).slice(2, 8)}`;

    const msgDoc = {
      conversationId: convoId,
      senderUid: uid,
      senderName: ctx.userName,
      content,
      type: asString(req.body.type || "text"),
      attachmentUrl: asString(req.body.attachmentUrl),
      createdAt: now,
    };

    await tenantCol("conversationMessages").doc(msgId).set(msgDoc, { merge: true });

    // Update conversation metadata
    const preview = `${ctx.userName}: ${content.slice(0, 100)}`;
    const unreadUpdates: Record<string, number> = {};
    for (const p of (convo.participants as string[])) {
      if (p !== uid) {
        // Increment unread count for other participants
        const current = typeof convo.unreadCounts?.[p] === "number" ? convo.unreadCounts[p] : 0;
        unreadUpdates[p] = current + 1;
      } else {
        unreadUpdates[p] = 0; // Sender always has 0 unread
      }
    }

    await tenantCol("conversations").doc(convoId).set(
      {
        lastMessage: preview,
        lastMessageAt: now,
        lastMessageSenderUid: uid,
        unreadCounts: unreadUpdates,
      },
      { merge: true },
    );

    const message = normalizeMessage(msgId, msgDoc);

    // Broadcast via SSE to other participants
    const otherParticipants = (convo.participants as string[]).filter((p: string) => p !== uid);
    broadcastToUsers(ctx.orgId, otherParticipants, "message:new", {
      conversationId: convoId,
      message,
    });

    // Also broadcast updated conversation metadata
    broadcastToUsers(ctx.orgId, otherParticipants, "conversation:updated", {
      conversationId: convoId,
      lastMessage: preview,
      lastMessageAt: now,
      lastMessageSenderUid: uid,
      unreadCounts: unreadUpdates,
    });

    // Send notification to offline participants (best-effort)
    for (const targetUid of otherParticipants) {
      createNotification({
        userId: targetUid,
        type: NOTIFICATION_TYPES.NEW_CHAT_MESSAGE,
        title: convo.type === "dm" ? `Message from ${ctx.userName}` : `New message in ${convo.name || "chat"}`,
        message: content.slice(0, 200),
        link: `/streamline/edu/chat?c=${convoId}`,
        metadata: { conversationId: convoId, senderUid: uid, senderName: ctx.userName },
      }).catch((err) => {
        console.error("[edu/conversations] notification error:", err?.message || err);
      });
    }

    return res.json({ message });
  } catch (err: any) {
    console.error("[edu/conversations] send error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── POST /conversations/:id/typing — typing indicator ─────────── */

router.post("/conversations/:id/typing", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getEduContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    const convoId = req.params.id;

    // Verify membership (lightweight — just read participants)
    const convoSnap = await tenantCol("conversations").doc(convoId).get();
    if (!convoSnap.exists) return res.status(404).json({ error: "not_found" });
    const convo = convoSnap.data() as any;
    if (!Array.isArray(convo.participants) || !convo.participants.includes(uid)) {
      return res.status(403).json({ error: "not_a_member" });
    }

    const otherParticipants = (convo.participants as string[]).filter((p: string) => p !== uid);
    broadcastToUsers(ctx.orgId, otherParticipants, "typing", {
      conversationId: convoId,
      uid,
      userName: ctx.userName,
    });

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[edu/conversations] typing error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── POST /conversations/:id/read — mark conversation as read ──── */

router.post("/conversations/:id/read", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getEduContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    const convoId = req.params.id;

    await tenantCol("conversations").doc(convoId).set(
      { unreadCounts: { [uid]: 0 } },
      { merge: true },
    );

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[edu/conversations] read error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── GET /conversations/:id/members — list members ─────────────── */

router.get("/conversations/:id/members", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getEduContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    const convoId = req.params.id;
    const convoSnap = await tenantCol("conversations").doc(convoId).get();
    if (!convoSnap.exists) return res.status(404).json({ error: "not_found" });
    const convo = convoSnap.data() as any;
    if (convo.orgId !== ctx.orgId) return res.status(403).json({ error: "wrong_org" });

    const participants: string[] = Array.isArray(convo.participants) ? convo.participants : [];
    const participantNames = convo.participantNames || {};

    const members = participants.map((p) => ({
      uid: p,
      name: asString(participantNames[p]) || "User",
    }));

    return res.json({ members });
  } catch (err: any) {
    console.error("[edu/conversations] members error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── POST /conversations/:id/members — add members to room ─────── */

router.post("/conversations/:id/members", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getEduContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    const convoId = req.params.id;
    const convoSnap = await tenantCol("conversations").doc(convoId).get();
    if (!convoSnap.exists) return res.status(404).json({ error: "not_found" });
    const convo = convoSnap.data() as any;

    if (convo.orgId !== ctx.orgId) return res.status(403).json({ error: "wrong_org" });
    if (convo.type === "dm") return res.status(400).json({ error: "cannot_add_to_dm" });

    const newMembers: string[] = Array.isArray(req.body.members)
      ? req.body.members.map((m: any) => asString(m).trim()).filter(Boolean)
      : [];
    if (!newMembers.length) return res.status(400).json({ error: "members_required" });

    const existingParticipants: string[] = Array.isArray(convo.participants)
      ? convo.participants
      : [];
    const existingNames = convo.participantNames || {};

    const toAdd = newMembers.filter((m) => !existingParticipants.includes(m));
    if (!toAdd.length) return res.json({ ok: true, added: 0 });

    // Resolve names
    const newNames: Record<string, string> = { ...existingNames };
    const newUnread: Record<string, number> = { ...(convo.unreadCounts || {}) };
    await Promise.all(
      toAdd.map(async (m) => {
        newNames[m] = await resolveUserName(m);
        newUnread[m] = 0;
      }),
    );

    const updatedParticipants = [...existingParticipants, ...toAdd];

    await tenantCol("conversations").doc(convoId).set(
      {
        participants: updatedParticipants,
        participantNames: newNames,
        unreadCounts: newUnread,
      },
      { merge: true },
    );

    // Notify new members via SSE
    const convoData = normalizeConversation(convoId, {
      ...convo,
      participants: updatedParticipants,
      participantNames: newNames,
      unreadCounts: newUnread,
    });
    broadcastToUsers(ctx.orgId, toAdd, "conversation:created", { conversation: convoData });

    return res.json({ ok: true, added: toAdd.length });
  } catch (err: any) {
    console.error("[edu/conversations] add members error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── DELETE /conversations/:id/members/:uid — remove member ────── */

router.delete("/conversations/:id/members/:memberUid", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getEduContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    const convoId = req.params.id;
    const memberUid = req.params.memberUid;

    const convoSnap = await tenantCol("conversations").doc(convoId).get();
    if (!convoSnap.exists) return res.status(404).json({ error: "not_found" });
    const convo = convoSnap.data() as any;

    if (convo.orgId !== ctx.orgId) return res.status(403).json({ error: "wrong_org" });
    if (convo.type === "dm") return res.status(400).json({ error: "cannot_remove_from_dm" });

    // Only creator or admins can remove members (or self-remove)
    if (uid !== memberUid && convo.createdBy !== uid && ctx.orgRole !== "faculty_admin") {
      return res.status(403).json({ error: "not_allowed" });
    }

    const participants: string[] = Array.isArray(convo.participants) ? convo.participants : [];
    const updated = participants.filter((p) => p !== memberUid);

    await tenantCol("conversations").doc(convoId).set(
      { participants: updated },
      { merge: true },
    );

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[edu/conversations] remove member error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
