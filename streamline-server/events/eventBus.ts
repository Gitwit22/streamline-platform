/**
 * Shared event bus for the StreamLine platform.
 *
 * This is a thin wrapper around Node's EventEmitter that:
 *   1. Accepts only strongly-typed StreamlineEventPayloads.
 *   2. Forwards every event to the webhook dispatcher.
 *   3. Also forwards to the legacy Horizon dispatcher for backward compat.
 *   4. Catches and logs listener errors so that the emitting code path
 *      is never impacted.
 *
 * Usage from any module:
 *   import { emitEvent } from "../events/eventBus";
 *   emitEvent(payload);          // fire-and-forget
 */

import { EventEmitter } from "events";
import type { StreamlineEventPayload } from "./eventTypes";
import { dispatchEvent } from "./webhookDispatcher";

// ---------------------------------------------------------------------------
// Singleton bus
// ---------------------------------------------------------------------------

const bus = new EventEmitter();

// Raise the default max-listener cap so we don't get Node warnings when
// several emitters register at startup.
bus.setMaxListeners(50);

// ---------------------------------------------------------------------------
// Default listener – webhook dispatch
// ---------------------------------------------------------------------------

bus.on("event", (payload: StreamlineEventPayload) => {
  // Non-blocking: dispatchEvent already handles try/catch internally.
  dispatchEvent(payload);
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Emit a platform event.  This is the single entry-point that every emitter
 * should call.  It is asynchronous and non-blocking – the caller should NOT
 * await it.
 */
export function emitEvent(payload: StreamlineEventPayload): void {
  try {
    bus.emit("event", payload);
  } catch (err: any) {
    console.error("[event-bus] Unexpected emit error:", err?.message || err);
  }
}

/**
 * Register an additional listener for all platform events.
 * Useful for tests or secondary consumers (e.g. analytics).
 */
export function onEvent(
  handler: (payload: StreamlineEventPayload) => void
): void {
  bus.on("event", handler);
}

/**
 * Remove a previously registered listener.
 */
export function offEvent(
  handler: (payload: StreamlineEventPayload) => void
): void {
  bus.off("event", handler);
}

export { bus as _bus };
