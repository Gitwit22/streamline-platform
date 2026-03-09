/**
 * Horizon Ticket Store — Firestore-backed unified ticket/incident system.
 *
 * Handles CRUD for tickets that originate from users, agents, system
 * monitoring, or admin actions. All tickets live in a single Firestore
 * collection scoped under the global namespace:
 *
 *   env/{APP_ENV}/global/_/horizonTickets/{ticketId}
 *
 * An in-memory LRU of recent tickets is kept for dashboard speed.
 */
import crypto from "node:crypto";
import { globalCol } from "../dbPaths";
import { logger } from "../logger";
import type {
  HorizonTicket,
  CreateTicketPayload,
  UpdateTicketPayload,
  TicketCategory,
  TicketSource,
  TicketSeverity,
  TicketStatus,
} from "./types";

/* ── Constants ────────────────────────────────────────────────────── */

const COLLECTION = "horizonTickets";
const MAX_CACHE = 500;

/* ── Validation sets ──────────────────────────────────────────────── */

const VALID_SOURCES = new Set<TicketSource>([
  "user",
  "agent",
  "system",
  "admin",
]);
const VALID_CATEGORIES = new Set<TicketCategory>([
  "bug",
  "billing",
  "feature_request",
  "account",
  "abuse",
  "alert",
  "request",
  "outage",
]);
const VALID_SEVERITIES = new Set<TicketSeverity>([
  "low",
  "medium",
  "high",
  "critical",
]);
const VALID_STATUSES = new Set<TicketStatus>([
  "open",
  "investigating",
  "in_progress",
  "waiting",
  "resolved",
  "closed",
]);

/** Map legacy "type" field values to proper categories. */
const TYPE_TO_CATEGORY: Record<string, TicketCategory> = {
  bug: "bug",
  alert: "alert",
  request: "request",
};

/* ── In-memory cache (most-recent first) ──────────────────────────── */

let cache: HorizonTicket[] = [];

function cacheUpsert(ticket: HorizonTicket): void {
  cache = cache.filter((t) => t.id !== ticket.id);
  cache.unshift(ticket);
  if (cache.length > MAX_CACHE) cache.length = MAX_CACHE;
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function col() {
  return globalCol(COLLECTION);
}

function generateId(): string {
  return `tkt_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

function resolveCategory(payload: CreateTicketPayload): TicketCategory {
  if (payload.category && VALID_CATEGORIES.has(payload.category)) {
    return payload.category;
  }
  if (payload.type && TYPE_TO_CATEGORY[payload.type]) {
    return TYPE_TO_CATEGORY[payload.type];
  }
  return "bug";
}

/* ── Public API ───────────────────────────────────────────────────── */

/**
 * Create a new ticket. Returns the persisted ticket.
 */
export async function createTicket(
  payload: CreateTicketPayload
): Promise<HorizonTicket> {
  const id = generateId();
  const now = nowISO();

  const source: TicketSource =
    payload.source && VALID_SOURCES.has(payload.source)
      ? payload.source
      : "user";

  const severity: TicketSeverity =
    payload.severity && VALID_SEVERITIES.has(payload.severity)
      ? payload.severity
      : "medium";

  const ticket: HorizonTicket = {
    id,
    source,
    category: resolveCategory(payload),
    severity,
    status: "open",
    service: payload.service || "streamline",
    message: String(payload.message || "").slice(0, 5000),
    userId: payload.userId,
    email: payload.email,
    metadata: payload.metadata || {},
    notes: [],
    linkedIds: [],
    createdAt: now,
    updatedAt: now,
  };

  try {
    await col().doc(id).set(ticket);
    cacheUpsert(ticket);
    logger.info({ ticketId: id, source, severity }, "Ticket created");
  } catch (err: any) {
    logger.error({ err: err?.message, ticketId: id }, "Failed to persist ticket");
    // Still return the in-memory ticket so the caller gets a response
    cacheUpsert(ticket);
  }

  return ticket;
}

/**
 * Get a single ticket by ID.
 */
export async function getTicket(
  id: string
): Promise<HorizonTicket | null> {
  // Check cache first
  const cached = cache.find((t) => t.id === id);
  if (cached) return cached;

  try {
    const snap = await col().doc(id).get();
    if (!snap.exists) return null;
    const ticket = snap.data() as HorizonTicket;
    cacheUpsert(ticket);
    return ticket;
  } catch (err: any) {
    logger.error({ err: err?.message, ticketId: id }, "Failed to fetch ticket");
    return null;
  }
}

/**
 * Update a ticket (status, severity, assignment, notes, links).
 * Returns the updated ticket, or null if not found.
 */
export async function updateTicket(
  id: string,
  update: UpdateTicketPayload
): Promise<HorizonTicket | null> {
  const existing = await getTicket(id);
  if (!existing) return null;

  const now = nowISO();

  // Build mutation
  const patch: Partial<HorizonTicket> & { updatedAt: string } = {
    updatedAt: now,
  };

  if (update.status && VALID_STATUSES.has(update.status)) {
    patch.status = update.status;
  }
  if (update.severity && VALID_SEVERITIES.has(update.severity)) {
    patch.severity = update.severity;
  }
  if (update.category && VALID_CATEGORIES.has(update.category)) {
    patch.category = update.category;
  }
  if (typeof update.assignedTo === "string" || update.assignedTo === null) {
    patch.assignedTo = update.assignedTo ?? undefined;
  }
  if (typeof update.message === "string") {
    patch.message = update.message.slice(0, 5000);
  }
  if (update.metadata && typeof update.metadata === "object") {
    patch.metadata = { ...existing.metadata, ...update.metadata };
  }

  // Notes — append
  const notes = [...existing.notes];
  if (update.note && update.note.author && update.note.message) {
    notes.push({
      author: update.note.author,
      message: update.note.message.slice(0, 2000),
      createdAt: now,
    });
  }

  // Links — append
  const linkedIds = [...existing.linkedIds];
  if (update.linkId && !linkedIds.includes(update.linkId)) {
    linkedIds.push(update.linkId);
  }

  const merged: HorizonTicket = {
    ...existing,
    ...patch,
    notes,
    linkedIds,
  };

  try {
    await col().doc(id).set(merged);
    cacheUpsert(merged);
    logger.info({ ticketId: id, status: merged.status }, "Ticket updated");
  } catch (err: any) {
    logger.error({ err: err?.message, ticketId: id }, "Failed to persist ticket update");
    // Still return the in-memory version
    cacheUpsert(merged);
  }

  return merged;
}

/* ── List / Query ─────────────────────────────────────────────────── */

export interface TicketListOptions {
  status?: TicketStatus;
  severity?: TicketSeverity;
  source?: TicketSource;
  category?: TicketCategory;
  service?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}

/**
 * List tickets with optional filters. Reads from Firestore (cache is
 * only used for individual lookups).
 */
export async function listTickets(
  opts: TicketListOptions = {}
): Promise<{ tickets: HorizonTicket[]; total: number }> {
  try {
    let q: FirebaseFirestore.Query = col().orderBy("createdAt", "desc");

    if (opts.status) q = q.where("status", "==", opts.status);
    if (opts.severity) q = q.where("severity", "==", opts.severity);
    if (opts.source) q = q.where("source", "==", opts.source);
    if (opts.category) q = q.where("category", "==", opts.category);
    if (opts.service) q = q.where("service", "==", opts.service);
    if (opts.userId) q = q.where("userId", "==", opts.userId);

    // For total count, we read all matching docs (Firestore has no COUNT).
    // In production with many tickets, switch to a counter doc or pagination tokens.
    const allSnap = await q.get();
    const total = allSnap.size;

    const limit = Math.min(opts.limit || 50, 200);
    const offset = opts.offset || 0;

    const tickets = allSnap.docs
      .slice(offset, offset + limit)
      .map((d) => d.data() as HorizonTicket);

    // Refresh cache with these results
    for (const t of tickets) cacheUpsert(t);

    return { tickets, total };
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to list tickets");
    // Fall back to cache
    let filtered = [...cache];
    if (opts.status) filtered = filtered.filter((t) => t.status === opts.status);
    if (opts.severity) filtered = filtered.filter((t) => t.severity === opts.severity);
    if (opts.source) filtered = filtered.filter((t) => t.source === opts.source);
    if (opts.category) filtered = filtered.filter((t) => t.category === opts.category);
    if (opts.service) filtered = filtered.filter((t) => t.service === opts.service);
    if (opts.userId) filtered = filtered.filter((t) => t.userId === opts.userId);

    const limit = Math.min(opts.limit || 50, 200);
    const offset = opts.offset || 0;
    return {
      tickets: filtered.slice(offset, offset + limit),
      total: filtered.length,
    };
  }
}
