/**
 * Alert event emitter.
 *
 * Emits standardized alert lifecycle events into the shared event bus.
 */

import { emitEvent } from "../eventBus";
import { EventTypes, createEventPayload, type EventActor } from "../eventTypes";

export function emitAlertCreated(opts: {
  entityId: string;
  actor?: EventActor | null;
  data: Record<string, unknown>;
  tenantId?: string;
}): void {
  emitEvent(
    createEventPayload(EventTypes.ALERT_CREATED, {
      entityId: opts.entityId,
      actor: opts.actor,
      data: opts.data,
      tenantId: opts.tenantId,
    })
  );
}

export function emitAlertAcknowledged(opts: {
  entityId: string;
  actor?: EventActor | null;
  data?: Record<string, unknown>;
  tenantId?: string;
}): void {
  emitEvent(
    createEventPayload(EventTypes.ALERT_ACKNOWLEDGED, {
      entityId: opts.entityId,
      actor: opts.actor,
      data: opts.data,
      tenantId: opts.tenantId,
    })
  );
}

export function emitAlertResolved(opts: {
  entityId: string;
  actor?: EventActor | null;
  data?: Record<string, unknown>;
  tenantId?: string;
}): void {
  emitEvent(
    createEventPayload(EventTypes.ALERT_RESOLVED, {
      entityId: opts.entityId,
      actor: opts.actor,
      data: opts.data,
      tenantId: opts.tenantId,
    })
  );
}
