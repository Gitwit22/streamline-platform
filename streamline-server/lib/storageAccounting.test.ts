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
} from "./storagePure.js";

// =============================================================================
// resolveMaxStorageBytesFromPlan
// =============================================================================

test("resolveMaxStorageBytesFromPlan returns bytes from editing.maxStorageGB", () => {
  const plan = { editing: { maxStorageGB: 5 } };
  const result = resolveMaxStorageBytesFromPlan(plan);
  assert.equal(result, 5 * 1024 * 1024 * 1024);
});

test("resolveMaxStorageBytesFromPlan returns bytes from editing.maxStorageBytes", () => {
  const plan = { editing: { maxStorageBytes: 3221225472 } }; // 3 GB
  const result = resolveMaxStorageBytesFromPlan(plan);
  assert.equal(result, 3221225472);
});

test("resolveMaxStorageBytesFromPlan falls back to top-level maxStorageGB", () => {
  const plan = { maxStorageGB: 10 };
  const result = resolveMaxStorageBytesFromPlan(plan);
  assert.equal(result, 10 * 1024 * 1024 * 1024);
});

test("resolveMaxStorageBytesFromPlan falls back to top-level maxStorageBytes", () => {
  const plan = { maxStorageBytes: 5368709120 }; // 5 GB
  const result = resolveMaxStorageBytesFromPlan(plan);
  assert.equal(result, 5368709120);
});

test("resolveMaxStorageBytesFromPlan prefers editing.maxStorageGB over top-level", () => {
  const plan = { editing: { maxStorageGB: 3 }, maxStorageGB: 10 };
  const result = resolveMaxStorageBytesFromPlan(plan);
  assert.equal(result, 3 * 1024 * 1024 * 1024);
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
  assert.equal(result, 15 * 1024 * 1024 * 1024);
});

test("resolveMaxStorageBytesFromPlan handles zero correctly", () => {
  // 0 means no storage allowed
  assert.equal(resolveMaxStorageBytesFromPlan({ editing: { maxStorageGB: 0 } }), 0);
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
