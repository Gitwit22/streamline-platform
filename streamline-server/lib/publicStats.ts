/**
 * Streamed minutes in one usageMonthly doc's `usage` map, for the public
 * landing-page stats. `usage.minutes` is an object in the current schema
 * ({ live: { currentPeriod }, recording: ..., ... }), so it must never be fed
 * to Number() directly: one NaN turned the whole total (and hoursStreamed in
 * the JSON response) into null. Non-numeric or negative values count as 0.
 */
export function streamedMinutesFromUsage(usage: any): number {
  if (!usage || typeof usage !== "object") return 0;
  const candidates = [usage.participantMinutes, usage.minutes?.live?.currentPeriod, usage.streamMinutes, usage.minutes];
  for (const c of candidates) {
    if (c === undefined || c === null || typeof c === "object") continue;
    const n = Number(c);
    if (Number.isFinite(n)) return Math.max(0, n);
  }
  return 0;
}
