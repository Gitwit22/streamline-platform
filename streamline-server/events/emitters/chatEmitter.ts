/**
 * Chat event emitter.
 *
 * Emits standardized chat events into the shared event bus.
 */

import { emitEvent } from "../eventBus";
import { EventTypes, createEventPayload, type EventActor } from "../eventTypes";

export function emitChatMessageCreated(opts: {
  roomId: string;
  entityId: string;
  actor: EventActor;
  data: Record<string, unknown>;
  tenantId?: string;
  schoolId?: string;
}): void {
  emitEvent(
    createEventPayload(EventTypes.CHAT_MESSAGE_CREATED, {
      roomId: opts.roomId,
      entityId: opts.entityId,
      actor: opts.actor,
      data: opts.data,
      tenantId: opts.tenantId,
      schoolId: opts.schoolId,
    })
  );
}

export function emitChatMessageDeleted(opts: {
  roomId: string;
  entityId: string;
  actor?: EventActor | null;
  data?: Record<string, unknown>;
}): void {
  emitEvent(
    createEventPayload(EventTypes.CHAT_MESSAGE_DELETED, {
      roomId: opts.roomId,
      entityId: opts.entityId,
      actor: opts.actor,
      data: opts.data,
    })
  );
}
