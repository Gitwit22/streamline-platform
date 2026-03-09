/**
 * Horizon type definitions — unified ticket/incident system + monitoring.
 *
 * This covers:
 *   • Support tickets (user-submitted, agent-generated, system, admin)
 *   • Monitoring events (system.alert, system.log, agent.error, service.health)
 *   • Agent diagnostics (running/failed agents, task queues, latency)
 */

/* ── Ticket / Incident System ─────────────────────────────────────── */

export type TicketSource = "user" | "agent" | "system" | "admin";

export type TicketCategory =
  | "bug"
  | "billing"
  | "feature_request"
  | "account"
  | "abuse"
  | "alert"
  | "request"
  | "outage";

export type TicketSeverity = "low" | "medium" | "high" | "critical";

export type TicketStatus =
  | "open"
  | "investigating"
  | "in_progress"
  | "waiting"
  | "resolved"
  | "closed";

export interface TicketNote {
  author: string;
  message: string;
  createdAt: string;
}

/**
 * Canonical ticket shape persisted to Firestore.
 */
export interface HorizonTicket {
  id: string;
  source: TicketSource;
  category: TicketCategory;
  severity: TicketSeverity;
  status: TicketStatus;
  service: string;
  message: string;
  /** Optional user reference (for user-submitted tickets). */
  userId?: string;
  email?: string;
  /** Optional assignment (admin uid or agent id). */
  assignedTo?: string;
  /** Freeform metadata — page, browser, device, error stack, etc. */
  metadata: Record<string, unknown>;
  /** Internal notes / audit trail. */
  notes: TicketNote[];
  /** Linked incident or ticket IDs. */
  linkedIds: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Payload accepted by POST /api/horizon/support/tickets
 */
export interface CreateTicketPayload {
  source?: TicketSource;
  category?: TicketCategory;
  /** Legacy compat: "type" maps to category (bug | alert | request). */
  type?: string;
  severity: TicketSeverity;
  service?: string;
  message: string;
  userId?: string;
  email?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Payload accepted by PATCH /api/horizon/support/tickets/:id
 */
export interface UpdateTicketPayload {
  status?: TicketStatus;
  severity?: TicketSeverity;
  assignedTo?: string | null;
  message?: string;
  category?: TicketCategory;
  metadata?: Record<string, unknown>;
  /** Append a note. */
  note?: { author: string; message: string };
  /** Link another ticket/incident. */
  linkId?: string;
}

/* ── Monitoring Events ────────────────────────────────────────────── */

export type MonitoringEventType =
  | "system.alert"
  | "system.log"
  | "agent.error"
  | "service.health"
  | "ticket.created"
  | "ticket.updated"
  | "agent.status";

export interface MonitoringEvent {
  type: MonitoringEventType;
  ts: string;
  source: string;
  payload: Record<string, unknown>;
}

/* ── Agent Diagnostics ────────────────────────────────────────────── */

export type AgentStatus = "running" | "idle" | "failed" | "stopped";

export interface AgentInfo {
  id: string;
  name: string;
  status: AgentStatus;
  lastHeartbeat: string;
  taskQueue: number;
  latencyMs: number;
  errors: number;
  upSince?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentDiagnostics {
  ts: string;
  agents: AgentInfo[];
  summary: {
    total: number;
    running: number;
    idle: number;
    failed: number;
    stopped: number;
    totalTaskQueue: number;
    avgLatencyMs: number;
  };
}
