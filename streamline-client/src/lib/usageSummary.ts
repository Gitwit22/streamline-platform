/**
 * Normalizes GET /api/usage/me into the model the Usage tab renders.
 *
 * Monthly "streaming minutes" = time the room was actively streaming out
 * (RTMP multistream / Instagram / HLS). Overlapping outputs count once and
 * destinations are never multiplied. "Destination minutes" are analytics only.
 * Usage resets on the 1st of each month (UTC).
 */

export type UsageSummaryModel = {
  streaming: {
    used: number;
    /** included + bonus; null = unlimited */
    limit: number | null;
    included: number | null;
    bonus: number;
    unlimited: boolean;
    remaining: number | null;
    overLimit: boolean;
    overagesActive: boolean;
    overageMinutes: number;
    rtmpMinutes: number;
    hlsMinutes: number;
    destinationMinutes: number;
  };
  recordingMinutes: number;
  storage: { usedGB: number; limitGB: number | null };
  resetDate: string | null;
  lifetime: { streamingMinutes: number; recordingMinutes: number };
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseUsageSummary(data: any): UsageSummaryModel {
  const s = data?.streaming || {};
  const legacyUsage = data?.usageMonthly?.usage || {};
  const used = num(s.usedMinutes ?? legacyUsage.streamingMinutes ?? data?.participantMinutes);

  // Server sends limitMinutes=null for unlimited. Older payloads only had
  // plan.limits.participantMinutes where 0 meant unlimited.
  let limit: number | null;
  if (s && Object.prototype.hasOwnProperty.call(s, "limitMinutes")) {
    limit = numOrNull(s.limitMinutes);
  } else {
    const legacyLimit = num(data?.plan?.limits?.participantMinutes);
    limit = legacyLimit > 0 ? legacyLimit : null;
  }
  const unlimited = limit === null || limit <= 0;
  if (unlimited) limit = null;

  const byOutput = s.byOutput || {};
  const storageLimit = num(data?.storageLimitGB ?? data?.plan?.limits?.storageGB);

  return {
    streaming: {
      used,
      limit,
      included: numOrNull(s.includedMinutes),
      bonus: num(s.bonusMinutes),
      unlimited,
      remaining: unlimited ? null : Math.max(0, (limit as number) - used),
      overLimit: !unlimited && used >= (limit as number),
      overagesActive: !!s.overagesActive,
      overageMinutes: num(s.overageMinutes ?? data?.usageMonthly?.overages?.streamingMinutes),
      rtmpMinutes: num(s.rtmpOutputMinutes ?? num(byOutput.multistream) + num(byOutput.instagram)),
      hlsMinutes: num(byOutput.hls),
      destinationMinutes: num(s.destinationMinutes),
    },
    recordingMinutes: num(data?.recording?.minutes ?? legacyUsage.recordingMinutes),
    storage: { usedGB: num(data?.storageUsedGB), limitGB: storageLimit > 0 ? storageLimit : null },
    resetDate: typeof data?.resetDate === "string" ? data.resetDate : null,
    lifetime: {
      streamingMinutes: num(data?.lifetime?.streamingMinutes),
      recordingMinutes: num(data?.lifetime?.recordingMinutes),
    },
  };
}

/** "42 / 180 min", "42 min / Unlimited". */
export function formatMinutesOfLimit(used: number, limit: number | null): string {
  const u = Math.max(0, Math.round(num(used)));
  if (limit === null || !(limit > 0)) return `${u.toLocaleString("en-US")} min / Unlimited`;
  return `${u.toLocaleString("en-US")} / ${Math.round(limit).toLocaleString("en-US")} min`;
}

/** "Resets Nov 1 (UTC)" from the server's resetDate (1st of next month, 00:00 UTC). */
export function formatUsageResetDate(iso: string | null): string {
  if (!iso) return "Resets on the 1st (UTC)";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Resets on the 1st (UTC)";
  const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `Resets ${label} (UTC)`;
}

/** Percent for a usage bar; 0 when unlimited. */
export function usagePercent(used: number, limit: number | null): number {
  if (limit === null || !(limit > 0)) return 0;
  return Math.min(100, (Math.max(0, num(used)) / limit) * 100);
}
