/**
 * Overage math. The monthly streaming gate itself lives in
 * lib/streamingMeterPure.ts (evaluateStreamingGate).
 */
function toFiniteNumber(value: any, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function computeOverage(includedMinutes: number, usedMinutes: number): number {
  const included = toFiniteNumber(includedMinutes, 0);
  const used = toFiniteNumber(usedMinutes, 0);
  if (included <= 0) return 0; // 0/unset => unlimited
  return Math.max(0, used - included);
}
