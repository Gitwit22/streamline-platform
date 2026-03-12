/**
 * Support / ticket event emitter.
 *
 * Emits standardized support events into the shared event bus.
 */

import { emitEvent } from "../eventBus";
import { EventTypes, createEventPayload, type EventActor } from "../eventTypes";

export function emitSupportTicketCreated(opts: {
  entityId: string;
  actor: EventActor;
  data: Record<string, unknown>;
  tenantId?: string;
  orgId?: string;
  schoolId?: string;
}): void {
  emitEvent(
    createEventPayload(EventTypes.SUPPORT_TICKET_CREATED, {
      entityId: opts.entityId,
      actor: opts.actor,
      data: opts.data,
      tenantId: opts.tenantId,
      orgId: opts.orgId,
      schoolId: opts.schoolId,
    })
  );
}

export function emitSupportTicketUpdated(opts: {
  entityId: string;
  actor?: EventActor | null;
  data?: Record<string, unknown>;
  tenantId?: string;
  orgId?: string;
  schoolId?: string;
}): void {
  emitEvent(
    createEventPayload(EventTypes.SUPPORT_TICKET_UPDATED, {
      entityId: opts.entityId,
      actor: opts.actor,
      data: opts.data,
      tenantId: opts.tenantId,
      orgId: opts.orgId,
      schoolId: opts.schoolId,
    })
  );
}

export function emitSupportTicketMessageAdded(opts: {
  entityId: string;
  actor?: EventActor | null;
  data?: Record<string, unknown>;
  tenantId?: string;
  orgId?: string;
  schoolId?: string;
}): void {
  emitEvent(
    createEventPayload(EventTypes.SUPPORT_TICKET_MESSAGE_ADDED, {
      entityId: opts.entityId,
      actor: opts.actor,
      data: opts.data,
      tenantId: opts.tenantId,
      orgId: opts.orgId,
      schoolId: opts.schoolId,
    })
  );
}

export function emitSupportTicketClosed(opts: {
  entityId: string;
  actor?: EventActor | null;
  data?: Record<string, unknown>;
  tenantId?: string;
  orgId?: string;
  schoolId?: string;
}): void {
  emitEvent(
    createEventPayload(EventTypes.SUPPORT_TICKET_CLOSED, {
      entityId: opts.entityId,
      actor: opts.actor,
      data: opts.data,
      tenantId: opts.tenantId,
      orgId: opts.orgId,
      schoolId: opts.schoolId,
    })
  );
}
