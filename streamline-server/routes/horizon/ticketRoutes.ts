/**
 * Horizon Support Ticket Routes — unified ticket/incident system.
 *
 * Mounted at `/api/horizon/support/tickets` in index.ts.
 * requireAdmin is applied at the mount point.
 *
 * Routes:
 *   POST   /                 Create ticket (user, admin, agent, system)
 *   GET    /                 List tickets with filtering
 *   GET    /:id              Get single ticket
 *   PATCH  /:id              Update ticket (status, severity, assignment, notes)
 */
import { Router } from "express";
import { logger } from "../../lib/logger";
import {
  createTicket,
  getTicket,
  updateTicket,
  listTickets,
} from "../../lib/horizon/ticketStore";
import { monitoringBus } from "../../lib/horizon/monitoringBus";
import type {
  CreateTicketPayload,
  UpdateTicketPayload,
  TicketStatus,
  TicketSeverity,
  TicketSource,
  TicketCategory,
} from "../../lib/horizon/types";

const router = Router();

/* ── POST / — Create ticket ───────────────────────────────────────── */

router.post("/", async (req, res) => {
  try {
    const body = req.body || {};

    // Validate required fields
    if (!body.message || typeof body.message !== "string" || !body.message.trim()) {
      return res.status(400).json({ error: "MISSING_MESSAGE", message: "message is required" });
    }

    const payload: CreateTicketPayload = {
      source: body.source,
      category: body.category,
      type: body.type,
      severity: body.severity || "medium",
      service: body.service || "streamline",
      message: body.message.trim(),
      userId: body.userId,
      email: body.email,
      metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
    };

    const ticket = await createTicket(payload);

    // Publish monitoring event for live dashboard
    monitoringBus.send("ticket.created", ticket.source, {
      ticketId: ticket.id,
      category: ticket.category,
      severity: ticket.severity,
      service: ticket.service,
      message: ticket.message.slice(0, 200),
    });

    return res.status(201).json({ ok: true, ticket });
  } catch (err: any) {
    logger.error({ err: err?.message }, "POST /tickets failed");
    return res.status(500).json({ error: "TICKET_CREATE_FAILED" });
  }
});

/* ── GET / — List tickets ─────────────────────────────────────────── */

router.get("/", async (req, res) => {
  try {
    const opts: Record<string, unknown> = {};

    if (req.query.status) opts.status = String(req.query.status) as TicketStatus;
    if (req.query.severity) opts.severity = String(req.query.severity) as TicketSeverity;
    if (req.query.source) opts.source = String(req.query.source) as TicketSource;
    if (req.query.category) opts.category = String(req.query.category) as TicketCategory;
    if (req.query.service) opts.service = String(req.query.service);
    if (req.query.userId) opts.userId = String(req.query.userId);
    if (req.query.limit) opts.limit = Math.max(1, parseInt(String(req.query.limit), 10) || 50);
    if (req.query.offset) opts.offset = Math.max(0, parseInt(String(req.query.offset), 10) || 0);

    const result = await listTickets(opts as any);
    return res.json({ ok: true, ...result });
  } catch (err: any) {
    logger.error({ err: err?.message }, "GET /tickets failed");
    return res.status(500).json({ error: "TICKET_LIST_FAILED" });
  }
});

/* ── GET /:id — Get single ticket ─────────────────────────────────── */

router.get("/:id", async (req, res) => {
  try {
    const ticket = await getTicket(req.params.id);
    if (!ticket) {
      return res.status(404).json({ error: "TICKET_NOT_FOUND" });
    }
    return res.json({ ok: true, ticket });
  } catch (err: any) {
    logger.error({ err: err?.message, ticketId: req.params.id }, "GET /tickets/:id failed");
    return res.status(500).json({ error: "TICKET_FETCH_FAILED" });
  }
});

/* ── PATCH /:id — Update ticket ───────────────────────────────────── */

router.patch("/:id", async (req, res) => {
  try {
    const body = req.body || {};
    const update: UpdateTicketPayload = {};

    if (body.status) update.status = body.status;
    if (body.severity) update.severity = body.severity;
    if (body.category) update.category = body.category;
    if (body.message) update.message = body.message;
    if (body.assignedTo !== undefined) update.assignedTo = body.assignedTo;
    if (body.metadata) update.metadata = body.metadata;
    if (body.note && typeof body.note === "object") update.note = body.note;
    if (body.linkId) update.linkId = body.linkId;

    // Must have at least one field to update
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: "NO_UPDATE_FIELDS", message: "Provide at least one field to update" });
    }

    const ticket = await updateTicket(req.params.id, update);
    if (!ticket) {
      return res.status(404).json({ error: "TICKET_NOT_FOUND" });
    }

    // Publish monitoring event for live dashboard
    monitoringBus.send("ticket.updated", "admin", {
      ticketId: ticket.id,
      status: ticket.status,
      severity: ticket.severity,
      updatedFields: Object.keys(update),
    });

    return res.json({ ok: true, ticket });
  } catch (err: any) {
    logger.error({ err: err?.message, ticketId: req.params.id }, "PATCH /tickets/:id failed");
    return res.status(500).json({ error: "TICKET_UPDATE_FAILED" });
  }
});

export default router;
