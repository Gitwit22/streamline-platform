/**
 * Pure helpers for computing billable *live* stream minutes on the server.
 *
 * Source of truth: `egressSessions/{egressId}` docs written by
 * POST /api/multistream/:roomId/start-multistream (server clock `startedAt`)
 * and closed by stop-multistream or the LiveKit `egress_ended` webhook
 * (`endedAt`). The client-reported `minutes` value is never used for billing.
 *
 * Idempotency: once a session has been billed for live minutes it carries
 * `liveCountedAt` plus the exact interval that was billed
 * (`liveBilledStartMs` / `liveBilledEndMs`). Already-billed intervals are
 * subtracted from new ones so overlapping egresses (e.g. the separate
 * Instagram egress that runs alongside the normal one) are never billed twice.
 *
 * No Firestore / firebase imports here so this module is unit-testable.
 */

export const MINUTE_MS = 60_000;
/** Hard cap for a single session interval (sanity guard against never-ended sessions). */
export const DEFAULT_MAX_SESSION_MS = 24 * 60 * MINUTE_MS;
/** Only sessions that started within this window before `now` are considered. */
export const DEFAULT_LOOKBACK_MS = 24 * 60 * MINUTE_MS;

export type Interval = { startMs: number; endMs: number };

export type LiveSessionInput = {
  id: string;
  uid?: unknown;
  kind?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  liveCountedAt?: unknown;
  liveBilledStartMs?: unknown;
  liveBilledEndMs?: unknown;
};

export type LiveSessionToMark = {
  id: string;
  startMs: number;
  endMs: number;
  /** true when the session had no endedAt yet and was closed at `now`. */
  openEnded: boolean;
  /** true when the interval was shortened by maxSessionMs. */
  clamped: boolean;
};

export type LiveBillingPlan = {
  /** Billable minutes (ceil of wall-clock ms not already billed; 0 when nothing new). */
  minutes: number;
  billableMs: number;
  sessionsToMark: LiveSessionToMark[];
  skipped: Array<{ id: string; reason: string }>;
};

export type PlanOptions = {
  ownerUid: string;
  nowMs: number;
  maxSessionMs?: number;
  lookbackMs?: number;
  /** Sessions starting before this instant are ignored (deploy cutover guard). */
  cutoverMs?: number | null;
};

/** Convert Date | Firestore Timestamp | millis | ISO string to epoch millis. */
export function toEpochMs(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value === "string") {
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : null;
  }
  const anyVal = value as any;
  if (typeof anyVal?.toMillis === "function") {
    try {
      const t = anyVal.toMillis();
      return Number.isFinite(t) ? t : null;
    } catch {
      return null;
    }
  }
  if (typeof anyVal?.toDate === "function") {
    try {
      const t = anyVal.toDate().getTime();
      return Number.isFinite(t) ? t : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Billed minutes for a duration: 0 for no time, otherwise ceil to the next whole minute. */
export function minutesFromMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.ceil(ms / MINUTE_MS);
}

/** Merge overlapping/adjacent intervals; drops empty ones. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => Number.isFinite(i.startMs) && Number.isFinite(i.endMs) && i.endMs > i.startMs)
    .map((i) => ({ startMs: i.startMs, endMs: i.endMs }))
    .sort((a, b) => a.startMs - b.startMs);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, cur.endMs);
    } else {
      out.push(cur);
    }
  }
  return out;
}

export function totalMs(intervals: Interval[]): number {
  return mergeIntervals(intervals).reduce((sum, i) => sum + (i.endMs - i.startMs), 0);
}

/** Total length of (union(a) minus union(b)). */
export function subtractedMs(a: Interval[], b: Interval[]): number {
  const A = mergeIntervals(a);
  const B = mergeIntervals(b);
  let overlap = 0;
  for (const x of A) {
    for (const y of B) {
      const s = Math.max(x.startMs, y.startMs);
      const e = Math.min(x.endMs, y.endMs);
      if (e > s) overlap += e - s;
    }
  }
  return totalMs(A) - overlap;
}

/**
 * Decide which egress sessions to bill as live minutes and how many minutes.
 * Pure: the caller performs the reads/writes inside a Firestore transaction.
 */
export function planLiveSessionBilling(sessions: LiveSessionInput[], opts: PlanOptions): LiveBillingPlan {
  const nowMs = opts.nowMs;
  const maxSessionMs = opts.maxSessionMs ?? DEFAULT_MAX_SESSION_MS;
  const lookbackMs = opts.lookbackMs ?? DEFAULT_LOOKBACK_MS;
  const cutoverMs = opts.cutoverMs ?? null;

  const alreadyBilled: Interval[] = [];
  const sessionsToMark: LiveSessionToMark[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const s of sessions) {
    if (s.uid !== undefined && String(s.uid || "") !== opts.ownerUid) {
      skipped.push({ id: s.id, reason: "uid_mismatch" });
      continue;
    }
    const kind = String(s.kind || "multistream").toLowerCase();
    if (kind !== "multistream") {
      skipped.push({ id: s.id, reason: "not_multistream" });
      continue;
    }

    if (s.liveCountedAt) {
      const bs = toEpochMs(s.liveBilledStartMs);
      const be = toEpochMs(s.liveBilledEndMs);
      if (bs !== null && be !== null && be > bs) alreadyBilled.push({ startMs: bs, endMs: be });
      skipped.push({ id: s.id, reason: "already_counted" });
      continue;
    }

    const startMs = toEpochMs(s.startedAt);
    if (startMs === null) {
      skipped.push({ id: s.id, reason: "no_start" });
      continue;
    }
    if (startMs > nowMs) {
      skipped.push({ id: s.id, reason: "start_in_future" });
      continue;
    }
    if (nowMs - startMs > lookbackMs) {
      skipped.push({ id: s.id, reason: "outside_lookback" });
      continue;
    }
    if (cutoverMs !== null && startMs < cutoverMs) {
      skipped.push({ id: s.id, reason: "before_cutover" });
      continue;
    }

    const endedMs = toEpochMs(s.endedAt);
    const openEnded = endedMs === null;
    let endMs = Math.min(openEnded ? nowMs : endedMs, nowMs);
    let clamped = false;
    if (endMs - startMs > maxSessionMs) {
      endMs = startMs + maxSessionMs;
      clamped = true;
    }
    if (endMs < startMs) endMs = startMs;

    sessionsToMark.push({ id: s.id, startMs, endMs, openEnded, clamped });
  }

  const billableMs = Math.max(
    0,
    subtractedMs(
      sessionsToMark.map((s) => ({ startMs: s.startMs, endMs: s.endMs })),
      alreadyBilled
    )
  );

  return { minutes: minutesFromMs(billableMs), billableMs, sessionsToMark, skipped };
}

/** True when the client-reported minutes differ "a lot" from the server value (for logging only). */
export function isLargeMinutesDiscrepancy(clientMinutes: unknown, serverMinutes: number): boolean {
  const c = Number(clientMinutes);
  if (!Number.isFinite(c) || c <= 0) return false;
  const diff = Math.abs(c - serverMinutes);
  return diff > Math.max(5, serverMinutes * 0.2);
}
