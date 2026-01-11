export type CanonicalPlan = {
  id: string;
  name: string;
  description: string;
  visibility: "public" | "hidden" | "admin";
  priceMonthly: number;
  limits: {
    monthlyMinutes: number; // canonical minutes bucket used by usage
    monthlyMinutesIncluded: number; // alias for plan listing
    transcodeMinutes: number;
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
  };
  // Raw fields that callers might still want for display/debug
  raw: any;
};

// Helper to coerce unknown values to finite numbers with a default
function toNumber(value: any, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Helper to coerce booleans
function toBool(value: any): boolean {
  return value === true || value === "true" || value === 1;
}

// Accepts a plan Firestore document and returns a canonical, defensive shape.
// Supports legacy keys such as maxHoursPerMonth, participantMinutes, maxDestinations, maxStorageBytes, etc.
export function normalizePlan(id: string, doc: any | undefined | null): CanonicalPlan {
  const data = doc || {};
  const features = (data.features || {}) as any;
  const limits = (data.limits || {}) as any;

  const rawMonthlyMinutes =
    limits.monthlyMinutesIncluded ??
    limits.participantMinutes ??
    limits.monthlyMinutes ??
    data.monthlyMinutesIncluded ??
    data.participantMinutes ??
    data.monthlyMinutes ??
    0;

  const monthlyMinutes = toNumber(rawMonthlyMinutes, 0);

  const priceMonthly = toNumber(data.priceMonthly ?? data.price, 0);

  const rawVisibility: any =
    data.visibility ?? (data.hidden === true ? "hidden" : undefined);

  let visibility: "public" | "hidden" | "admin";
  if (rawVisibility === "hidden" || rawVisibility === "admin" || rawVisibility === "public") {
    visibility = rawVisibility;
  } else if (id === "enterprise" || id === "internal") {
    visibility = "admin";
  } else {
    visibility = "public";
  }

  const maxGuests = toNumber(limits.maxGuests ?? data.maxGuests, 0);

  const rtmpDestinationsMax = toNumber(
    limits.rtmpDestinationsMax ??
      limits.maxDestinations ??
      limits.rtmpDestinations ??
      data.rtmpDestinationsMax ??
      data.maxDestinations ??
      data.rtmpDestinations,
    0
  );

  const maxSessionMinutes = toNumber(limits.maxSessionMinutes ?? data.maxSessionMinutes, 0);

  // Canonical per-clip recording cap; map legacy keys once here
  const maxRecordingMinutesPerClip = toNumber(
    limits.maxRecordingMinutesPerClip ??
      limits.maxRecordingMinutesPerSession ??
      data.maxRecordingMinutesPerClip ??
      data.maxRecordingMinutesPerSession,
    0
  );

  const transcodeMinutes = toNumber(
    limits.transcodeMinutes ?? data.transcodeMinutes,
    0
  );

  const maxHoursPerMonth = (() => {
    const explicit = limits.maxHoursPerMonth ?? data.maxHoursPerMonth;
    if (explicit !== undefined && explicit !== null) return toNumber(explicit, 0);
    if (monthlyMinutes > 0) return Math.floor(monthlyMinutes / 60);
    return 0;
  })();

  const maxStorageGB = (() => {
    const fromLimitsGb = limits.maxStorageGB;
    const fromEditingGb = data.editing?.maxStorageGB;
    const fromEditingBytes = data.editing?.maxStorageBytes;
    const fromBytes = limits.maxStorageBytes ?? data.maxStorageBytes;

    if (fromLimitsGb !== undefined && fromLimitsGb !== null) return toNumber(fromLimitsGb, 0);
    if (fromEditingGb !== undefined && fromEditingGb !== null) return toNumber(fromEditingGb, 0);
    if (fromEditingBytes !== undefined && fromEditingBytes !== null)
      return Math.round(toNumber(fromEditingBytes, 0) / (1024 * 1024 * 1024));
    if (fromBytes !== undefined && fromBytes !== null)
      return Math.round(toNumber(fromBytes, 0) / (1024 * 1024 * 1024));
    return 0;
  })();

  return {
    id,
    name: String(data.name || id),
    description: String(data.description || ""),
    visibility,
    priceMonthly,
    limits: {
      monthlyMinutes,
      monthlyMinutesIncluded: monthlyMinutes,
      transcodeMinutes,
      maxGuests,
      rtmpDestinationsMax,
      maxSessionMinutes,
      maxRecordingMinutesPerClip,
      maxHoursPerMonth,
      maxStorageGB,
    },
    features: {
      recording: toBool(features.recording ?? data.recordingEnabled),
      rtmp: toBool(features.rtmp ?? data.rtmpEnabled),
      multistream: toBool(features.multistream ?? data.multistreamEnabled),
      advancedPermissions: toBool(features.advancedPermissions ?? data.advancedPermissionsEnabled),
    },
    raw: data,
  };
}
