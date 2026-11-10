/**
 * Canonical event type definitions and shared payload shape for the
 * StreamLine platform event hook system.
 *
 * Every module that emits events MUST use these types so all listeners
 * receive a consistent structure.
 */

// ---------------------------------------------------------------------------
// Event name constants (dot-separated, lowercase)
// ---------------------------------------------------------------------------

export const EventTypes = {
  // Chat
  CHAT_MESSAGE_CREATED: "chat.message.created",
  CHAT_MESSAGE_DELETED: "chat.message.deleted",

  // Voice
  VOICE_STREAM_STARTED: "voice.stream.started",
  VOICE_STREAM_CHUNK_RECEIVED: "voice.stream.chunk_received",
  VOICE_STREAM_ENDED: "voice.stream.ended",

  // Support
  SUPPORT_TICKET_CREATED: "support.ticket.created",
  SUPPORT_TICKET_UPDATED: "support.ticket.updated",
  SUPPORT_TICKET_MESSAGE_ADDED: "support.ticket.message_added",
  SUPPORT_TICKET_CLOSED: "support.ticket.closed",

  // Room
  ROOM_CREATED: "room.created",
  ROOM_STARTED: "room.started",
  ROOM_ENDED: "room.ended",
  ROOM_PARTICIPANT_JOINED: "room.participant_joined",
  ROOM_PARTICIPANT_LEFT: "room.participant_left",
  ROOM_BROADCAST_STARTED: "room.broadcast_started",
  ROOM_BROADCAST_ENDED: "room.broadcast_ended",

  // Monitoring
  MONITORING_HEALTH_CHANGED: "monitoring.health.changed",
  MONITORING_SERVICE_DEGRADED: "monitoring.service.degraded",
  MONITORING_SERVICE_RESTORED: "monitoring.service.restored",
  MONITORING_WEBHOOK_FAILED: "monitoring.webhook.failed",
  MONITORING_WEBHOOK_RESTORED: "monitoring.webhook.restored",

  // Alert
  ALERT_CREATED: "alert.created",
  ALERT_ACKNOWLEDGED: "alert.acknowledged",
  ALERT_RESOLVED: "alert.resolved",

  // Commerce (pay-per-view + account lifecycle → transactional email flows).
  // Payloads never carry access codes or other secrets.
  PPV_EVENT_SCHEDULED: "ppv.event.scheduled",
  PPV_EVENT_STARTED: "ppv.event.started",
  PPV_EVENT_ENDED: "ppv.event.ended",
  PPV_TICKET_PURCHASED: "ppv.ticket.purchased",
  PPV_TICKET_REFUNDED: "ppv.ticket.refunded",
  PPV_PAYMENT_AFTER_END: "ppv.payment.after_end",
  ACCOUNT_CREATED: "account.created",
} as const;

export type StreamlineEventType =
  (typeof EventTypes)[keyof typeof EventTypes];

// ---------------------------------------------------------------------------
// Actor descriptor (who triggered the event)
// ---------------------------------------------------------------------------

export interface EventActor {
  userId: string;
  username: string;
  role: string;
}

// ---------------------------------------------------------------------------
// Shared event payload – every emitted hook follows this shape
// ---------------------------------------------------------------------------

export interface StreamlineEventPayload {
  /**
   * Unique event id, identical across webhook retries of the same delivery.
   * Emitters may pass a deterministic id (e.g. "ppv.ticket.purchased:<purchaseId>")
   * so receivers can dedupe redelivered business events too.
   */
  id: string;
  /** Canonical event name, e.g. "support.ticket.created". */
  event: StreamlineEventType;
  /** ISO-8601 timestamp of when the event occurred. */
  timestamp: string;
  /** Originating system identifier. */
  source: string;
  /** Tenant scoping (nullable). */
  tenantId: string | null;
  /** Organisation scoping (nullable). */
  orgId: string | null;
  /** School scoping (nullable). */
  schoolId: string | null;
  /** Room scoping (nullable). */
  roomId: string | null;
  /** Primary entity identifier for this event. */
  entityId: string | null;
  /** Actor that triggered the event (nullable for system events). */
  actor: EventActor | null;
  /** Event-specific data. */
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Category helpers – map event names to destination env-var categories
// ---------------------------------------------------------------------------

export type EventCategory =
  | "chat"
  | "voice"
  | "support"
  | "monitoring"
  | "alert"
  | "commerce"
  | "room";

export function eventCategory(event: StreamlineEventType): EventCategory {
  if (event.startsWith("chat.")) return "chat";
  if (event.startsWith("voice.")) return "voice";
  if (event.startsWith("support.")) return "support";
  if (event.startsWith("monitoring.")) return "monitoring";
  if (event.startsWith("alert.")) return "alert";
  if (event.startsWith("ppv.") || event.startsWith("account.")) return "commerce";
  return "room";
}

// ---------------------------------------------------------------------------
// Factory helper to create a payload with sane defaults
// ---------------------------------------------------------------------------

const SOURCE = "streamline";

function randomEventId(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return `evt_${require("crypto").randomBytes(12).toString("hex")}`;
}

export function createEventPayload(
  event: StreamlineEventType,
  opts: {
    /** Deterministic id for business events that may be re-emitted. */
    id?: string | null;
    tenantId?: string | null;
    orgId?: string | null;
    schoolId?: string | null;
    roomId?: string | null;
    entityId?: string | null;
    actor?: EventActor | null;
    data?: Record<string, unknown>;
  } = {}
): StreamlineEventPayload {
  return {
    id: (typeof opts.id === "string" && opts.id.trim()) || randomEventId(),
    event,
    timestamp: new Date().toISOString(),
    source: SOURCE,
    tenantId: opts.tenantId ?? null,
    orgId: opts.orgId ?? null,
    schoolId: opts.schoolId ?? null,
    roomId: opts.roomId ?? null,
    entityId: opts.entityId ?? null,
    actor: opts.actor ?? null,
    data: opts.data ?? {},
  };
}
