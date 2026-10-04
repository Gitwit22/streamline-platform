import test from "node:test";
import assert from "node:assert/strict";
import { SlidingWindowLimiter, normalizeRateLimitLogin, rateLimit } from "./rateLimit";

function clock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

test("allows up to max hits per window, then blocks with a retry hint", () => {
  const c = clock();
  const limiter = new SlidingWindowLimiter({ windowMs: 60_000, max: 3, now: c.now });

  assert.deepEqual(limiter.hit("k"), { allowed: true, remaining: 2, retryAfterMs: 0 });
  c.advance(10_000);
  assert.equal(limiter.hit("k").allowed, true);
  c.advance(10_000);
  assert.equal(limiter.hit("k").remaining, 0);

  c.advance(5_000);
  const blocked = limiter.hit("k");
  assert.equal(blocked.allowed, false);
  // Oldest hit (t=0) leaves the window at t=60s; we're at t=25s.
  assert.equal(blocked.retryAfterMs, 35_000);
});

test("window slides: old hits expire individually", () => {
  const c = clock();
  const limiter = new SlidingWindowLimiter({ windowMs: 60_000, max: 2, now: c.now });

  limiter.hit("k"); // t=0
  c.advance(30_000);
  limiter.hit("k"); // t=30s
  assert.equal(limiter.hit("k").allowed, false);

  c.advance(30_001); // first hit expired, second still in window
  assert.equal(limiter.hit("k").allowed, true);
  assert.equal(limiter.hit("k").allowed, false);
});

test("blocked hits are not recorded, so the limiter recovers on schedule", () => {
  const c = clock();
  const limiter = new SlidingWindowLimiter({ windowMs: 1_000, max: 1, now: c.now });
  limiter.hit("k");
  for (let i = 0; i < 50; i++) {
    c.advance(10);
    assert.equal(limiter.hit("k").allowed, false);
  }
  c.advance(1_000);
  assert.equal(limiter.hit("k").allowed, true);
});

test("keys are independent and reset() clears a key", () => {
  const c = clock();
  const limiter = new SlidingWindowLimiter({ windowMs: 60_000, max: 1, now: c.now });
  assert.equal(limiter.hit("a").allowed, true);
  assert.equal(limiter.hit("b").allowed, true);
  assert.equal(limiter.hit("a").allowed, false);
  limiter.reset("a");
  assert.equal(limiter.hit("a").allowed, true);
});

test("tracked keys are capped", () => {
  const c = clock();
  const limiter = new SlidingWindowLimiter({ windowMs: 60_000, max: 5, maxKeys: 100, now: c.now });
  for (let i = 0; i < 1_000; i++) limiter.hit(`ip:${i}`);
  assert.ok(limiter.size <= 100);
});

test("rejects invalid options", () => {
  assert.throws(() => new SlidingWindowLimiter({ windowMs: 0, max: 1 }));
  assert.throws(() => new SlidingWindowLimiter({ windowMs: 1_000, max: 0 }));
});

test("normalizeRateLimitLogin trims and lowercases", () => {
  assert.equal(normalizeRateLimitLogin("  User@Example.COM "), "user@example.com");
  assert.equal(normalizeRateLimitLogin(""), null);
  assert.equal(normalizeRateLimitLogin(undefined), null);
});

function fakeRes() {
  const res: any = { statusCode: 200, headers: {} as Record<string, string>, body: undefined };
  res.setHeader = (k: string, v: string) => {
    res.headers[k.toLowerCase()] = v;
  };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (b: any) => {
    res.body = b;
    return res;
  };
  return res;
}

test("middleware returns 429 rate_limited with Retry-After once any rule blocks", () => {
  const c = clock();
  const ipLimiter = new SlidingWindowLimiter({ windowMs: 60_000, max: 100, now: c.now });
  const acctLimiter = new SlidingWindowLimiter({ windowMs: 60_000, max: 2, now: c.now });
  const mw = rateLimit([
    { limiter: ipLimiter, key: (req: any) => `ip:${req.ip}` },
    { limiter: acctLimiter, key: (req: any) => normalizeRateLimitLogin(req.body?.email) },
  ]);

  let nextCalls = 0;
  const next = () => {
    nextCalls++;
  };

  // Different IPs, same account (case-insensitive): the account rule trips.
  for (const ip of ["1.1.1.1", "2.2.2.2"]) {
    const res = fakeRes();
    mw({ ip, body: { email: "Victim@Example.com" } } as any, res, next);
    assert.equal(res.statusCode, 200);
  }
  const res = fakeRes();
  mw({ ip: "3.3.3.3", body: { email: "victim@example.com " } } as any, res, next);
  assert.equal(nextCalls, 2);
  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.body, { error: "rate_limited" });
  assert.equal(res.headers["retry-after"], "60");

  // A rule whose key is null is skipped.
  const ok = fakeRes();
  mw({ ip: "4.4.4.4", body: {} } as any, ok, next);
  assert.equal(nextCalls, 3);
});
