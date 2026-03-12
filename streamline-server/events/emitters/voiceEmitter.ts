/**
 * Voice event emitter.
 *
 * Emits standardized voice events into the shared event bus.
 */

import { emitEvent } from "../eventBus";
import { EventTypes, createEventPayload, type EventActor } from "../eventTypes";

export function emitVoiceStreamStarted(opts: {
  roomId: string;
  entityId?: string;
  actor?: EventActor | null;
  data?: Record<string, unknown>;
}): void {
  emitEvent(
    createEventPayload(EventTypes.VOICE_STREAM_STARTED, {
      roomId: opts.roomId,
      entityId: opts.entityId,
      actor: opts.actor,
      data: opts.data,
    })
  );
}

export function emitVoiceStreamChunkReceived(opts: {
  roomId: string;
  entityId?: string;
  data?: Record<string, unknown>;
}): void {
  emitEvent(
    createEventPayload(EventTypes.VOICE_STREAM_CHUNK_RECEIVED, {
      roomId: opts.roomId,
      entityId: opts.entityId,
      data: opts.data,
    })
  );
}

export function emitVoiceStreamEnded(opts: {
  roomId: string;
  entityId?: string;
  actor?: EventActor | null;
  data?: Record<string, unknown>;
}): void {
  emitEvent(
    createEventPayload(EventTypes.VOICE_STREAM_ENDED, {
      roomId: opts.roomId,
      entityId: opts.entityId,
      actor: opts.actor,
      data: opts.data,
    })
  );
}
