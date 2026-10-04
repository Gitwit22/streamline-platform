/**
 * Support tickets (admin). Source of truth: supportTickets/{id}, written by
 * the public form (POST /api/support/tickets/submit).
 *
 * Mounted (requireAdmin applied by the parent) at:
 *   /api/admin/support/tickets
 *   /api/horizon/support/tickets
 *
 *   GET    /            ?status=open|in_progress|resolved|closed&limit=&cursor=
 *   GET    /:ticketId
 *   PATCH  /:ticketId   { status?, assignee?, internalNote? }  (audit-logged)
 *
 * There is no outbound email: status changes and notes are not emailed to the
 * submitter.
 */
import { Router } from "express";
import { firestore } from "../firebaseAdmin";
import { logAdminAction } from "../middleware/adminAuth";
import { emitSupportTicketClosed, emitSupportTicketUpdated } from "../events/emitters/supportEmitter";
import {
  applyTicketPatch,
  isTicketStatus,
  parseTicketPatch,
  storedStatusesFor,
  toTicketDTO,
} from "../lib/supportTicketsPure";

const router = Router();
const COLLECTION = "supportTickets";
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

router.get("/", async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "50"), 10) || 50, 1), 200);
    const statusRaw = String(req.query.status || "").trim().toLowerCase();
    if (statusRaw && statusRaw !== "all" && !isTicketStatus(statusRaw)) {
      return res.status(400).json({ error: "invalid_status" });
    }
    const cursor = typeof req.query.cursor === "string" && ID_RE.test(req.query.cursor) ? req.query.cursor : null;

    let q: FirebaseFirestore.Query = firestore.collection(COLLECTION);
    if (statusRaw && statusRaw !== "all" && isTicketStatus(statusRaw)) {
      q = q.where("status", "in", storedStatusesFor(statusRaw));
    }
    q = q.orderBy("createdAt", "desc");
    if (cursor) {
      const cursorSnap = await firestore.collection(COLLECTION).doc(cursor).get();
      if (cursorSnap.exists) q = q.startAfter(cursorSnap);
    }
    const snap = await q.limit(limit + 1).get();
    const docs = snap.docs.slice(0, limit);
    const tickets = docs.map((d) => toTicketDTO(d.id, d.data()));
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      ok: true,
      tickets,
      count: tickets.length,
      nextCursor: snap.docs.length > limit ? docs[docs.length - 1].id : null,
      emailDelivery: "none",
    });
  } catch (err: any) {
    console.error("[support/tickets] list failed:", err?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

router.get("/:ticketId", async (req, res) => {
  const id = String(req.params.ticketId || "");
  if (!ID_RE.test(id)) return res.status(400).json({ error: "invalid_ticket_id" });
  try {
    const snap = await firestore.collection(COLLECTION).doc(id).get();
    if (!snap.exists) return res.status(404).json({ error: "ticket_not_found" });
    res.setHeader("Cache-Control", "no-store");
    return res.json({ ok: true, ticket: toTicketDTO(snap.id, snap.data(), { full: true }) });
  } catch (err: any) {
    console.error("[support/tickets] get failed:", err?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

router.patch("/:ticketId", async (req, res) => {
  const id = String(req.params.ticketId || "");
  if (!ID_RE.test(id)) return res.status(400).json({ error: "invalid_ticket_id" });
  const parsed = parseTicketPatch(req.body);
  if (parsed.ok === false) return res.status(400).json({ error: parsed.error });
  const actor = { uid: req.adminUser?.uid || "unknown", email: req.adminUser?.email || null };
  const ref = firestore.collection(COLLECTION).doc(id);
  try {
    const result = await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { status: 404 as const };
      const applied = applyTicketPatch(snap.data(), parsed.value, actor, Date.now());
      if (applied.ok === false) return { status: 409 as const, applied };
      if (Object.keys(applied.update).length) tx.set(ref, applied.update, { merge: true });
      return { status: 200 as const, applied, submitterUid: (snap.data() as any)?.submitter?.uid ?? null };
    });

    if (result.status === 404) return res.status(404).json({ error: "ticket_not_found" });
    if (result.status === 409) {
      const a: any = result.applied;
      return res.status(409).json({ error: a.error, from: a.from, to: a.to });
    }
    const applied: any = result.applied;

    if (applied.changed.length) {
      await logAdminAction(actor.uid, "support_ticket_update", {
        ticketId: id,
        targetUid: (result as any).submitterUid || undefined,
        changed: applied.changed,
        from: applied.from,
        to: applied.to,
        assignee: parsed.value.assignee,
        noteAdded: Boolean(parsed.value.internalNote),
      });
      const eventActor = { userId: actor.uid, username: actor.email || actor.uid, role: "admin" };
      try {
        if (applied.to === "closed" && applied.from !== "closed") {
          emitSupportTicketClosed({ entityId: id, actor: eventActor, data: { from: applied.from } });
        } else {
          // Internal note text is never put on the event bus.
          emitSupportTicketUpdated({
            entityId: id,
            actor: eventActor,
            data: { changed: applied.changed, from: applied.from, to: applied.to },
          });
        }
      } catch (e: any) {
        console.warn("[support/tickets] event emit failed:", e?.message || e);
      }
    }

    const fresh = await ref.get();
    return res.json({ ok: true, ticket: toTicketDTO(fresh.id, fresh.data(), { full: true }), changed: applied.changed });
  } catch (err: any) {
    console.error("[support/tickets] patch failed:", err?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
