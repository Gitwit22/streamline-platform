/**
 * Support ticket rules (pure, no I/O). Storage: supportTickets/{id}, written
 * by the public form (routes/supportPublic.ts) and updated by admins
 * (routes/adminSupportTickets.ts).
 *
 * Statuses: open | in_progress | resolved | closed. The public form writes
 * "new" (legacy); it is read as "open".
 *
 * NOTE: there is no outbound email provider. Status changes and internal
 * notes are NOT emailed to the submitter; admins reply out of band.
 */

export const TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const MAX_TICKET_HISTORY = 200;
export const MAX_INTERNAL_NOTES = 200;
export const MAX_NOTE_LENGTH = 4000;

export function isTicketStatus(v: unknown): v is TicketStatus {
  return typeof v === "string" && (TICKET_STATUSES as readonly string[]).includes(v);
}

/** Stored status -> canonical status ("new"/unknown/missing => open). */
export function normalizeTicketStatus(v: unknown): TicketStatus {
  const raw = typeof v === "string" ? v.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  if (isTicketStatus(raw)) return raw;
  if (raw === "inprogress" || raw === "pending" || raw === "working") return "in_progress";
  if (raw === "done" || raw === "fixed") return "resolved";
  return "open";
}

/** Stored values that mean `status` (for the list filter). */
export function storedStatusesFor(status: TicketStatus): string[] {
  return status === "open" ? ["open", "new"] : [status];
}

/**
 * Allowed transitions. Closed tickets must be reopened (-> open) before work
 * resumes; resolved tickets can be reopened or closed.
 */
const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ["in_progress", "resolved", "closed"],
  in_progress: ["open", "resolved", "closed"],
  resolved: ["open", "closed"],
  closed: ["open"],
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  if (from === to) return true; // no-op (e.g. only a note or assignee change)
  return TRANSITIONS[from].includes(to);
}

export function allowedNextStatuses(from: TicketStatus): TicketStatus[] {
  return [...TRANSITIONS[from]];
}

export type TicketPatchInput = {
  status?: TicketStatus;
  /** null clears the assignee. */
  assignee?: string | null;
  internalNote?: string;
};

export function parseTicketPatch(body: any): { ok: true; value: TicketPatchInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_body" };
  const out: TicketPatchInput = {};
  if (body.status !== undefined) {
    if (!isTicketStatus(body.status)) return { ok: false, error: "invalid_status" };
    out.status = body.status;
  }
  if (body.assignee !== undefined) {
    if (body.assignee === null || body.assignee === "") out.assignee = null;
    else if (typeof body.assignee === "string" && body.assignee.trim().length <= 200) out.assignee = body.assignee.trim();
    else return { ok: false, error: "invalid_assignee" };
  }
  if (body.internalNote !== undefined) {
    if (typeof body.internalNote !== "string") return { ok: false, error: "invalid_internal_note" };
    const note = body.internalNote.trim();
    if (note.length > MAX_NOTE_LENGTH) return { ok: false, error: "internal_note_too_long" };
    if (note) out.internalNote = note;
  }
  if (out.status === undefined && out.assignee === undefined && out.internalNote === undefined) {
    return { ok: false, error: "nothing_to_update" };
  }
  return { ok: true, value: out };
}

export type TicketHistoryEntry = {
  at: number;
  by: string;
  action: "status" | "assignee" | "note";
  from?: string | null;
  to?: string | null;
};

export type TicketNote = { at: number; by: string; byEmail?: string | null; text: string };

/**
 * Apply an admin patch to the stored ticket. Returns the Firestore update
 * (history/notes arrays rewritten and capped) or an error for an illegal
 * status transition.
 */
export function applyTicketPatch(
  current: any,
  patch: TicketPatchInput,
  actor: { uid: string; email?: string | null },
  nowMs: number
):
  | { ok: true; update: Record<string, any>; from: TicketStatus; to: TicketStatus; changed: string[] }
  | { ok: false; error: string; from: TicketStatus; to: TicketStatus } {
  const from = normalizeTicketStatus(current?.status);
  const to = patch.status ?? from;
  if (!canTransition(from, to)) return { ok: false, error: "invalid_transition", from, to };

  const history: TicketHistoryEntry[] = Array.isArray(current?.history) ? [...current.history] : [];
  const notes: TicketNote[] = Array.isArray(current?.internalNotes) ? [...current.internalNotes] : [];
  const update: Record<string, any> = {};
  const changed: string[] = [];

  if (patch.status !== undefined && (to !== from || current?.status !== to)) {
    update.status = to;
    if (to !== from) {
      history.push({ at: nowMs, by: actor.uid, action: "status", from, to });
      changed.push("status");
      if (to === "resolved") update.resolvedAtMs = nowMs;
      if (to === "closed") update.closedAtMs = nowMs;
      if (to === "open") {
        update.reopenedAtMs = nowMs;
      }
    }
  }
  if (patch.assignee !== undefined) {
    const prev = typeof current?.assignee === "string" ? current.assignee : null;
    if (prev !== patch.assignee) {
      update.assignee = patch.assignee;
      history.push({ at: nowMs, by: actor.uid, action: "assignee", from: prev, to: patch.assignee });
      changed.push("assignee");
    }
  }
  if (patch.internalNote) {
    notes.push({ at: nowMs, by: actor.uid, byEmail: actor.email ?? null, text: patch.internalNote });
    history.push({ at: nowMs, by: actor.uid, action: "note" });
    changed.push("note");
  }

  if (changed.length || update.status !== undefined) {
    update.history = history.slice(-MAX_TICKET_HISTORY);
    if (patch.internalNote) update.internalNotes = notes.slice(-MAX_INTERNAL_NOTES);
    update.updatedAtMs = nowMs;
  }
  return { ok: true, update, from, to, changed };
}

function toMs(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v?.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/** Admin DTO (drops ipHash; keeps everything an admin needs to triage). */
export function toTicketDTO(id: string, d: any, opts: { full?: boolean } = {}) {
  const status = normalizeTicketStatus(d?.status);
  const content = d?.content || {};
  const base = {
    id,
    status,
    allowedNext: allowedNextStatuses(status),
    subject: String(content.subject || d?.subject || ""),
    category: String(content.category || "general"),
    priority: String(content.priority || "normal"),
    submitter: {
      uid: d?.submitter?.uid ?? null,
      email: d?.submitter?.email ?? null,
      auth: d?.submitter?.auth ?? null,
    },
    assignee: typeof d?.assignee === "string" ? d.assignee : null,
    source: d?.source ?? null,
    createdAtMs: toMs(d?.createdAt) ?? toMs(d?.submittedAt),
    updatedAtMs: toMs(d?.updatedAtMs) ?? toMs(d?.updatedAt),
    notesCount: Array.isArray(d?.internalNotes) ? d.internalNotes.length : 0,
  };
  if (!opts.full) return base;
  return {
    ...base,
    message: String(content.message || d?.message || ""),
    meta: {
      pageUrl: d?.meta?.pageUrl ?? null,
      userAgent: d?.meta?.userAgent ?? null,
      context: d?.meta?.context ?? {},
    },
    history: Array.isArray(d?.history) ? d.history : [],
    internalNotes: Array.isArray(d?.internalNotes) ? d.internalNotes : [],
    resolvedAtMs: toMs(d?.resolvedAtMs),
    closedAtMs: toMs(d?.closedAtMs),
  };
}
