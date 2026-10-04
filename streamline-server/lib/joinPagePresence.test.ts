import test from "node:test";
import assert from "node:assert/strict";
import {
  JOIN_PAGE_PRESENCE_TTL_MS,
  hasRecentEnteredRoom,
  isValidPresenceRoomId,
  joinPresenceKey,
  parseGuestPresenceStage,
  summarizeJoinPagePresence,
} from "./joinPagePresence";

const NOW = 1_800_000_000_000;

test("parseGuestPresenceStage accepts only known stages", () => {
  assert.equal(parseGuestPresenceStage("join_page"), "join_page");
  assert.equal(parseGuestPresenceStage(" ENTERED_ROOM "), "entered_room");
  assert.equal(parseGuestPresenceStage("left"), "left");
  assert.equal(parseGuestPresenceStage("viewer_join_success"), null);
  assert.equal(parseGuestPresenceStage(undefined), null);
});

test("isValidPresenceRoomId rejects empty, long and path-like ids", () => {
  assert.equal(isValidPresenceRoomId("room_123"), true);
  assert.equal(isValidPresenceRoomId(""), false);
  assert.equal(isValidPresenceRoomId("a/b"), false);
  assert.equal(isValidPresenceRoomId(".."), false);
  assert.equal(isValidPresenceRoomId("x".repeat(129)), false);
  assert.equal(isValidPresenceRoomId(42), false);
});

test("joinPresenceKey is stable per identity and distinct from fingerprints", () => {
  const a = joinPresenceKey({ identity: "invite:abc:1" });
  assert.equal(a, joinPresenceKey({ identity: "invite:abc:1", fallback: "ip|ua" }));
  assert.notEqual(a, joinPresenceKey({ identity: "invite:abc:2" }));
  assert.notEqual(joinPresenceKey({ fallback: "1.2.3.4|ua" }), joinPresenceKey({ fallback: "1.2.3.5|ua" }));
  assert.match(a, /^[A-Za-z0-9_-]{32}$/);
});

test("summarizeJoinPagePresence counts only fresh join_page heartbeats", () => {
  const summary = summarizeJoinPagePresence(
    [
      { stage: "join_page", displayName: "Ann", lastSeenAtMs: NOW - 5_000 },
      { stage: "join_page", displayName: "Bob", lastSeenAtMs: NOW - 20_000 },
      { stage: "join_page", displayName: "Old", lastSeenAtMs: NOW - JOIN_PAGE_PRESENCE_TTL_MS - 1 },
      { stage: "entered_room", displayName: "In", lastSeenAtMs: NOW - 1_000 },
      { stage: "join_page", displayName: null, lastSeenAtMs: NOW - 10_000 },
      { stage: "join_page", displayName: "NoTs", lastSeenAtMs: null },
    ],
    NOW,
  );
  assert.equal(summary.count, 3);
  assert.deepEqual(summary.names, ["Ann", "Bob"]);
  assert.equal(summary.lastSeenAt, NOW - 5_000);
});

test("summarizeJoinPagePresence expires entries exactly at the TTL boundary", () => {
  const atEdge = summarizeJoinPagePresence([{ stage: "join_page", lastSeenAtMs: NOW - 60_000 }], NOW);
  assert.equal(atEdge.count, 1);
  const past = summarizeJoinPagePresence([{ stage: "join_page", lastSeenAtMs: NOW - 60_001 }], NOW);
  assert.deepEqual(past, { count: 0, names: [], lastSeenAt: null });
});

test("summarizeJoinPagePresence de-duplicates names and caps the list", () => {
  const entries = Array.from({ length: 15 }, (_, i) => ({
    stage: "join_page",
    displayName: i < 2 ? "Same" : `G${i}`,
    lastSeenAtMs: NOW - i,
  }));
  const s = summarizeJoinPagePresence(entries, NOW);
  assert.equal(s.count, 15);
  assert.equal(s.names.length, 10);
  assert.equal(s.names.filter((n) => n === "Same").length, 1);
});

test("hasRecentEnteredRoom honors its window", () => {
  assert.equal(hasRecentEnteredRoom([{ stage: "entered_room", lastSeenAtMs: NOW - 60_000 }], NOW), true);
  assert.equal(hasRecentEnteredRoom([{ stage: "entered_room", lastSeenAtMs: NOW - 16 * 60_000 }], NOW), false);
  assert.equal(hasRecentEnteredRoom([{ stage: "join_page", lastSeenAtMs: NOW }], NOW), false);
});
