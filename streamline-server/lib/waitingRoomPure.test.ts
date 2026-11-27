import test from "node:test";
import assert from "node:assert/strict";
import {
  ADMISSION_TTL_MS,
  DENIAL_TTL_MS,
  WAITING_PRESENCE_TTL_MS,
  admissionState,
  isValidWaitingEntryId,
  isWaitingRoomEnabled,
  visibleWaitingEntries,
  waitingEntryId,
  waitingRoomApplies,
} from "./waitingRoomPure";

const NOW = 1_800_000_000_000;

test("isWaitingRoomEnabled is only true for an explicit true (old rooms stay off)", () => {
  assert.equal(isWaitingRoomEnabled({ waitingRoomEnabled: true }), true);
  assert.equal(isWaitingRoomEnabled({ waitingRoomEnabled: false }), false);
  assert.equal(isWaitingRoomEnabled({ waitingRoomEnabled: "true" }), false);
  assert.equal(isWaitingRoomEnabled({}), false);
  assert.equal(isWaitingRoomEnabled(null), false);
});

test("waitingRoomApplies: off means nobody waits", () => {
  assert.equal(waitingRoomApplies({ enabled: false, isHostLike: false, isCohost: false, role: "guest" }), false);
});

test("waitingRoomApplies: host, producers, admins and cohosts never wait", () => {
  assert.equal(waitingRoomApplies({ enabled: true, isHostLike: true, isCohost: false, role: "host" }), false);
  assert.equal(waitingRoomApplies({ enabled: true, isHostLike: false, isCohost: true, role: "cohost" }), false);
  assert.equal(waitingRoomApplies({ enabled: true, isHostLike: false, isCohost: false, role: "cohost" }), false);
});

test("waitingRoomApplies: audience viewers never wait", () => {
  assert.equal(waitingRoomApplies({ enabled: true, isHostLike: false, isCohost: false, role: "viewer" }), false);
});

test("waitingRoomApplies: guests and signed-in participants wait", () => {
  assert.equal(waitingRoomApplies({ enabled: true, isHostLike: false, isCohost: false, role: "guest" }), true);
  assert.equal(waitingRoomApplies({ enabled: true, isHostLike: false, isCohost: false, role: "participant" }), true);
});

test("admissionState: no entry, or an unknown status, is none", () => {
  assert.equal(admissionState(null, NOW), "none");
  assert.equal(admissionState({ status: "bogus" }, NOW), "none");
});

test("admissionState: waiting stays waiting", () => {
  assert.equal(admissionState({ status: "waiting", lastSeenAtMs: NOW - 1000 }, NOW), "waiting");
});

test("admissionState: an admission lasts ADMISSION_TTL_MS, then the person waits again", () => {
  assert.equal(admissionState({ status: "admitted", decidedAtMs: NOW - 1000 }, NOW), "admitted");
  assert.equal(admissionState({ status: "admitted", decidedAtMs: NOW - ADMISSION_TTL_MS + 1 }, NOW), "admitted");
  assert.equal(admissionState({ status: "admitted", decidedAtMs: NOW - ADMISSION_TTL_MS }, NOW), "none");
  // A decision without a time can't be trusted to still apply.
  assert.equal(admissionState({ status: "admitted" }, NOW), "none");
});

test("admissionState: a denial expires after DENIAL_TTL_MS", () => {
  assert.equal(admissionState({ status: "denied", decidedAtMs: NOW - 1000 }, NOW), "denied");
  assert.equal(admissionState({ status: "denied", decidedAtMs: NOW - DENIAL_TTL_MS }, NOW), "none");
});

test("visibleWaitingEntries: only recent waiting entries, oldest first", () => {
  const list = visibleWaitingEntries(
    [
      { id: "b", status: "waiting", displayName: "Bea", requestedAtMs: NOW - 5000, lastSeenAtMs: NOW - 1000 },
      { id: "a", status: "waiting", displayName: "Al", requestedAtMs: NOW - 9000, lastSeenAtMs: NOW - 2000 },
      { id: "gone", status: "waiting", displayName: "Left", requestedAtMs: NOW - 99000, lastSeenAtMs: NOW - WAITING_PRESENCE_TTL_MS - 1 },
      { id: "in", status: "admitted", displayName: "In", requestedAtMs: NOW - 1000, lastSeenAtMs: NOW },
      { id: "no", status: "denied", displayName: "No", requestedAtMs: NOW - 1000, lastSeenAtMs: NOW },
    ],
    NOW,
  );
  assert.deepEqual(list, [
    { id: "a", displayName: "Al", waitingSince: NOW - 9000 },
    { id: "b", displayName: "Bea", waitingSince: NOW - 5000 },
  ]);
});

test("visibleWaitingEntries: blank names read as Guest", () => {
  const [e] = visibleWaitingEntries([{ id: "x", status: "waiting", displayName: "  ", lastSeenAtMs: NOW }], NOW);
  assert.equal(e.displayName, "Guest");
  assert.equal(e.waitingSince, NOW);
});

test("waitingEntryId is stable, distinct per identity, and URL/doc-id safe", () => {
  const a = waitingEntryId("invite:abc:123");
  assert.equal(a, waitingEntryId("invite:abc:123"));
  assert.notEqual(a, waitingEntryId("invite:abc:124"));
  assert.equal(isValidWaitingEntryId(a), true);
  assert.equal(isValidWaitingEntryId("../x"), false);
  assert.equal(isValidWaitingEntryId(""), false);
  assert.equal(isValidWaitingEntryId(123), false);
});
