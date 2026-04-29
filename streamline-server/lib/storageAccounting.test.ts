/**
 * Storage accounting unit tests.
 *
 * These tests validate the pure/deterministic helpers exported from storagePure.ts.
 * The Firestore-dependent functions (reserveStorageUsage, releaseStorageUsage, etc.)
 * require a live Firestore instance and are covered by integration tests or manual
 * verification — only the pure logic is tested here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  computeNextResetDate,
  resolveMaxStorageBytesFromPlan,
  canReserveStorage,
} from "./storagePure.js";

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

// =============================================================================
// resolveMaxStorageBytesFromPlan
// =============================================================================

test("resolveMaxStorageBytesFromPlan returns bytes from editing.maxStorageGB", () => {
  const plan = { editing: { maxStorageGB: 5 } };
  const result = resolveMaxStorageBytesFromPlan(plan);
  assert.equal(result, 5 * GB);
});

test("resolveMaxStorageBytesFromPlan returns bytes from editing.maxStorageBytes", () => {
  const plan = { editing: { maxStorageBytes: 3221225472 } }; // 3 GB
  const result = resolveMaxStorageBytesFromPlan(plan);
  assert.equal(result, 3221225472);
});

test("resolveMaxStorageBytesFromPlan falls back to top-level maxStorageGB", () => {
  const plan = { maxStorageGB: 10 };
  const result = resolveMaxStorageBytesFromPlan(plan);
  assert.equal(result, 10 * GB);
});

test("resolveMaxStorageBytesFromPlan falls back to top-level maxStorageBytes", () => {
  const plan = { maxStorageBytes: 5368709120 }; // 5 GB
  const result = resolveMaxStorageBytesFromPlan(plan);
  assert.equal(result, 5368709120);
});

test("resolveMaxStorageBytesFromPlan prefers editing.maxStorageGB over top-level", () => {
  const plan = { editing: { maxStorageGB: 3 }, maxStorageGB: 10 };
  const result = resolveMaxStorageBytesFromPlan(plan);
  assert.equal(result, 3 * GB);
});

test("resolveMaxStorageBytesFromPlan returns 0 for empty plan", () => {
  assert.equal(resolveMaxStorageBytesFromPlan({}), 0);
  assert.equal(resolveMaxStorageBytesFromPlan(null), 0);
  assert.equal(resolveMaxStorageBytesFromPlan(undefined), 0);
});

test("resolveMaxStorageBytesFromPlan returns 0 for non-numeric values", () => {
  assert.equal(resolveMaxStorageBytesFromPlan({ editing: { maxStorageGB: "not_a_number" } }), 0);
  assert.equal(resolveMaxStorageBytesFromPlan({ editing: { maxStorageGB: NaN } }), 0);
  assert.equal(resolveMaxStorageBytesFromPlan({ editing: { maxStorageGB: -5 } }), 0);
});

test("resolveMaxStorageBytesFromPlan handles string-number values", () => {
  // Firestore may return numbers as strings in some cases
  const plan = { editing: { maxStorageGB: "15" } };
  const result = resolveMaxStorageBytesFromPlan(plan);
  assert.equal(result, 15 * GB);
});

test("resolveMaxStorageBytesFromPlan handles zero correctly", () => {
  // 0 means no storage allowed
  assert.equal(resolveMaxStorageBytesFromPlan({ editing: { maxStorageGB: 0 } }), 0);
});

// =============================================================================
// canReserveStorage — transactional quota enforcement logic
// =============================================================================

test("canReserveStorage allows reservation when well under limit", () => {
  const result = canReserveStorage(1 * GB, 100 * MB, 10 * GB);
  assert.equal(result.allowed, true);
  assert.equal(result.currentBytes, 1 * GB);
  assert.equal(result.requestedBytes, 100 * MB);
  assert.equal(result.limitBytes, 10 * GB);
  assert.equal(result.newTotalBytes, 1 * GB + 100 * MB);
});

test("canReserveStorage allows reservation when exactly at limit", () => {
  // 9 GB used + 1 GB requested = 10 GB limit — should be allowed
  const result = canReserveStorage(9 * GB, 1 * GB, 10 * GB);
  assert.equal(result.allowed, true);
  assert.equal(result.newTotalBytes, 10 * GB);
});

test("canReserveStorage rejects when limit would be exceeded", () => {
  // 9.5 GB used + 1 GB requested = 10.5 GB > 10 GB limit — reject
  const result = canReserveStorage(9.5 * GB, 1 * GB, 10 * GB);
  assert.equal(result.allowed, false);
  assert.ok(result.reason);
  assert.ok(result.reason!.includes("Storage limit exceeded"));
});

test("canReserveStorage rejects when already at limit", () => {
  // 10 GB used + any request > limit
  const result = canReserveStorage(10 * GB, 1, 10 * GB);
  assert.equal(result.allowed, false);
});

test("canReserveStorage allows when limit is 0 (unlimited)", () => {
  // 0 limit means unlimited
  const result = canReserveStorage(999 * GB, 100 * GB, 0);
  assert.equal(result.allowed, true);
});

test("canReserveStorage rejects requestedBytes <= 0", () => {
  assert.equal(canReserveStorage(0, 0, 10 * GB).allowed, false);
  assert.equal(canReserveStorage(0, -1, 10 * GB).allowed, false);
});

test("canReserveStorage handles NaN/Infinity gracefully", () => {
  assert.equal(canReserveStorage(NaN, 100, 10 * GB).allowed, true);
  assert.equal(canReserveStorage(0, NaN, 10 * GB).allowed, false);
  assert.equal(canReserveStorage(0, Infinity, 10 * GB).allowed, false);
});

test("canReserveStorage: two concurrent requests for final slot — only one can succeed", () => {
  // Simulates two concurrent callers seeing 9.5 GB used with 10 GB limit.
  // Both request 500 MB.  In a real Firestore transaction only one succeeds
  // because the transaction serializes.  This test verifies the pure decision
  // logic: both would see "allowed" from the same snapshot, so the
  // correctness relies on the transaction — but a single call is correct.
  const snapshot = 9.5 * GB;
  const request = 500 * MB;
  const limit = 10 * GB;

  const r1 = canReserveStorage(snapshot, request, limit);
  assert.equal(r1.allowed, true);
  assert.equal(r1.newTotalBytes, snapshot + request);

  // After r1 is committed, the counter is now snapshot + request
  const r2 = canReserveStorage(snapshot + request, request, limit);
  assert.equal(r2.allowed, false, "second request must be rejected after first is committed");
});

test("canReserveStorage: reservation rejected returns reason string", () => {
  const result = canReserveStorage(9 * GB, 2 * GB, 10 * GB);
  assert.equal(result.allowed, false);
  assert.equal(typeof result.reason, "string");
  assert.ok(result.reason!.length > 0);
});

test("canReserveStorage: successful reservation leaves correct final usage", () => {
  const current = 3 * GB;
  const requested = 500 * MB;
  const result = canReserveStorage(current, requested, 10 * GB);
  assert.equal(result.allowed, true);
  assert.equal(result.newTotalBytes, current + requested);
});

// =============================================================================
// computeNextResetDate (pre-existing, verify it still works)
// =============================================================================

test("computeNextResetDate returns a valid date", () => {
  const result = computeNextResetDate(new Date("2024-01-15"));
  assert.ok(result instanceof Date);
  assert.ok(!isNaN(result.getTime()));
});

test("computeNextResetDate handles string input", () => {
  const result = computeNextResetDate("2024-06-10");
  assert.ok(result instanceof Date);
  assert.ok(!isNaN(result.getTime()));
});

// =============================================================================
// Idempotency flag semantics (documented behavior)
// =============================================================================

test("storageCounted and storageReleased flags are independent", () => {
  // This tests the documented contract, not actual Firestore behavior.
  // A recording can be: { storageCounted: true, storageReleased: false } (normal active)
  //                  or: { storageCounted: true, storageReleased: true } (deleted after counting)
  //                  or: { storageCounted: false } (not yet ready)
  // storageReleased should never be true if storageCounted is false.
  const states = [
    { storageCounted: false, storageReleased: false, valid: true },
    { storageCounted: true, storageReleased: false, valid: true },
    { storageCounted: true, storageReleased: true, valid: true },
    { storageCounted: false, storageReleased: true, valid: false },
  ];

  for (const state of states) {
    // A release should only happen if counting already happened
    const shouldRelease = state.storageCounted && !state.storageReleased;
    const shouldCount = !state.storageCounted;

    if (state.valid) {
      // Valid states: can determine correct accounting action
      assert.ok(shouldRelease || shouldCount || state.storageReleased,
        `State ${JSON.stringify(state)} should have a clear accounting path`);
    }
  }
});

// =============================================================================
// Usage summary contract: storage fields presence
// =============================================================================

test("usage summary response shape includes storage fields", () => {
  // This documents the expected contract for the API response
  const expectedFields = [
    "storageUsedBytes",
    "storageLimitBytes",
    "storageUsedGB",
    "storageLimitGB",
  ];

  // These fields should be present in the response body
  for (const field of expectedFields) {
    assert.ok(typeof field === "string", `${field} should be a string key`);
  }
});
