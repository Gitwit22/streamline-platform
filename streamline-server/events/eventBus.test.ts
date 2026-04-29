/**
 * Unit tests for events/eventBus.ts
 *
 * We test the public API (emitEvent, onEvent, offEvent) in isolation
 * from the webhook dispatcher by temporarily removing the default listener.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { emitEvent, onEvent, offEvent, _bus } from "./eventBus";
import { createEventPayload } from "./eventTypes";

describe("eventBus", () => {
  // Capture events received by our test listener.
  let captured: any[] = [];
  const listener = (payload: any) => captured.push(payload);

  // Temporarily silence the default webhook-dispatch listener to avoid
  // import-side-effect issues in a test environment (no Firestore, etc.).
  let originalListeners: Function[] = [];

  beforeEach(() => {
    captured = [];
    originalListeners = _bus.rawListeners("event") as Function[];
    _bus.removeAllListeners("event");
    onEvent(listener);
  });

  afterEach(() => {
    offEvent(listener);
    // Restore original listeners.
    for (const l of originalListeners) {
      _bus.on("event", l as any);
    }
  });

  it("emitEvent delivers payload to registered listener", () => {
    const payload = createEventPayload("chat.message.created", {
      roomId: "room_1",
      entityId: "msg_1",
    });
    emitEvent(payload);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].event, "chat.message.created");
    assert.equal(captured[0].roomId, "room_1");
  });

  it("offEvent stops delivery to unregistered listener", () => {
    offEvent(listener);
    emitEvent(createEventPayload("room.created"));
    assert.equal(captured.length, 0);
  });

  it("multiple listeners each receive the event", () => {
    const other: any[] = [];
    const otherListener = (p: any) => other.push(p);
    onEvent(otherListener);

    emitEvent(createEventPayload("alert.created", { entityId: "a1" }));

    assert.equal(captured.length, 1);
    assert.equal(other.length, 1);

    offEvent(otherListener);
  });
});
