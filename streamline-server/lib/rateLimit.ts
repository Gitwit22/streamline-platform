import type { Request, RequestHandler } from "express";

/**
 * Small in-memory sliding-window rate limiter.
 *
 * Each key keeps the timestamps of the hits inside the current window. A hit is
 * allowed while fewer than `max` hits fall inside the last `windowMs`.
 *
 * Limits are per process. With several instances, each one enforces its own
 * budget, so the effective limit is `max * instances`. That is still enough to
 * stop online password guessing.
 */
export type RateLimitResult = {
  allowed: boolean;
  /** Hits left in the window after this one (0 when blocked). */
  remaining: number;
  /** Milliseconds until the next hit would be allowed (0 when allowed). */
  retryAfterMs: number;
};

export type SlidingWindowLimiterOptions = {
  windowMs: number;
  max: number;
  /** Upper bound on tracked keys, so a key flood can't exhaust memory. */
  maxKeys?: number;
  now?: () => number;
};

export class SlidingWindowLimiter {
  readonly windowMs: number;
  readonly max: number;
  private readonly maxKeys: number;
  private readonly now: () => number;
  private readonly hits = new Map<string, number[]>();

  constructor(opts: SlidingWindowLimiterOptions) {
    if (!(opts.windowMs > 0) || !(opts.max > 0)) {
      throw new Error("SlidingWindowLimiter requires windowMs > 0 and max > 0");
    }
    this.windowMs = opts.windowMs;
    this.max = Math.floor(opts.max);
    this.maxKeys = opts.maxKeys && opts.maxKeys > 0 ? opts.maxKeys : 50_000;
    this.now = opts.now || Date.now;
  }

  /** Records a hit for `key` and reports whether it is allowed. Blocked hits are not recorded. */
  hit(key: string): RateLimitResult {
    const now = this.now();
    const cutoff = now - this.windowMs;
    const existing = this.hits.get(key);
    const recent = existing ? existing.filter((t) => t > cutoff) : [];

    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      const retryAfterMs = Math.max(1, recent[0] + this.windowMs - now);
      return { allowed: false, remaining: 0, retryAfterMs };
    }

    recent.push(now);
    // Re-insert so Map iteration order approximates least-recently-used.
    this.hits.delete(key);
    this.hits.set(key, recent);
    this.evictIfNeeded(cutoff);
    return { allowed: true, remaining: this.max - recent.length, retryAfterMs: 0 };
  }

  /** Forgets all hits for `key` (for example after a successful login). */
  reset(key: string): void {
    this.hits.delete(key);
  }

  /** Number of tracked keys (for tests). */
  get size(): number {
    return this.hits.size;
  }

  private evictIfNeeded(cutoff: number) {
    if (this.hits.size <= this.maxKeys) return;
    // First drop keys whose hits have all expired.
    for (const [k, times] of this.hits) {
      if (!times.length || times[times.length - 1] <= cutoff) this.hits.delete(k);
    }
    // Then drop the oldest keys until under the cap.
    while (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next();
      if (oldest.done) break;
      this.hits.delete(oldest.value);
    }
  }
}

export type RateLimitRule = {
  limiter: SlidingWindowLimiter;
  /** Returns the key for this request, or null to skip this rule. */
  key: (req: Request) => string | null;
};

export function clientIp(req: Request): string {
  return String(req.ip || (req.socket as any)?.remoteAddress || "unknown");
}

export function normalizeRateLimitLogin(value: unknown): string | null {
  const v = String(value ?? "").trim().toLowerCase();
  return v ? v.slice(0, 320) : null;
}

/**
 * Express middleware that applies every rule. All rules record the hit; if any
 * blocks, it responds 429 { error: "rate_limited" } with Retry-After (seconds).
 */
export function rateLimit(rules: RateLimitRule[]): RequestHandler {
  return (req, res, next) => {
    let retryAfterMs = 0;
    for (const rule of rules) {
      const key = rule.key(req);
      if (!key) continue;
      const result = rule.limiter.hit(key);
      if (!result.allowed) retryAfterMs = Math.max(retryAfterMs, result.retryAfterMs);
    }
    if (retryAfterMs > 0) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
      return res.status(429).json({ error: "rate_limited" });
    }
    return next();
  };
}
