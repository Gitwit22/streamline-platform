import test from "node:test";
import assert from "node:assert/strict";
import {
  HORIZON_EVENT_DATA_MAX_BYTES,
  buildHorizonEventDoc,
  horizonEventsToPrune,
  shouldPersistHorizonEvent,
} from "./horizonEventStorePure";

test("shouldPersistHorizonEvent: alerts, support and monitoring (not heartbeats)", () => {
  assert.equal(shouldPersistHorizonEvent("support.alert"), true);
  assert.equal(shouldPersistHorizonEvent("alert.created"), true);
  assert.equal(shouldPersistHorizonEvent("monitoring.alert"), true);
  assert.equal(shouldPersistHorizonEvent("monitoring.heartbeat"), false);
  assert.equal(shouldPersistHorizonEvent("chat.response"), false);
  assert.equal(shouldPersistHorizonEvent("ack"), false);
  assert.equal(shouldPersistHorizonEvent(""), false);
});

test("buildHorizonEventDoc: shape and severity", () => {
  const doc = buildHorizonEventDoc("support.alert", "e1", { severity: "HIGH", title: "Stream down", message: "room r1", roomId: "r1" }, 42);
  assert.equal(doc.type, "support.alert");
  assert.equal(doc.eventId, "e1");
  assert.equal(doc.status, "pending");
  assert.equal(doc.severity, "high");
  assert.equal(doc.title, "Stream down");
  assert.equal(doc.roomId, "r1");
  assert.equal(doc.createdAt, 42);
  assert.equal(doc.dataTruncated, false);
  assert.equal(buildHorizonEventDoc("alert.x", "", { severity: "weird" }, 1).severity, "info");
});

test("buildHorizonEventDoc: oversized data is truncated; undefined values dropped", () => {
  const big = buildHorizonEventDoc("alert.x", "e", { blob: "x".repeat(HORIZON_EVENT_DATA_MAX_BYTES * 2) }, 1);
  assert.equal(big.dataTruncated, true);
  assert.ok(String(big.data.truncatedJson).length <= HORIZON_EVENT_DATA_MAX_BYTES);
  const clean = buildHorizonEventDoc("alert.x", "e", { a: undefined, b: 1 }, 1);
  assert.deepEqual(clean.data, { b: 1 });
  assert.deepEqual(buildHorizonEventDoc("alert.x", "e", null, 1).data, {});
});

test("horizonEventsToPrune", () => {
  assert.equal(horizonEventsToPrune(1000, 1000), 0);
  assert.equal(horizonEventsToPrune(1037, 1000), 37);
  assert.equal(horizonEventsToPrune(-1, 1000), 0);
});
