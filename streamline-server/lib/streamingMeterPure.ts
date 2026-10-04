/**
 * Pure (Firestore-free) math for the server-owned streaming meter.
 *
 * PRODUCT RULE (owner decision):
 *   Monthly minutes = time a room is actively streaming OUT (RTMP multistream,
 *   Instagram RTMP, HLS). A room that is merely open is not metered. Outputs
 *   that overlap in time count once: a 60-minute show sent to YouTube +
 *   Facebook + Twitch + Streamline HLS is 60 streaming minutes, not 240.
 *   `destinationMinutes` (duration x destination count, summed over outputs)
 *   is tracked for cost analytics only and is never gated.
 *
 * MODEL:
 *   - Every output (LiveKit egress) is an interval doc `egressSessions/{egressId}`
 *     with startedAt, optional endedAt and `billedUntilMs` (how far it has been
 *     billed so far).
 *   - Every room has a meter doc `streamingMeters/{roomId}` holding the union of
 *     all time already billed for that room (`covered`) plus cumulative
 *     `coveredMs` / `billedMinutes`.
 *   - Billing a segment [billedUntil, until] of an interval adds only the part
 *     NOT already covered by the room union (overlapping outputs count once).
 *   - Minutes are rounded once per room on the cumulative total
 *     (ceil(coveredMs / 60s) - billedMinutes), so incremental billing (sweeps,
 *     many short streams) never inflates the total by rounding.
 */

export const MINUTE_MS = 60_000;
/** Hard cap on how long one output interval may bill (never-ended egress guard). */
export const MAX_INTERVAL_MS = 24 * 60 * MINUTE_MS;
/** Covered intervals that ended before (now - this) are pruned from the room meter. */
export const COVERED_RETENTION_MS = 72 * 60 * MINUTE_MS;
/** Hard cap on the number of covered intervals kept on a room meter doc. */
export const MAX_COVERED_INTERVALS = 200;
/** Default grace before a mid-session monthly-limit stop. */
export const DEFAULT_LIMIT_GRACE_MINUTES = 2;

export type Interval = { startMs: number; endMs: number };

export type OutputKind = "multistream" | "instagram" | "hls";

/**
 * Epoch number in ms, µs or ns (LiveKit uses ns) -> ms. Values are told apart
 * by magnitude (ms epoch is ~1.7e12 today).
 */
function normalizeEpochNumber(n: number): number | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1e17) return Math.floor(n / 1e6);
  if (n >= 1e14) return Math.floor(n / 1e3);
  return n;
}

/** Convert Date | Firestore Timestamp | millis | ISO string to epoch millis. */
export function toEpochMs(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === "number") return normalizeEpochNumber(value);
  if (typeof value === "bigint") {
    // LiveKit EgressInfo timestamps are int64 nanoseconds.
    return normalizeEpochNumber(Number(value / BigInt(1_000)) * 1_000);
  }
  if (typeof value === "string") {
    if (/^\d+$/.test(value.trim())) return normalizeEpochNumber(Number(value.trim()));
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
    .filter((i) => i && Number.isFinite(i.startMs) && Number.isFinite(i.endMs) && i.endMs > i.startMs)
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

/** Sanitize a stored covered array (Firestore data) into intervals. */
export function readCovered(raw: unknown): Interval[] {
  if (!Array.isArray(raw)) return [];
  return mergeIntervals(
    raw
      .map((r: any) => ({ startMs: Number(r?.startMs ?? r?.s), endMs: Number(r?.endMs ?? r?.e) }))
      .filter((i) => Number.isFinite(i.startMs) && Number.isFinite(i.endMs))
  );
}

export function pruneCovered(covered: Interval[], nowMs: number): Interval[] {
  const minEnd = nowMs - COVERED_RETENTION_MS;
  const kept = mergeIntervals(covered).filter((i) => i.endMs >= minEnd);
  return kept.length > MAX_COVERED_INTERVALS ? kept.slice(kept.length - MAX_COVERED_INTERVALS) : kept;
}

export function normalizeOutputKind(kind: unknown, group?: unknown): OutputKind {
  const k = String(kind || "").toLowerCase();
  if (k === "hls") return "hls";
  if (k === "instagram" || String(group || "").toLowerCase() === "instagram") return "instagram";
  return "multistream";
}

// ---------------------------------------------------------------------------
// Segment billing plan
// ---------------------------------------------------------------------------

export type OutputIntervalState = {
  startMs: number | null;
  /** Known end (egress ended / stopped). null while the output is still running. */
  endMs: number | null;
  /** How far this interval was billed already (null = never). */
  billedUntilMs: number | null;
  /** Number of destinations this output feeds (>= 1). */
  destinations: number;
  /** Cumulative own-duration minutes already billed for this interval. */
  ownMinutesBilled: number;
  /** Cumulative destination-minutes already billed for this interval. */
  destinationMinutesBilled: number;
};

export type RoomMeterState = {
  covered: Interval[];
  coveredMs: number;
  billedMinutes: number;
};

export type SegmentPlanOptions = {
  /** Bill up to this instant (end of the egress, or now for a running output). */
  untilMs: number;
  nowMs: number;
  /** Time before this instant is never billed by the meter (deploy cutover). */
  cutoverMs?: number | null;
  maxIntervalMs?: number;
};

export type SegmentPlan = {
  /** The new segment of the interval being billed (null when nothing new). */
  segment: Interval | null;
  /** New billedUntilMs for the interval. */
  billedUntilMs: number | null;
  /** Wall-clock ms newly added to the room union. */
  newCoveredMs: number;
  /** Monthly streaming minutes to add for the owner. */
  streamingMinutesDelta: number;
  /** Own-duration minutes to add (per output type breakdown). */
  ownMinutesDelta: number;
  /** destination-minutes to add (analytics only). */
  destinationMinutesDelta: number;
  nextRoom: RoomMeterState;
  nextOwnMinutesBilled: number;
  nextDestinationMinutesBilled: number;
  /** true when the interval hit maxIntervalMs. */
  clamped: boolean;
  skippedReason?: "no_start" | "before_cutover" | "nothing_new";
};

function finiteOr(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/**
 * Plan billing the not-yet-billed part of one output interval against the
 * room's already-covered union. Pure: the caller performs reads/writes in a
 * Firestore transaction.
 */
export function planSegmentBilling(
  interval: OutputIntervalState,
  room: RoomMeterState,
  opts: SegmentPlanOptions
): SegmentPlan {
  const maxIntervalMs = opts.maxIntervalMs ?? MAX_INTERVAL_MS;
  const roomIn: RoomMeterState = {
    covered: mergeIntervals(room.covered || []),
    coveredMs: Math.max(0, finiteOr(room.coveredMs, 0)),
    billedMinutes: Math.max(0, finiteOr(room.billedMinutes, 0)),
  };
  const ownBilled = Math.max(0, finiteOr(interval.ownMinutesBilled, 0));
  const destBilled = Math.max(0, finiteOr(interval.destinationMinutesBilled, 0));
  const noop = (reason: SegmentPlan["skippedReason"], billedUntilMs: number | null): SegmentPlan => ({
    segment: null,
    billedUntilMs,
    newCoveredMs: 0,
    streamingMinutesDelta: 0,
    ownMinutesDelta: 0,
    destinationMinutesDelta: 0,
    nextRoom: roomIn,
    nextOwnMinutesBilled: ownBilled,
    nextDestinationMinutesBilled: destBilled,
    clamped: false,
    skippedReason: reason,
  });

  const startMs = interval.startMs;
  if (startMs === null || !Number.isFinite(startMs)) return noop("no_start", interval.billedUntilMs);

  const cutoverMs = opts.cutoverMs ?? null;
  const effectiveStart = cutoverMs !== null ? Math.max(startMs, cutoverMs) : startMs;

  const hardEnd = startMs + maxIntervalMs;
  let until = Math.min(opts.untilMs, opts.nowMs);
  if (interval.endMs !== null && Number.isFinite(interval.endMs)) until = Math.min(until, interval.endMs);
  const clamped = until > hardEnd;
  until = Math.min(until, hardEnd);

  if (until <= effectiveStart) {
    return noop(cutoverMs !== null && until <= cutoverMs ? "before_cutover" : "nothing_new", interval.billedUntilMs);
  }

  const prevBilledUntil = interval.billedUntilMs;
  const segStart =
    prevBilledUntil !== null && Number.isFinite(prevBilledUntil)
      ? Math.max(effectiveStart, prevBilledUntil)
      : effectiveStart;
  if (until <= segStart) return noop("nothing_new", prevBilledUntil);

  const segment: Interval = { startMs: segStart, endMs: until };
  const newCoveredMs = Math.max(0, subtractedMs([segment], roomIn.covered));

  const nextCoveredMs = roomIn.coveredMs + newCoveredMs;
  const targetRoomMinutes = minutesFromMs(nextCoveredMs);
  const streamingMinutesDelta = Math.max(0, targetRoomMinutes - roomIn.billedMinutes);

  const ownMs = until - effectiveStart;
  const destinations = Math.max(1, Math.floor(finiteOr(interval.destinations, 1)));
  const ownTarget = minutesFromMs(ownMs);
  const destTarget = minutesFromMs(ownMs * destinations);
  const ownMinutesDelta = Math.max(0, ownTarget - ownBilled);
  const destinationMinutesDelta = Math.max(0, destTarget - destBilled);

  return {
    segment,
    billedUntilMs: until,
    newCoveredMs,
    streamingMinutesDelta,
    ownMinutesDelta,
    destinationMinutesDelta,
    nextRoom: {
      covered: pruneCovered([...roomIn.covered, segment], Math.min(opts.nowMs, segStart)),
      coveredMs: nextCoveredMs,
      billedMinutes: roomIn.billedMinutes + streamingMinutesDelta,
    },
    nextOwnMinutesBilled: ownBilled + ownMinutesDelta,
    nextDestinationMinutesBilled: destBilled + destinationMinutesDelta,
    clamped,
  };
}

/**
 * Old-model egress sessions (written before the meter shipped) that were
 * already billed by stop-multistream / egress_ended (`countedAt`) or by the
 * client streamEnded call (`liveCountedAt`) must not be billed again.
 */
export function isLegacyBilledSession(doc: any): boolean {
  if (!doc) return false;
  if (Number(doc.meterVersion) >= 2) return false;
  return !!(doc.countedAt || doc.liveCountedAt);
}

// ---------------------------------------------------------------------------
// Monthly usage reading + gate
// ---------------------------------------------------------------------------

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Streaming minutes used this month from a usageMonthly doc. Docs written
 * before the meter (no `usage.streamingMinutes`) fall back to the old model's
 * closest equivalent: live (multistream union) minutes + HLS minutes.
 */
export function readStreamingMinutes(usageDoc: any): number {
  const usage = (usageDoc && usageDoc.usage) || {};
  if (typeof usage.streamingMinutes === "number" && Number.isFinite(usage.streamingMinutes)) {
    return Math.max(0, usage.streamingMinutes);
  }
  return legacyStreamingSeed(usageDoc);
}

/** Old-model value used to seed `usage.streamingMinutes` the first time the meter writes a month doc. */
export function legacyStreamingSeed(usageDoc: any): number {
  const usage = (usageDoc && usageDoc.usage) || {};
  const live = num(usage.minutes?.live?.currentPeriod);
  const hls = num(usage.hlsMinutes);
  return Math.max(0, Math.round(live + hls));
}

export type StreamingGateInput = {
  usedMinutes: number;
  /** Plan monthly included minutes (limits.monthlyMinutes). <= 0 means unlimited. */
  includedMinutes: number;
  /** users.bonusMinutes, added on top of the plan allowance every month. */
  bonusMinutes?: number;
  planAllowsOverages: boolean;
  /** billingSettings.overagesEnabled (user opt-in). */
  overagesEnabled: boolean;
};

export type StreamingGateDecision = {
  allowed: boolean;
  unlimited: boolean;
  /** included + bonus; null when unlimited. */
  limitMinutes: number | null;
  usedMinutes: number;
  remainingMinutes: number | null;
  overLimit: boolean;
  /** Overage applies (plan allows AND user opted in). */
  overagesActive: boolean;
  /** Minutes beyond the limit (0 when unlimited / not over). */
  overageMinutes: number;
  reason?: "usage_exhausted";
  requiresUpgrade?: boolean;
  requiresOveragesEnabled?: boolean;
};

export function evaluateStreamingGate(input: StreamingGateInput): StreamingGateDecision {
  const used = Math.max(0, num(input.usedMinutes));
  const included = num(input.includedMinutes);
  const bonus = Math.max(0, num(input.bonusMinutes));
  const overagesActive = !!input.planAllowsOverages && !!input.overagesEnabled;

  if (included <= 0) {
    return {
      allowed: true,
      unlimited: true,
      limitMinutes: null,
      usedMinutes: used,
      remainingMinutes: null,
      overLimit: false,
      overagesActive,
      overageMinutes: 0,
    };
  }

  const limit = included + bonus;
  const overLimit = used >= limit;
  const base: StreamingGateDecision = {
    allowed: true,
    unlimited: false,
    limitMinutes: limit,
    usedMinutes: used,
    remainingMinutes: Math.max(0, limit - used),
    overLimit,
    overagesActive,
    overageMinutes: Math.max(0, used - limit),
  };
  if (!overLimit || overagesActive) return base;

  return {
    ...base,
    allowed: false,
    reason: "usage_exhausted",
    requiresUpgrade: !input.planAllowsOverages,
    requiresOveragesEnabled: !!input.planAllowsOverages && !input.overagesEnabled,
  };
}

/** Billable overage minutes to persist for the month (only when overage billing is active). */
export function billableOverageMinutes(decision: StreamingGateDecision): number {
  return decision.overagesActive ? decision.overageMinutes : 0;
}

/** Mid-session: stop running outputs once the owner is past limit + grace without overage opt-in. */
export function shouldStopForMonthlyLimit(
  decision: StreamingGateDecision,
  graceMinutes: number = DEFAULT_LIMIT_GRACE_MINUTES
): boolean {
  if (decision.unlimited || decision.overagesActive || decision.limitMinutes === null) return false;
  return decision.usedMinutes >= decision.limitMinutes + Math.max(0, num(graceMinutes));
}

/** Mid-session: plan limits.maxSessionMinutes (0/unset = no cap), measured from the room's earliest open output. */
export function shouldStopForSessionCap(params: {
  sessionStartMs: number | null;
  nowMs: number;
  maxSessionMinutes: number;
  graceMinutes?: number;
}): boolean {
  const max = num(params.maxSessionMinutes);
  if (max <= 0 || params.sessionStartMs === null || !Number.isFinite(params.sessionStartMs)) return false;
  const grace = Math.max(0, num(params.graceMinutes ?? DEFAULT_LIMIT_GRACE_MINUTES));
  return params.nowMs - params.sessionStartMs >= (max + grace) * MINUTE_MS;
}

// ---------------------------------------------------------------------------
// Month window
// ---------------------------------------------------------------------------

/** Usage month key (UTC calendar month, "YYYY-MM"). Usage resets on the 1st, 00:00 UTC. */
export function monthKeyUTC(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** First instant of the next UTC calendar month (the next usage reset). */
export function nextMonthlyResetUTC(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

/** Optional deploy cutover for the meter (ISO string). Invalid/empty => null. */
export function parseCutoverIso(raw: unknown): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Recording interval [startedAt, endedAt] in whole minutes (ceil; 0 when no time). */
export function recordingBilledMinutes(startedAt: unknown, endedAt: unknown): { minutes: number; durationMs: number } {
  const s = toEpochMs(startedAt);
  const e = toEpochMs(endedAt);
  if (s === null || e === null || e <= s) return { minutes: 0, durationMs: 0 };
  return { minutes: minutesFromMs(e - s), durationMs: e - s };
}
