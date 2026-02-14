export type CanonicalPlan = {
  id: string;
  name: string;
  description: string;
  visibility: "public" | "hidden" | "admin";
  priceMonthly: number;
  limits: {
    monthlyMinutes: number; // canonical minutes bucket used by usage
    monthlyMinutesIncluded: number; // alias for plan listing
    // When undefined, the plan does NOT include broadcast/transcode minutes.
    // When 0, it may mean "unlimited" for internal plans.
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
    // When true, the account is allowed to continue past included monthly
    // minutes (server will log overage totals; billing is handled elsewhere).
    allowsOverages: boolean;
    // hlsEnabled is the canonical runtime flag (can generate/play HLS)
    hlsEnabled: boolean;
    // hlsCustomizationEnabled controls whether the user can edit the HLS broadcast page
    // (title/subtitle/logo/theme/offline message).
    hlsCustomizationEnabled: boolean;
    // canHls is the canonical HLS-plan feature used by entitlements
    canHls: boolean;
    // hls mirrors canHls so callers can use either name
    hls: boolean;
  };
  caps: {
    // null/missing = unlimited
    hlsMaxMinutesPerSession: number | null;
  };
  // Raw fields that callers might still want for display/debug
  raw: any;
};

// Helper to coerce unknown values to finite numbers with a default
function toNumber(value: any, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function firstFiniteNumber(candidates: any[], fallback = 0): number {
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

// Helper to coerce booleans
function toBool(value: any): boolean {
  return value === true || value === "true" || value === 1;
}

function toNullableNumber(value: any): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Accepts a plan Firestore document and returns a canonical, defensive shape.
// Supports legacy keys such as maxHoursPerMonth, participantMinutes, maxDestinations, maxStorageBytes, etc.
export function normalizePlan(id: string, doc: any | undefined | null): CanonicalPlan {
  const data = doc || {};
  const features = (data.features || {}) as any;
  const limits = (data.limits || {}) as any;
  const caps = (data.caps || {}) as any;
  const idLower = String(id).toLowerCase();

  const rtmpEnabled = toBool(features.rtmp ?? data.rtmpEnabled);

  const rawMonthlyMinutes =
    limits.monthlyMinutesIncluded ??
    limits.participantMinutes ??
    limits.monthlyMinutes ??
    data.monthlyMinutesIncluded ??
    data.participantMinutes ??
    data.monthlyMinutes ??
    0;

  const monthlyMinutes = toNumber(rawMonthlyMinutes, 0);

  // Price input can come from either legacy `price` or canonical `priceMonthly`.
  // Important: if `priceMonthly` exists but is non-numeric (e.g. "$25"),
  // we must fall back to `price` instead of zeroing out.
  const priceMonthly = firstFiniteNumber([data.priceMonthly, data.price], 0);

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

  let rtmpDestinationsMax = toNumber(
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

  // IMPORTANT: preserve absence vs explicit value.
  // - If the plan doc does not define transcodeMinutes at all, treat as "not included" (undefined).
  // - If the plan doc defines transcodeMinutes (including 0), keep it.
  const hasTranscodeMinutesField =
    (limits && Object.prototype.hasOwnProperty.call(limits, "transcodeMinutes")) ||
    Object.prototype.hasOwnProperty.call(data, "transcodeMinutes");

  const transcodeMinutes = hasTranscodeMinutesField
    ? toNumber(limits.transcodeMinutes ?? data.transcodeMinutes, 0)
    : undefined;

  // Canonical multistream feature flag. Honor both the modern
  // `features.multistream` key and the legacy/admin
  // `features.rtmpMultistream` + top-level `multistreamEnabled`.
  const multistreamFeature = toBool(
    features.multistream ??
      (features as any).rtmpMultistream ??
      (data as any).multistreamEnabled ??
      (data as any).multistream
  );

  // Built-in defaults for known plans when the destination cap
  // has not been explicitly configured in the plan document.
  // This keeps Pro/Internal Unlimited plans from appearing to
  // have Stream Destinations disabled when only the feature
  // toggle has been enabled.
  if (rtmpDestinationsMax === 0) {
    if (idLower === "pro") {
      // Social multistream (YouTube, Facebook, Twitch)
      rtmpDestinationsMax = 3;
    } else if (idLower === "internal_unlimited") {
      // Generous default for internal testing; can be overridden
      // by explicitly setting limits.rtmpDestinationsMax or
      // limits.maxDestinations on the plan document.
      rtmpDestinationsMax = 10;
    }
  }

  // RTMP destinations are only meaningful when RTMP itself is enabled.
  // This avoids “phantom” destination counts (e.g., Basic showing 1)
  // when a leftover numeric cap exists but RTMP is turned off.
  if (!rtmpEnabled) {
    rtmpDestinationsMax = 0;
  }

  const maxHoursPerMonth = (() => {
    const explicit = limits.maxHoursPerMonth ?? data.maxHoursPerMonth;
    if (explicit !== undefined && explicit !== null) return toNumber(explicit, 0);
    // Use ceil so hour-based caps never undercut minute-based caps.
    // Example: 2000 minutes => 33h 20m, so we need 34 hours to cover all minutes.
    if (monthlyMinutes > 0) return Math.ceil(monthlyMinutes / 60);
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

  const rawFeatures = features as any;
  const rawData: any = data;

  // Overage capability flag (NOT billing): Pro allows overages by default.
  // This is separate from legacy per-user toggles.
  const allowsOverages = (() => {
    const explicit =
      rawFeatures.allowsOverages ??
      rawFeatures.overagesAllowed ??
      rawData.allowsOverages ??
      rawData.overagesAllowed;
    if (explicit !== undefined) return toBool(explicit);
    return idLower === "pro";
  })();

  // Derive canonical HLS feature flag with sensible defaults:
  // - Respect any explicit HLS flags on the plan document first.
  // - When no HLS-related keys are present, default based on plan id
  //   (Pro+/enterprise-style tiers get HLS, Free/Starter-style do not).
  const hasExplicitHlsFlag =
    rawFeatures.canHls !== undefined ||
    rawFeatures.hls !== undefined ||
    rawData.hlsEnabled !== undefined ||
    rawData.hlsBroadcastEnabled !== undefined;

  let canHls = toBool(
    rawFeatures.canHls ??
      rawFeatures.hls ??
      rawFeatures.hlsEnabled ??
      rawData.hlsEnabled ??
      rawData.hlsBroadcastEnabled
  );

  if (!hasExplicitHlsFlag) {
    // Default matrix:
    // - Free/Starter-style tiers: HLS OFF
    // - Paid/enterprise/internal tiers: HLS ON
    if (idLower === "free" || idLower === "starter") {
      canHls = false;
    } else if (
      idLower === "pro" ||
      idLower === "basic" ||
      idLower === "enterprise" ||
      idLower === "internal_unlimited"
    ) {
      canHls = true;
    }
  }

  // Page customization flag (separate from runtime HLS) so plans can offer
  // "HLS is free but customization is paid" without hacks.
  // Defaults to canHls unless explicitly set.
  const hlsCustomizationEnabled = (() => {
    const explicit =
      rawFeatures.hlsCustomizationEnabled ??
      rawFeatures.canCustomizeHlsPage ??
      rawData.hlsCustomizationEnabled ??
      rawData.canCustomizeHlsPage;
    if (explicit !== undefined) return toBool(explicit);
    return canHls;
  })();

  const hlsMaxMinutesPerSession = (() => {
    const explicit = caps.hlsMaxMinutesPerSession;
    if (explicit !== undefined) return toNullableNumber(explicit);

    // Legacy support: some older migrations stored HLS caps under plan.hls.*
    const legacy = data?.hls?.maxSessionMinutes;
    if (legacy !== undefined) return toNullableNumber(legacy);

    return null;
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
      rtmp: rtmpEnabled,
      // Multistream is enabled when either the explicit feature flag
      // is set or the numeric destination cap allows more than one
      // RTMP destination.
      multistream: rtmpEnabled && (multistreamFeature || rtmpDestinationsMax > 1),
      // Advanced permissions have been removed; plans no longer toggle
      // permissions mode. Always operate in simple mode.
      advancedPermissions: false,
      allowsOverages,
      hlsEnabled: canHls,
      hlsCustomizationEnabled,
      canHls,
      hls: canHls,
    },
    caps: {
      hlsMaxMinutesPerSession,
    },
    raw: data,
  };
}
