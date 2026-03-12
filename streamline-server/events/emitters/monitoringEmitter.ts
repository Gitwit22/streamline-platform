/**
 * Monitoring event emitter.
 *
 * Emits standardized monitoring / platform health events into the
 * shared event bus.
 */

import { emitEvent } from "../eventBus";
import { EventTypes, createEventPayload } from "../eventTypes";

export function emitHealthChanged(opts: {
  entityId: string;
  data: Record<string, unknown>;
}): void {
  emitEvent(
    createEventPayload(EventTypes.MONITORING_HEALTH_CHANGED, {
      entityId: opts.entityId,
      data: opts.data,
    })
  );
}

export function emitServiceDegraded(opts: {
  entityId: string;
  data: Record<string, unknown>;
}): void {
  emitEvent(
    createEventPayload(EventTypes.MONITORING_SERVICE_DEGRADED, {
      entityId: opts.entityId,
      data: opts.data,
    })
  );
}

export function emitServiceRestored(opts: {
  entityId: string;
  data: Record<string, unknown>;
}): void {
  emitEvent(
    createEventPayload(EventTypes.MONITORING_SERVICE_RESTORED, {
      entityId: opts.entityId,
      data: opts.data,
    })
  );
}

export function emitWebhookFailed(opts: {
  entityId: string;
  data: Record<string, unknown>;
}): void {
  emitEvent(
    createEventPayload(EventTypes.MONITORING_WEBHOOK_FAILED, {
      entityId: opts.entityId,
      data: opts.data,
    })
  );
}

export function emitWebhookRestored(opts: {
  entityId: string;
  data: Record<string, unknown>;
}): void {
  emitEvent(
    createEventPayload(EventTypes.MONITORING_WEBHOOK_RESTORED, {
      entityId: opts.entityId,
      data: opts.data,
    })
  );
}
