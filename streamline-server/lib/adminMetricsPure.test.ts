import test from "node:test";
import assert from "node:assert/strict";
import {
  activityWindows,
  buildUsersByPlan,
  createTtlCache,
  emailPrefixRange,
  matchesProgramContext,
  monthKeysBetween,
  normalizeUserListQuery,
  sumCountParts,
  sumStreamingMinutes,
  withTimeout,
} from "./adminMetricsPure";

test("activityWindows: UTC day/month starts and rolling week", () => {
  const now = Date.UTC(2026, 9, 4, 15, 30); // 2026-10-04T15:30Z
  const w = activityWindows(now);
  assert.equal(w.dayStartMs, Date.UTC(2026, 9, 4));
  assert.equal(w.monthStartMs, Date.UTC(2026, 9, 1));
  assert.equal(w.weekStartMs, now - 7 * 86_400_000);
});

test("monthKeysBetween: inclusive UTC months, capped (newest kept)", () => {
  assert.deepEqual(monthKeysBetween(Date.UTC(2025, 10, 15), Date.UTC(2026, 1, 2)), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.deepEqual(monthKeysBetween(Date.UTC(2026, 1, 2), Date.UTC(2026, 1, 1)), ["2026-02"]);
  const capped = monthKeysBetween(0, Date.UTC(2026, 9, 4), 3);
  assert.deepEqual(capped, ["2026-08", "2026-09", "2026-10"]);
});

test("buildUsersByPlan: users without a plan count as free", () => {
  const out = buildUsersByPlan({
    planIds: ["free", "basic", "pro"],
    counts: { free: 3, basic: 2, pro: 1 },
    totalUsers: 10,
  });
  assert.deepEqual(out, { free: 7, basic: 2, pro: 1 });
  // Never below the explicit free count; never negative.
  assert.equal(buildUsersByPlan({ planIds: ["free", "pro"], counts: { free: 5, pro: 9 }, totalUsers: 4 }).free, 5);
});

test("sumStreamingMinutes: same reader as the gate (legacy seed when field missing)", () => {
  const docs = [
    { usage: { streamingMinutes: 10.5 } },
    { usage: { minutes: { live: { currentPeriod: 4 } }, hlsMinutes: 1 } },
    {},
  ];
  assert.equal(sumStreamingMinutes(docs), 15.5);
});

test("normalizeUserListQuery: limits, cursor, search, plan", () => {
  const q = normalizeUserListQuery({ limit: "500", cursor: "abc_DEF-1", search: "  Ann@Ex ", plan: "pro", includeDeleted: "1" });
  assert.deepEqual(q, { limit: 200, cursor: "abc_DEF-1", search: "ann@ex", plan: "pro", includeDeleted: true });
  const d = normalizeUserListQuery({});
  assert.deepEqual(d, { limit: 50, cursor: null, search: "", plan: null, includeDeleted: false });
  assert.equal(normalizeUserListQuery({ cursor: "../x", plan: "all" }).cursor, null);
  assert.equal(normalizeUserListQuery({ plan: "all" }).plan, null);
  assert.equal(normalizeUserListQuery({ plan: "drop table" }).plan, null);
  assert.equal(normalizeUserListQuery({ limit: "0" }).limit, 50);
});

test("emailPrefixRange: lower-cased prefix range", () => {
  assert.deepEqual(emailPrefixRange(" Bob "), { start: "bob", end: "bob" });
});

test("sumCountParts: null only when every part failed", () => {
  assert.equal(sumCountParts([1, null, 2]), 3);
  assert.equal(sumCountParts([null, undefined]), null);
  assert.equal(sumCountParts([0]), 0);
});

test("matchesProgramContext", () => {
  assert.equal(matchesProgramContext({}, null), true);
  assert.equal(matchesProgramContext({ programId: "p1" }, "p1"), true);
  assert.equal(matchesProgramContext({ meta: { programId: "p1" } }, "p1"), true);
  assert.equal(matchesProgramContext({ programId: "p2" }, "p1"), false);
});

test("createTtlCache: caches, dedupes in-flight loads, does not cache failures", async () => {
  const cache = createTtlCache<number>(1000);
  let calls = 0;
  const load = async () => {
    calls += 1;
    return 42;
  };
  const [a, b] = await Promise.all([cache.get("k", load), cache.get("k", load)]);
  assert.equal(a, 42);
  assert.equal(b, 42);
  assert.equal(calls, 1);
  assert.equal(await cache.get("k", load), 42);
  assert.equal(calls, 1);
  assert.equal(cache.peek("k", Date.now() + 5000), undefined, "expired");

  await assert.rejects(cache.get("bad", async () => Promise.reject(new Error("boom"))));
  assert.equal(await cache.get("bad", async () => 7), 7);
});

test("withTimeout rejects slow promises", async () => {
  await assert.rejects(withTimeout(new Promise((r) => setTimeout(r, 200)), 10), /timeout/);
  assert.equal(await withTimeout(Promise.resolve(1), 100), 1);
});
