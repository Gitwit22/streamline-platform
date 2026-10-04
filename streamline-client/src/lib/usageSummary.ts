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
    /** Credit minutes in this month's allowance (consumed this month + remaining). */
    bonus: number;
    /** One-time usage credits: remaining carries over month to month. */
    credits: { remaining: number; consumedThisMonth: number };
    /** Minutes of this month covered by the plan allowance. */
    planUsed: number;
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

  // Server convention: limitMinutes null = unlimited, 0 = none included.
  // Older payloads only had plan.limits.participantMinutes where 0 meant unlimited.
  let limit: number | null;
  if (s && Object.prototype.hasOwnProperty.call(s, "limitMinutes")) {
    limit = numOrNull(s.limitMinutes);
    if (limit !== null) limit = Math.max(0, limit);
  } else {
    const legacyLimit = num(data?.plan?.limits?.participantMinutes);
    limit = legacyLimit > 0 ? legacyLimit : null;
  }
  const unlimited = limit === null;

  const byOutput = s.byOutput || {};
  // Storage: storageLimitBytes null = unlimited, 0 = none. Older payloads used
  // storageLimitGB with 0 = unlimited.
  const storageLimitGB: number | null = (() => {
    if (data && Object.prototype.hasOwnProperty.call(data, "storageLimitBytes")) {
      if (data.storageLimitBytes === null) return null;
      return Math.round((num(data.storageLimitBytes) / (1024 * 1024 * 1024)) * 100) / 100;
    }
    const legacy = num(data?.storageLimitGB ?? data?.plan?.limits?.storageGB);
    return legacy > 0 ? legacy : null;
  })();

  return {
    streaming: {
      used,
      limit,
      included: numOrNull(s.includedMinutes),
      bonus: num(s.bonusMinutes),
      credits: {
        remaining: num(s.credits?.remainingMinutes),
        consumedThisMonth: num(s.credits?.consumedThisMonth),
      },
      planUsed: (() => {
        if (s.planUsedMinutes !== undefined && s.planUsedMinutes !== null) return num(s.planUsedMinutes);
        const included = numOrNull(s.includedMinutes);
        return included === null ? used : Math.min(used, Math.max(0, included));
      })(),
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
    storage: { usedGB: num(data?.storageUsedGB), limitGB: storageLimitGB },
    resetDate: typeof data?.resetDate === "string" ? data.resetDate : null,
    lifetime: {
      streamingMinutes: num(data?.lifetime?.streamingMinutes),
      recordingMinutes: num(data?.lifetime?.recordingMinutes),
    },
  };
}

/** "42 / 180 min", "42 min / Unlimited" (null = unlimited; 0 is a real zero). */
export function formatMinutesOfLimit(used: number, limit: number | null): string {
  const u = Math.max(0, Math.round(num(used)));
  if (limit === null || !Number.isFinite(Number(limit))) return `${u.toLocaleString("en-US")} min / Unlimited`;
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

/**
 * Show the Settings overage toggle for ANY effective plan that allows
 * overages (server engine via /api/account/me), not a hard-coded plan id.
 * Reads, in order: entitlements.features.overages (canonical),
 * overagesAllowed (top-level), effectiveEntitlements.features.{overagesAllowed,allowsOverages}.
 */
export function canShowOveragesToggleFor(me: any): boolean {
  if (!me || typeof me !== "object") return false;
  const canonical = me?.entitlements?.features?.overages;
  if (typeof canonical === "boolean") return canonical;
  if (typeof me.overagesAllowed === "boolean") return me.overagesAllowed;
  const legacy = me?.effectiveEntitlements?.features || {};
  return legacy.overagesAllowed === true || legacy.allowsOverages === true;
}

/** "200 min from one-time credits this month · 300 credit min left (carries over). " ("" when no credits). */
export function formatCreditLine(credits: { remaining: number; consumedThisMonth: number } | null | undefined): string {
  const used = Math.max(0, Math.round(num(credits?.consumedThisMonth)));
  const left = Math.max(0, Math.round(num(credits?.remaining)));
  if (used === 0 && left === 0) return "";
  const parts: string[] = [];
  if (used > 0) parts.push(`${used.toLocaleString("en-US")} min from one-time credits this month`);
  if (left > 0) parts.push(`${left.toLocaleString("en-US")} credit min left (carries over)`);
  return parts.join(" · ") + ". ";
}

/** Percent for a usage bar; 0 when unlimited, 100 when the limit is 0 (none). */
export function usagePercent(used: number, limit: number | null): number {
  if (limit === null || !Number.isFinite(Number(limit))) return 0;
  if (limit <= 0) return 100;
  return Math.min(100, (Math.max(0, num(used)) / limit) * 100);
}
