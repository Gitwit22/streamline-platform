/**
 * eduTickets — EDU Support Ticket system.
 *
 * Routes (mounted at /api/edu):
 *   POST   /tickets                        → create a new ticket
 *   GET    /tickets                        → list tickets (with filters)
 *   GET    /tickets/:ticketId              → get single ticket + messages
 *   PATCH  /tickets/:ticketId              → update ticket fields
 *   POST   /tickets/:ticketId/messages     → add reply / internal note
 *   POST   /tickets/:ticketId/close        → close a ticket
 *
 * Firestore collections:
 *   eduSupportTickets          — ticket documents (tenant-scoped)
 *   eduSupportTicketMessages   — message / note subcollection (flat, keyed by ticketId)
 */

import express from "express";
import { requireAuth } from "../middleware/requireAuth";
import { tenantCol, globalCol } from "../lib/dbPaths";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";

const router = express.Router();

/* ── Enums ─────────────────────────────────────────────────────── */

const VALID_STATUSES = ["open", "in_progress", "waiting_on_user", "resolved", "closed"] as const;
const VALID_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const VALID_CATEGORIES = [
  "technical",
  "account",
  "broadcast",
  "room_access",
  "event_issue",
  "student_issue",
  "other",
] as const;
const VALID_MESSAGE_TYPES = ["reply", "internal_note", "status_change"] as const;

type TicketStatus = (typeof VALID_STATUSES)[number];
type TicketPriority = (typeof VALID_PRIORITIES)[number];
type TicketCategory = (typeof VALID_CATEGORIES)[number];
type TicketMessageType = (typeof VALID_MESSAGE_TYPES)[number];

/* ── Role helpers ──────────────────────────────────────────────── */

/** Roles that can view all tickets in a school (not just their own). */
const SCHOOL_ADMIN_ROLES = ["faculty_admin", "principal", "school_admin"];

/** Roles that can view all tickets across the entire tenant. */
const DISTRICT_ROLES = ["district_staff", "support_staff"];

/** All elevated roles with admin-like ticket powers. */
const ELEVATED_ROLES = [...SCHOOL_ADMIN_ROLES, ...DISTRICT_ROLES];

/** Roles that can create internal notes. */
const INTERNAL_NOTE_ROLES = ELEVATED_ROLES;

/** Roles that are explicitly denied ticket access. */
const DENIED_ROLES = ["student_producer", "student_producer_assigned", "talent", "viewer"];

function isElevated(role: string): boolean {
  return ELEVATED_ROLES.includes(role);
}

function isSchoolAdmin(role: string): boolean {
  return SCHOOL_ADMIN_ROLES.includes(role);
}

function isDistrictRole(role: string): boolean {
  return DISTRICT_ROLES.includes(role);
}

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

function normalizeTicket(docId: string, data: any) {
  return {
    id: docId,
    tenantId: asString(data?.tenantId),
    schoolId: asString(data?.schoolId),
    createdByUserId: asString(data?.createdByUserId),
    createdByName: asString(data?.createdByName),
    createdByRole: asString(data?.createdByRole),
    title: asString(data?.title),
    description: asString(data?.description),
    category: asString(data?.category) as TicketCategory,
    priority: asString(data?.priority) as TicketPriority,
    status: asString(data?.status) as TicketStatus,
    assignedToUserId: data?.assignedToUserId ?? null,
    assignedToName: data?.assignedToName ?? null,
    tags: Array.isArray(data?.tags) ? data.tags.filter((t: any) => typeof t === "string") : [],
    createdAt: coerceMillis(data?.createdAt),
    updatedAt: coerceMillis(data?.updatedAt),
    closedAt: data?.closedAt ? coerceMillis(data.closedAt) : null,
  };
}

function normalizeMessage(docId: string, data: any) {
  return {
    id: docId,
    authorUserId: asString(data?.authorUserId),
    authorName: asString(data?.authorName),
    authorRole: asString(data?.authorRole),
    type: asString(data?.type) as TicketMessageType,
    message: asString(data?.message),
    createdAt: coerceMillis(data?.createdAt),
  };
}

/* ══════════════════════════════════════════════════════════════════
   1. POST /tickets — create a new ticket
   ══════════════════════════════════════════════════════════════════ */

router.post("/tickets", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getEduContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    // Students cannot create tickets
    if (DENIED_ROLES.includes(ctx.orgRole)) {
      return res.status(403).json({ error: "no_ticket_access" });
    }

    // ── Validate required fields ──
    const title = asString(req.body.title).trim();
    const description = asString(req.body.description).trim();
    const category = asString(req.body.category).trim();
    const priority = asString(req.body.priority).trim();
    const schoolId = asString(req.body.schoolId).trim();

    if (!title) return res.status(400).json({ error: "title_required" });
    if (!description) return res.status(400).json({ error: "description_required" });
    if (!category || !(VALID_CATEGORIES as readonly string[]).includes(category)) {
      return res.status(400).json({ error: "invalid_category", valid: VALID_CATEGORIES });
    }
    if (!priority || !(VALID_PRIORITIES as readonly string[]).includes(priority)) {
      return res.status(400).json({ error: "invalid_priority", valid: VALID_PRIORITIES });
    }

    const tags = Array.isArray(req.body.tags)
      ? req.body.tags.filter((t: any) => typeof t === "string" && t.trim()).map((t: string) => t.trim())
      : [];

    const now = Date.now();
    const ticketId = `ticket_${ctx.orgId}_${now}_${Math.random().toString(36).slice(2, 8)}`;

    const doc = {
      tenantId: ctx.orgId,
      schoolId: schoolId || ctx.orgId, // default to orgId if not provided
      createdByUserId: uid,
      createdByName: ctx.userName,
      createdByRole: ctx.orgRole,
      title,
      description,
      category,
      priority,
      status: "open" as TicketStatus,
      assignedToUserId: null,
      assignedToName: null,
      tags,
      createdAt: now,
      updatedAt: now,
      closedAt: null,
    };

    await tenantCol("eduSupportTickets").doc(ticketId).set(doc);

    return res.status(201).json({ ticket: normalizeTicket(ticketId, doc) });
  } catch (err: any) {
    console.error("[edu/tickets] create error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ══════════════════════════════════════════════════════════════════
   2. GET /tickets — list tickets (filtered)
   ══════════════════════════════════════════════════════════════════ */

router.get("/tickets", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getEduContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    if (DENIED_ROLES.includes(ctx.orgRole)) {
      return res.status(403).json({ error: "no_ticket_access" });
    }

    // ── Build query ──
    let query: FirebaseFirestore.Query = tenantCol("eduSupportTickets")
      .where("tenantId", "==", ctx.orgId);

    // Teachers can only see their own tickets
    const forceOwn = !isElevated(ctx.orgRole);

    // Query-string filters
    const qStatus = asString(req.query.status as string).trim();
    const qPriority = asString(req.query.priority as string).trim();
    const qCategory = asString(req.query.category as string).trim();
    const qSchoolId = asString(req.query.schoolId as string).trim();
    const qCreatedBy = asString(req.query.createdByUserId as string).trim();
    const qAssignedTo = asString(req.query.assignedToUserId as string).trim();

    if (forceOwn) {
      // Teachers only see their own tickets
      query = query.where("createdByUserId", "==", uid);
    } else if (isSchoolAdmin(ctx.orgRole) && !isDistrictRole(ctx.orgRole)) {
      // School admins see tickets for their school only (unless a different schoolId is requested)
      if (qSchoolId) {
        query = query.where("schoolId", "==", qSchoolId);
      }
      // District roles can see everything in the tenant (no extra filter)
    }

    // Apply optional equality filters (Firestore supports chained .where)
    if (qStatus && (VALID_STATUSES as readonly string[]).includes(qStatus)) {
      query = query.where("status", "==", qStatus);
    }
    if (qPriority && (VALID_PRIORITIES as readonly string[]).includes(qPriority)) {
      query = query.where("priority", "==", qPriority);
    }
    if (qCategory && (VALID_CATEGORIES as readonly string[]).includes(qCategory)) {
      query = query.where("category", "==", qCategory);
    }
    if (qSchoolId && (isDistrictRole(ctx.orgRole) || forceOwn)) {
      // District staff can filter by schoolId; teachers' schoolId filter is additive
      // (already scoped to own tickets). Avoid double-adding for school admins above.
      if (!isSchoolAdmin(ctx.orgRole)) {
        query = query.where("schoolId", "==", qSchoolId);
      }
    }
    if (qCreatedBy && isElevated(ctx.orgRole)) {
      query = query.where("createdByUserId", "==", qCreatedBy);
    }
    if (qAssignedTo && isElevated(ctx.orgRole)) {
      query = query.where("assignedToUserId", "==", qAssignedTo);
    }

    const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 100, 1), 500);

    let tickets: ReturnType<typeof normalizeTicket>[] = [];
    try {
      const snap = await query.orderBy("createdAt", "desc").limit(limit).get();
      tickets = snap.docs.map((d) => normalizeTicket(d.id, d.data()));
    } catch (indexErr: any) {
      // Fallback: simple query + in-memory sort
      console.warn("[edu/tickets] compound query failed, falling back:", indexErr?.message);
      const snap = await query.limit(limit).get();
      tickets = snap.docs
        .map((d) => normalizeTicket(d.id, d.data()))
        .sort((a, b) => ((b.createdAt ?? 0) - (a.createdAt ?? 0)));
    }

    return res.json({ tickets, count: tickets.length });
  } catch (err: any) {
    console.error("[edu/tickets] list error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ══════════════════════════════════════════════════════════════════
   3. GET /tickets/:ticketId — get a single ticket with messages
   ══════════════════════════════════════════════════════════════════ */

router.get("/tickets/:ticketId", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getEduContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    if (DENIED_ROLES.includes(ctx.orgRole)) {
      return res.status(403).json({ error: "no_ticket_access" });
    }

    const { ticketId } = req.params;
    const ticketSnap = await tenantCol("eduSupportTickets").doc(ticketId).get();
    if (!ticketSnap.exists) return res.status(404).json({ error: "ticket_not_found" });

    const ticketData = ticketSnap.data() as any;

    // Verify tenant ownership
    if (ticketData.tenantId !== ctx.orgId) {
      return res.status(403).json({ error: "wrong_org" });
    }

    // Teachers can only view their own tickets
    if (!isElevated(ctx.orgRole) && ticketData.createdByUserId !== uid) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const ticket = normalizeTicket(ticketId, ticketData);

    // ── Fetch messages ──
    let messages: ReturnType<typeof normalizeMessage>[] = [];
    try {
      const msgSnap = await tenantCol("eduSupportTicketMessages")
        .where("ticketId", "==", ticketId)
        .orderBy("createdAt", "asc")
        .limit(500)
        .get();
      messages = msgSnap.docs.map((d) => normalizeMessage(d.id, d.data()));
    } catch (indexErr: any) {
      console.warn("[edu/tickets] messages compound query failed, falling back:", indexErr?.message);
      const msgSnap = await tenantCol("eduSupportTicketMessages")
        .where("ticketId", "==", ticketId)
        .limit(500)
        .get();
      messages = msgSnap.docs
        .map((d) => normalizeMessage(d.id, d.data()))
        .sort((a, b) => ((a.createdAt ?? 0) - (b.createdAt ?? 0)));
    }

    // Hide internal_note messages from teachers
    if (!isElevated(ctx.orgRole)) {
      messages = messages.filter((m) => m.type !== "internal_note");
    }

    return res.json({ ticket, messages });
  } catch (err: any) {
    console.error("[edu/tickets] get error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ══════════════════════════════════════════════════════════════════
   4. PATCH /tickets/:ticketId — update ticket fields
   ══════════════════════════════════════════════════════════════════ */

router.patch("/tickets/:ticketId", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getEduContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    // Only elevated roles can update tickets
    if (!isElevated(ctx.orgRole)) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const { ticketId } = req.params;
    const ticketSnap = await tenantCol("eduSupportTickets").doc(ticketId).get();
    if (!ticketSnap.exists) return res.status(404).json({ error: "ticket_not_found" });

    const ticketData = ticketSnap.data() as any;
    if (ticketData.tenantId !== ctx.orgId) {
      return res.status(403).json({ error: "wrong_org" });
    }

    // ── Build update payload ──
    const updates: Record<string, any> = { updatedAt: Date.now() };

    // status
    const newStatus = asString(req.body.status).trim();
    if (newStatus) {
      if (!(VALID_STATUSES as readonly string[]).includes(newStatus)) {
        return res.status(400).json({ error: "invalid_status", valid: VALID_STATUSES });
      }
      updates.status = newStatus;
      if (newStatus === "closed") {
        updates.closedAt = Date.now();
      }
    }

    // priority
    const newPriority = asString(req.body.priority).trim();
    if (newPriority) {
      if (!(VALID_PRIORITIES as readonly string[]).includes(newPriority)) {
        return res.status(400).json({ error: "invalid_priority", valid: VALID_PRIORITIES });
      }
      updates.priority = newPriority;
    }

    // assignment
    if (req.body.assignedToUserId !== undefined) {
      updates.assignedToUserId = req.body.assignedToUserId || null;
      updates.assignedToName = asString(req.body.assignedToName).trim() || null;
    }

    // tags
    if (Array.isArray(req.body.tags)) {
      updates.tags = req.body.tags.filter((t: any) => typeof t === "string" && t.trim()).map((t: string) => t.trim());
    }

    // category
    const newCategory = asString(req.body.category).trim();
    if (newCategory) {
      if (!(VALID_CATEGORIES as readonly string[]).includes(newCategory)) {
        return res.status(400).json({ error: "invalid_category", valid: VALID_CATEGORIES });
      }
      updates.category = newCategory;
    }

    await tenantCol("eduSupportTickets").doc(ticketId).set(updates, { merge: true });

    // Return the merged ticket
    const merged = { ...ticketData, ...updates };
    return res.json({ ticket: normalizeTicket(ticketId, merged) });
  } catch (err: any) {
    console.error("[edu/tickets] update error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ══════════════════════════════════════════════════════════════════
   5. POST /tickets/:ticketId/messages — add reply or internal note
   ══════════════════════════════════════════════════════════════════ */

router.post("/tickets/:ticketId/messages", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getEduContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    if (DENIED_ROLES.includes(ctx.orgRole)) {
      return res.status(403).json({ error: "no_ticket_access" });
    }

    const { ticketId } = req.params;
    const ticketSnap = await tenantCol("eduSupportTickets").doc(ticketId).get();
    if (!ticketSnap.exists) return res.status(404).json({ error: "ticket_not_found" });

    const ticketData = ticketSnap.data() as any;
    if (ticketData.tenantId !== ctx.orgId) {
      return res.status(403).json({ error: "wrong_org" });
    }

    // Teachers can only reply to their own tickets
    if (!isElevated(ctx.orgRole) && ticketData.createdByUserId !== uid) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    // ── Validate message fields ──
    const msgType = asString(req.body.type).trim();
    const message = asString(req.body.message).trim();

    if (!msgType || !(VALID_MESSAGE_TYPES as readonly string[]).includes(msgType)) {
      return res.status(400).json({ error: "invalid_type", valid: VALID_MESSAGE_TYPES });
    }
    if (!message) return res.status(400).json({ error: "message_required" });

    // Teachers cannot create internal notes
    if (msgType === "internal_note" && !INTERNAL_NOTE_ROLES.includes(ctx.orgRole)) {
      return res.status(403).json({ error: "internal_note_not_allowed" });
    }

    const now = Date.now();
    const msgId = `msg_${ticketId}_${now}_${Math.random().toString(36).slice(2, 8)}`;

    const doc = {
      ticketId,
      authorUserId: uid,
      authorName: ctx.userName,
      authorRole: ctx.orgRole,
      type: msgType,
      message,
      createdAt: now,
    };

    await tenantCol("eduSupportTicketMessages").doc(msgId).set(doc);

    // Touch the ticket's updatedAt
    await tenantCol("eduSupportTickets").doc(ticketId).set({ updatedAt: now }, { merge: true });

    return res.status(201).json({ message: normalizeMessage(msgId, doc) });
  } catch (err: any) {
    console.error("[edu/tickets] add message error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ══════════════════════════════════════════════════════════════════
   6. POST /tickets/:ticketId/close — close a ticket
   ══════════════════════════════════════════════════════════════════ */

router.post("/tickets/:ticketId/close", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getEduContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    if (DENIED_ROLES.includes(ctx.orgRole)) {
      return res.status(403).json({ error: "no_ticket_access" });
    }

    const { ticketId } = req.params;
    const ticketSnap = await tenantCol("eduSupportTickets").doc(ticketId).get();
    if (!ticketSnap.exists) return res.status(404).json({ error: "ticket_not_found" });

    const ticketData = ticketSnap.data() as any;
    if (ticketData.tenantId !== ctx.orgId) {
      return res.status(403).json({ error: "wrong_org" });
    }

    // Only elevated roles or the ticket creator can close
    if (!isElevated(ctx.orgRole) && ticketData.createdByUserId !== uid) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    if (ticketData.status === "closed") {
      return res.status(400).json({ error: "ticket_already_closed" });
    }

    const now = Date.now();

    // Update the ticket
    const updates = {
      status: "closed" as TicketStatus,
      closedAt: now,
      updatedAt: now,
    };
    await tenantCol("eduSupportTickets").doc(ticketId).set(updates, { merge: true });

    // Optionally write a status_change message
    const resolutionNote = asString(req.body.resolutionNote).trim();
    if (resolutionNote) {
      const msgId = `msg_${ticketId}_close_${now}_${Math.random().toString(36).slice(2, 8)}`;
      await tenantCol("eduSupportTicketMessages").doc(msgId).set({
        ticketId,
        authorUserId: uid,
        authorName: ctx.userName,
        authorRole: ctx.orgRole,
        type: "status_change" as TicketMessageType,
        message: resolutionNote,
        createdAt: now,
      });
    }

    const merged = { ...ticketData, ...updates };
    return res.json({ ticket: normalizeTicket(ticketId, merged) });
  } catch (err: any) {
    console.error("[edu/tickets] close error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
