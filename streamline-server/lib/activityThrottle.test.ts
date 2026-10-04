import test from "node:test";
import assert from "node:assert/strict";
import { ACTIVITY_WRITE_INTERVAL_MS, buildActivityPatch, createActivityThrottle } from "./activityThrottle";

test("activity throttle: one write per uid per interval", () => {
  const t = createActivityThrottle({ intervalMs: 10 * 60 * 1000 });
  const t0 = 1_700_000_000_000;
  assert.equal(t.shouldWrite("u1", t0), true);
  assert.equal(t.shouldWrite("u1", t0 + 1000), false);
  assert.equal(t.shouldWrite("u1", t0 + 9 * 60 * 1000), false);
  assert.equal(t.shouldWrite("u2", t0 + 1000), true, "other uids are independent");
  assert.equal(t.shouldWrite("u1", t0 + 10 * 60 * 1000), true, "due again after the interval");
  assert.equal(t.shouldWrite("u1", t0 + 10 * 60 * 1000 + 5), false);
});

test("activity throttle: default interval is 10 minutes", () => {
  assert.equal(ACTIVITY_WRITE_INTERVAL_MS, 600_000);
  const t = createActivityThrottle();
  assert.equal(t.shouldWrite("u", 0 + 1), true);
  assert.equal(t.shouldWrite("u", 599_000), false);
  assert.equal(t.shouldWrite("u", 600_001), true);
});

test("activity throttle: forget() allows an immediate retry; empty uid never writes", () => {
  const t = createActivityThrottle();
  assert.equal(t.shouldWrite("u", 1000), true);
  t.forget("u");
  assert.equal(t.shouldWrite("u", 1001), true);
  assert.equal(t.shouldWrite("", 1000), false);
  assert.equal(t.shouldWrite("   ", 1000), false);
});

test("activity throttle: clock going backwards writes instead of starving", () => {
  const t = createActivityThrottle({ intervalMs: 1000 });
  assert.equal(t.shouldWrite("u", 5000), true);
  assert.equal(t.shouldWrite("u", 4000), true);
});

test("activity throttle: bounded map evicts oldest entries", () => {
  const t = createActivityThrottle({ maxEntries: 3 });
  for (const uid of ["a", "b", "c", "d"]) assert.equal(t.shouldWrite(uid, 1000), true);
  assert.equal(t.size(), 3);
  assert.equal(t.shouldWrite("a", 1001), true, "evicted uid writes again");
  assert.equal(t.shouldWrite("d", 1001), false);
});

test("buildActivityPatch: lastActiveAt + lazy emailLower backfill", () => {
  assert.deepEqual(buildActivityPatch({ email: "Ann@Example.com" }, 5), { lastActiveAt: 5, emailLower: "ann@example.com" });
  assert.deepEqual(buildActivityPatch({ email: "ann@example.com", emailLower: "ann@example.com" }, 6), { lastActiveAt: 6 });
  assert.deepEqual(buildActivityPatch({}, 7), { lastActiveAt: 7 });
  assert.deepEqual(buildActivityPatch(null, 8), { lastActiveAt: 8 });
});
