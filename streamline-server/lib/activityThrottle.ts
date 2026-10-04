/**
 * Pure throttle for "last active" writes (no I/O).
 *
 * requireAuth / requireAdmin call touchUserActivity() on every authenticated
 * request; this decides whether a Firestore write is due. At most one write
 * per uid per interval (default 10 minutes) per server instance. The map is
 * bounded: when it grows past maxEntries the oldest entries are evicted, so a
 * flood of distinct uids cannot grow memory without limit.
 */

export const ACTIVITY_WRITE_INTERVAL_MS = 10 * 60 * 1000;
export const ACTIVITY_THROTTLE_MAX_ENTRIES = 50_000;

export type ActivityThrottle = {
  /** True when a write is due for uid at nowMs (and records it). */
  shouldWrite(uid: string, nowMs: number): boolean;
  /** Forget a uid (e.g. after a failed write so the next request retries). */
  forget(uid: string): void;
  size(): number;
};

export function createActivityThrottle(
  opts: { intervalMs?: number; maxEntries?: number } = {}
): ActivityThrottle {
  const intervalMs = Math.max(1, Number(opts.intervalMs ?? ACTIVITY_WRITE_INTERVAL_MS));
  const maxEntries = Math.max(1, Math.floor(Number(opts.maxEntries ?? ACTIVITY_THROTTLE_MAX_ENTRIES)));
  const last = new Map<string, number>();

  return {
    shouldWrite(uid: string, nowMs: number): boolean {
      const key = String(uid || "").trim();
      if (!key) return false;
      const prev = last.get(key);
      if (prev !== undefined && nowMs - prev < intervalMs && nowMs >= prev) return false;
      // Re-insert so Map iteration order tracks recency (oldest first).
      last.delete(key);
      last.set(key, nowMs);
      while (last.size > maxEntries) {
        const oldest = last.keys().next().value as string;
        last.delete(oldest);
      }
      return true;
    },
    forget(uid: string) {
      last.delete(String(uid || "").trim());
    },
    size() {
      return last.size;
    },
  };
}

/**
 * Fields to merge into users/{uid} on an activity touch: lastActiveAt (epoch
 * ms) and, when missing or stale, emailLower (lazy backfill for admin search).
 */
export function buildActivityPatch(userDoc: any, nowMs: number): Record<string, any> {
  const patch: Record<string, any> = { lastActiveAt: nowMs };
  const email = typeof userDoc?.email === "string" ? userDoc.email.trim() : "";
  if (email) {
    const lower = email.toLowerCase();
    if (userDoc?.emailLower !== lower) patch.emailLower = lower;
  }
  return patch;
}
