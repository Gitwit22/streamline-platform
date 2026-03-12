/**
 * Room event emitter.
 *
 * Emits standardized room lifecycle events into the shared event bus.
 */

import { emitEvent } from "../eventBus";
import { EventTypes, createEventPayload, type EventActor } from "../eventTypes";

export function emitRoomCreated(opts: {
  roomId: string;
  entityId?: string;
  actor?: EventActor | null;
  data?: Record<string, unknown>;
  tenantId?: string;
  schoolId?: string;
}): void {
  emitEvent(
    createEventPayload(EventTypes.ROOM_CREATED, {
      roomId: opts.roomId,
      entityId: opts.entityId ?? opts.roomId,
      actor: opts.actor,
      data: opts.data,
      tenantId: opts.tenantId,
      schoolId: opts.schoolId,
    })
  );
}

export function emitRoomStarted(opts: {
  roomId: string;
  data?: Record<string, unknown>;
}): void {
  emitEvent(
    createEventPayload(EventTypes.ROOM_STARTED, {
      roomId: opts.roomId,
      entityId: opts.roomId,
      data: opts.data,
    })
  );
}

export function emitRoomEnded(opts: {
  roomId: string;
  data?: Record<string, unknown>;
}): void {
  emitEvent(
    createEventPayload(EventTypes.ROOM_ENDED, {
      roomId: opts.roomId,
      entityId: opts.roomId,
      data: opts.data,
    })
  );
}

export function emitRoomParticipantJoined(opts: {
  roomId: string;
  actor?: EventActor | null;
  data?: Record<string, unknown>;
}): void {
  emitEvent(
    createEventPayload(EventTypes.ROOM_PARTICIPANT_JOINED, {
      roomId: opts.roomId,
      entityId: opts.roomId,
      actor: opts.actor,
      data: opts.data,
    })
  );
}

export function emitRoomParticipantLeft(opts: {
  roomId: string;
  actor?: EventActor | null;
  data?: Record<string, unknown>;
}): void {
  emitEvent(
    createEventPayload(EventTypes.ROOM_PARTICIPANT_LEFT, {
      roomId: opts.roomId,
      entityId: opts.roomId,
      actor: opts.actor,
      data: opts.data,
    })
  );
}

export function emitRoomBroadcastStarted(opts: {
  roomId: string;
  actor?: EventActor | null;
  data?: Record<string, unknown>;
}): void {
  emitEvent(
    createEventPayload(EventTypes.ROOM_BROADCAST_STARTED, {
      roomId: opts.roomId,
      entityId: opts.roomId,
      actor: opts.actor,
      data: opts.data,
    })
  );
}

export function emitRoomBroadcastEnded(opts: {
  roomId: string;
  actor?: EventActor | null;
  data?: Record<string, unknown>;
}): void {
  emitEvent(
    createEventPayload(EventTypes.ROOM_BROADCAST_ENDED, {
      roomId: opts.roomId,
      entityId: opts.roomId,
      actor: opts.actor,
      data: opts.data,
    })
  );
}
