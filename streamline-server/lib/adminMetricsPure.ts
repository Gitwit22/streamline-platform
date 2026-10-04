/**
 * Pure helpers for admin metrics (no I/O). Firestore access lives in
 * lib/adminMetrics.ts.
 */
import { readStreamingMinutes } from "./streamingMeterPure";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Activity windows used by GET /api/admin/stats (UTC, like usage month keys). */
export function activityWindows(nowMs: number): { dayStartMs: number; weekStartMs: number; monthStartMs: number } {
  const d = new Date(nowMs);
  const dayStartMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const monthStartMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  return { dayStartMs, weekStartMs: nowMs - 7 * DAY_MS, monthStartMs };
}

/** "YYYY-MM" (UTC) keys covering [startMs, endMs], capped at `max` (newest kept). */
export function monthKeysBetween(startMs: number, endMs: number, max = 36): string[] {
  const lo = Math.min(startMs, endMs);
  const hi = Math.max(startMs, endMs);
  const start = new Date(lo);
  const end = new Date(hi);
  const endIdx = end.getUTCFullYear() * 12 + end.getUTCMonth();
  const startIdx = Math.max(start.getUTCFullYear() * 12 + start.getUTCMonth(), endIdx - Math.max(1, max) + 1);
  const keys: string[] = [];
  for (let idx = startIdx; idx <= endIdx; idx++) {
    const y = Math.floor(idx / 12);
    const m = idx % 12;
    keys.push(`${y}-${String(m + 1).padStart(2, "0")}`);
  }
  return keys;
}

/**
 * Users by BASE plan (users.planId). Users without a planId (or with an id no
 * plan doc knows) are counted as "free", the plan they resolve to.
 */
export function buildUsersByPlan(input: {
  planIds: string[];
  counts: Record<string, number>;
  totalUsers: number;
}): Record<string, number> {
  const out: Record<string, number> = {};
  let counted = 0;
  for (const id of input.planIds) {
    const n = Math.max(0, Math.floor(Number(input.counts[id]) || 0));
    out[id] = n;
    if (id !== "free") counted += n;
  }
  out.free = Math.max(Number(out.free) || 0, Math.max(0, Math.floor(input.totalUsers) - counted));
  return out;
}

/** Sum of streaming minutes over usageMonthly docs (fallback when aggregate sum() fails). */
export function sumStreamingMinutes(docs: any[]): number {
  let total = 0;
  for (const d of docs) total += readStreamingMinutes(d);
  return Math.round(total * 100) / 100;
}

export type UserListQuery = {
  limit: number;
  /** Doc id of the last row of the previous page. */
  cursor: string | null;
  /** Lower-cased email prefix. */
  search: string;
  plan: string | null;
  includeDeleted: boolean;
};

function truthy(v: unknown): boolean {
  const raw = String(v ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function normalizeUserListQuery(q: any, defaults: { limit?: number; maxLimit?: number } = {}): UserListQuery {
  const maxLimit = defaults.maxLimit ?? 200;
  const parsed = parseInt(String(q?.limit ?? ""), 10);
  const limit = Math.min(Math.max(Number.isFinite(parsed) && parsed > 0 ? parsed : defaults.limit ?? 50, 1), maxLimit);
  const cursorRaw = typeof q?.cursor === "string" ? q.cursor.trim() : "";
  const cursor = /^[A-Za-z0-9_-]{1,128}$/.test(cursorRaw) ? cursorRaw : null;
  const search = typeof q?.search === "string" ? q.search.trim().toLowerCase().slice(0, 100) : "";
  const planRaw = typeof q?.plan === "string" ? q.plan.trim() : "";
  const plan = planRaw && planRaw !== "all" && /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(planRaw) ? planRaw : null;
  return { limit, cursor, search, plan, includeDeleted: truthy(q?.includeDeleted) };
}

/** Firestore range for an email prefix: field >= start && field < end. */
export function emailPrefixRange(prefix: string): { start: string; end: string } {
  const start = String(prefix || "").trim().toLowerCase();
  return { start, end: `${start}` };
}

/** Sum of partial counts; null when every part failed. */
export function sumCountParts(parts: Array<number | null | undefined>): number | null {
  let any = false;
  let total = 0;
  for (const p of parts) {
    if (typeof p === "number" && Number.isFinite(p)) {
      any = true;
      total += p;
    }
  }
  return any ? total : null;
}

function readPath(obj: any, path: string): any {
  return path.split(".").reduce((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), obj);
}

/** Support Hub program scoping: does a doc carry this program id? (null = no scoping) */
export function matchesProgramContext(data: any, activeProgramId: string | null): boolean {
  if (!activeProgramId) return true;
  const candidates = ["programId", "activeProgramId", "program.id", "programContext.programId", "meta.programId"]
    .map((p) => readPath(data, p))
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
  return candidates.includes(activeProgramId);
}

/** Promise with a deadline; rejects with Error("timeout") after ms. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
    (timer as any)?.unref?.();
  });
  return Promise.race([p, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

/**
 * Tiny TTL cache with in-flight de-duplication (concurrent admins share one
 * Firestore round trip). Failed loads are not cached.
 */
export function createTtlCache<T>(ttlMs: number, maxEntries = 100) {
  const entries = new Map<string, { at: number; value: T }>();
  const inflight = new Map<string, Promise<T>>();
  return {
    peek(key: string, nowMs: number = Date.now()): T | undefined {
      const e = entries.get(key);
      return e && nowMs - e.at < ttlMs ? e.value : undefined;
    },
    async get(key: string, load: () => Promise<T>, nowMs: number = Date.now()): Promise<T> {
      const hit = this.peek(key, nowMs);
      if (hit !== undefined) return hit;
      const pending = inflight.get(key);
      if (pending) return pending;
      const p = load()
        .then((value) => {
          entries.set(key, { at: Date.now(), value });
          while (entries.size > maxEntries) entries.delete(entries.keys().next().value as string);
          return value;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    },
    clear() {
      entries.clear();
    },
  };
}
