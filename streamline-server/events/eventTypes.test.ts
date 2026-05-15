/**
 * Unit tests for events/eventTypes.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EventTypes,
  eventCategory,
  createEventPayload,
} from "./eventTypes";

// ---------------------------------------------------------------------------
// EventTypes constant exhaustiveness
// ---------------------------------------------------------------------------

describe("EventTypes", () => {
  it("contains all expected chat events", () => {
    assert.equal(EventTypes.CHAT_MESSAGE_CREATED, "chat.message.created");
    assert.equal(EventTypes.CHAT_MESSAGE_DELETED, "chat.message.deleted");
  });

  it("contains all expected voice events", () => {
    assert.equal(EventTypes.VOICE_STREAM_STARTED, "voice.stream.started");
    assert.equal(EventTypes.VOICE_STREAM_CHUNK_RECEIVED, "voice.stream.chunk_received");
    assert.equal(EventTypes.VOICE_STREAM_ENDED, "voice.stream.ended");
  });

  it("contains all expected support events", () => {
    assert.equal(EventTypes.SUPPORT_TICKET_CREATED, "support.ticket.created");
    assert.equal(EventTypes.SUPPORT_TICKET_UPDATED, "support.ticket.updated");
    assert.equal(EventTypes.SUPPORT_TICKET_MESSAGE_ADDED, "support.ticket.message_added");
    assert.equal(EventTypes.SUPPORT_TICKET_CLOSED, "support.ticket.closed");
  });

  it("contains all expected room events", () => {
    assert.equal(EventTypes.ROOM_CREATED, "room.created");
    assert.equal(EventTypes.ROOM_STARTED, "room.started");
    assert.equal(EventTypes.ROOM_ENDED, "room.ended");
    assert.equal(EventTypes.ROOM_PARTICIPANT_JOINED, "room.participant_joined");
    assert.equal(EventTypes.ROOM_PARTICIPANT_LEFT, "room.participant_left");
    assert.equal(EventTypes.ROOM_BROADCAST_STARTED, "room.broadcast_started");
    assert.equal(EventTypes.ROOM_BROADCAST_ENDED, "room.broadcast_ended");
  });

  it("contains all expected monitoring events", () => {
    assert.equal(EventTypes.MONITORING_HEALTH_CHANGED, "monitoring.health.changed");
    assert.equal(EventTypes.MONITORING_SERVICE_DEGRADED, "monitoring.service.degraded");
    assert.equal(EventTypes.MONITORING_SERVICE_RESTORED, "monitoring.service.restored");
    assert.equal(EventTypes.MONITORING_WEBHOOK_FAILED, "monitoring.webhook.failed");
    assert.equal(EventTypes.MONITORING_WEBHOOK_RESTORED, "monitoring.webhook.restored");
  });

  it("contains all expected alert events", () => {
    assert.equal(EventTypes.ALERT_CREATED, "alert.created");
    assert.equal(EventTypes.ALERT_ACKNOWLEDGED, "alert.acknowledged");
    assert.equal(EventTypes.ALERT_RESOLVED, "alert.resolved");
  });
});

// ---------------------------------------------------------------------------
// eventCategory
// ---------------------------------------------------------------------------

describe("eventCategory", () => {
  it("maps chat events to 'chat'", () => {
    assert.equal(eventCategory("chat.message.created"), "chat");
    assert.equal(eventCategory("chat.message.deleted"), "chat");
  });

  it("maps voice events to 'voice'", () => {
    assert.equal(eventCategory("voice.stream.started"), "voice");
  });

  it("maps support events to 'support'", () => {
    assert.equal(eventCategory("support.ticket.created"), "support");
  });

  it("maps monitoring events to 'monitoring'", () => {
    assert.equal(eventCategory("monitoring.health.changed"), "monitoring");
  });

  it("maps alert events to 'alert'", () => {
    assert.equal(eventCategory("alert.created"), "alert");
  });

  it("maps room events to 'room'", () => {
    assert.equal(eventCategory("room.created"), "room");
    assert.equal(eventCategory("room.participant_joined"), "room");
  });
});

// ---------------------------------------------------------------------------
// createEventPayload
// ---------------------------------------------------------------------------

describe("createEventPayload", () => {
  it("produces a well-formed payload with defaults", () => {
    const p = createEventPayload("chat.message.created");
    assert.equal(p.event, "chat.message.created");
    assert.equal(p.source, "streamline");
    assert.equal(p.tenantId, null);
    assert.equal(p.orgId, null);
    assert.equal(p.schoolId, null);
    assert.equal(p.roomId, null);
    assert.equal(p.entityId, null);
    assert.equal(p.actor, null);
    assert.deepEqual(p.data, {});
    // Timestamp is ISO-8601
    assert.ok(typeof p.timestamp === "string");
    assert.ok(!isNaN(Date.parse(p.timestamp)));
  });

  it("fills in all provided optional fields", () => {
    const actor = { userId: "u1", username: "Alice", role: "teacher" };
    const p = createEventPayload("support.ticket.created", {
      tenantId: "t1",
      orgId: "o1",
      schoolId: "s1",
      roomId: "r1",
      entityId: "e1",
      actor,
      data: { title: "test" },
    });
    assert.equal(p.tenantId, "t1");
    assert.equal(p.orgId, "o1");
    assert.equal(p.schoolId, "s1");
    assert.equal(p.roomId, "r1");
    assert.equal(p.entityId, "e1");
    assert.deepEqual(p.actor, actor);
    assert.deepEqual(p.data, { title: "test" });
  });
});
