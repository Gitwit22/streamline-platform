/**
 * DEPRECATED legacy plan shape, kept as a thin wrapper over the entitlement
 * engine's normalizer (lib/entitlements/normalizePlanV2.ts) for older callers.
 *
 * LEGACY ENCODING: in this shape a numeric limit of 0 means "no cap" (the
 * historic meaning). New code must use `normalizePlanDoc()` / the
 * EffectiveEntitlements `limits`, where null = unlimited and 0 = none.
 */
import { normalizePlanDoc } from "./entitlements/normalizePlanV2";
import type { Limit, NormalizedPlan } from "./entitlements/types";

export type CanonicalPlan = {
  id: string;
  name: string;
  description: string;
  visibility: "public" | "hidden" | "admin";
  priceMonthly: number;
  limits: {
    monthlyMinutes: number;
    monthlyMinutesIncluded: number;
    transcodeMinutes?: number;
    maxGuests: number;
    rtmpDestinationsMax: number;
    maxSessionMinutes: number;
    maxRecordingMinutesPerClip: number;
    maxHoursPerMonth: number;
    maxStorageGB: number;
  };
  features: {
    recording: boolean;
    rtmp: boolean;
    multistream: boolean;
    advancedPermissions: boolean;
    allowsOverages: boolean;
    hlsEnabled: boolean;
    hlsCustomizationEnabled: boolean;
    canHls: boolean;
    hls: boolean;
    monetization: boolean;
    payPerView: boolean;
    invisibleHost: boolean;
  };
  caps: {
    hlsMaxMinutesPerSession: number | null;
  };
  raw: any;
  /** v2 view (null = unlimited, 0 = none). */
  v2: NormalizedPlan;
};

/** v2 limit -> legacy number (null/unlimited -> 0). */
function legacyNumber(limit: Limit): number {
  return limit === null ? 0 : limit;
}

export function toLegacyCanonicalPlan(plan: NormalizedPlan): CanonicalPlan {
  const data = plan.raw || {};
  const l = plan.limits;
  const monthlyMinutes = legacyNumber(l.monthlyStreamingMinutes);

  const explicitHours = data.limits?.maxHoursPerMonth ?? data.maxHoursPerMonth;
  const explicitHoursNum = Number(explicitHours);
  const maxHoursPerMonth =
    explicitHours !== undefined && explicitHours !== null && Number.isFinite(explicitHoursNum)
      ? explicitHoursNum
      : monthlyMinutes > 0
        ? Math.ceil(monthlyMinutes / 60)
        : 0;

  const transcodeRaw = data.limits?.transcodeMinutes ?? data.transcodeMinutes;
  const hasTranscode =
    (data.limits && Object.prototype.hasOwnProperty.call(data.limits, "transcodeMinutes")) ||
    Object.prototype.hasOwnProperty.call(data, "transcodeMinutes");
  const transcodeNum = Number(transcodeRaw);

  const storageBytes = legacyNumber(l.storageBytes);

  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    visibility: plan.visibility,
    priceMonthly: plan.priceMonthly,
    limits: {
      monthlyMinutes,
      monthlyMinutesIncluded: monthlyMinutes,
      transcodeMinutes: hasTranscode ? (Number.isFinite(transcodeNum) ? transcodeNum : 0) : undefined,
      maxGuests: legacyNumber(l.guests),
      rtmpDestinationsMax: legacyNumber(l.destinations),
      maxSessionMinutes: legacyNumber(l.maxSessionMinutes),
      maxRecordingMinutesPerClip: legacyNumber(l.recordingMinutesPerClip),
      maxHoursPerMonth,
      maxStorageGB: Math.round(storageBytes / (1024 * 1024 * 1024)),
    },
    features: {
      recording: plan.features.recording,
      rtmp: plan.features.multistream,
      multistream: plan.features.multistream,
      advancedPermissions: false,
      allowsOverages: plan.features.overages,
      hlsEnabled: plan.features.hls,
      hlsCustomizationEnabled: plan.features.hlsCustomization,
      canHls: plan.features.hls,
      hls: plan.features.hls,
      monetization: plan.features.monetization,
      payPerView: plan.features.payPerView,
      invisibleHost: plan.features.invisibleHost,
    },
    caps: {
      hlsMaxMinutesPerSession: l.hlsMaxMinutesPerSession,
    },
    raw: data,
    v2: plan,
  };
}

/** @deprecated use normalizePlanDoc() from lib/entitlements. */
export function normalizePlan(id: string, doc: any | undefined | null): CanonicalPlan {
  return toLegacyCanonicalPlan(normalizePlanDoc(id, doc));
}
