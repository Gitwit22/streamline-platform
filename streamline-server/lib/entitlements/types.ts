/**
 * Entitlement engine types + limit helpers (pure, no I/O).
 *
 * LIMIT CONVENTION (owner rule, "never again 0 = unlimited"):
 *   null    => UNLIMITED (no cap)
 *   0       => ZERO (this plan gets none of this resource)
 *   n > 0   => hard cap of n
 *
 * Stored plan documents carry `limitsVersion: 2` when they follow this
 * convention. Older documents (no limitsVersion) are read with their legacy
 * meaning by normalizePlanV2.ts, so deploys do not change behavior.
 */

/** A numeric limit: null = unlimited, 0 = none, n = cap. */
export type Limit = number | null;

export const FEATURE_KEYS = [
  "multistream",
  "recording",
  "dualRecording",
  "hls",
  "hlsCustomization",
  "editing",
  "projects",
  "contentLibrary",
  "monetization",
  "payPerView",
  "invisibleHost",
  "overages",
  "watermark",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type EntitlementFeatures = Record<FeatureKey, boolean>;

export const LIMIT_KEYS = [
  "monthlyStreamingMinutes",
  "destinations",
  "guests",
  "storageBytes",
  "recordingMinutesPerClip",
  "maxSessionMinutes",
  "projects",
  "hlsMaxMinutesPerSession",
] as const;

export type LimitKey = (typeof LIMIT_KEYS)[number];

export type EntitlementLimits = Record<LimitKey, Limit> & {
  /**
   * Highest media preset (quality ceiling) the plan may use. Always resolved
   * to a concrete preset id (plan doc value, else the built-in plan table).
   */
  maxPresetId: string;
};

/** Plan document after normalization (v2 semantics regardless of stored version). */
export type NormalizedPlan = {
  id: string;
  name: string;
  description: string;
  visibility: "public" | "hidden" | "admin";
  priceMonthly: number;
  /** Version of the STORED document (1 = legacy, 2 = null-unlimited). */
  limitsVersion: 1 | 2;
  features: EntitlementFeatures;
  limits: EntitlementLimits;
  /** Raw stored document (server-side only; never sent to clients). */
  raw: any;
};

/** users/{uid}.planOverride */
export type PlanOverride = {
  planId: string;
  reason: string;
  createdBy: string;
  /** epoch ms */
  startsAt: number;
  /** epoch ms; null/undefined = no expiry */
  expiresAt?: number | null;
  createdAt?: number;
};

export type OverrideSource = PlanOverride & {
  /** true when read from legacy adminOverridePlanId / adminOverride fields. */
  legacy?: boolean;
  legacyField?: "adminOverridePlanId" | "adminOverride";
};

export type SubscriptionSource = {
  status: string;
  subscriptionId: string | null;
  /** Billing problem that prevents the paid base plan from applying. */
  blocked: boolean;
  blockedReason: string | null;
  /** Platform/user billing switch (test mode = false => never blocked). */
  billingEnforced: boolean;
};

export type EntitlementSource = {
  /** Plan stored on the user (Stripe/billing truth, or admin "set base plan"). */
  basePlan: string;
  subscription: SubscriptionSource;
  /** Active admin override, if any (expired overrides are ignored). */
  adminOverride: OverrideSource | null;
  /** Platform admin (users.isAdmin / admins/{uid}) => internal_unlimited. */
  internalAdmin: boolean;
  /** Which input decided the effective plan. */
  decidedBy: "base" | "override" | "internal_admin" | "billing_block";
  /** Per-feature grants on top of the plan (legacy adminOverrideHls => ["hls"]). */
  grants: FeatureKey[];
};

/** Resolved platform flags (kill switches + opt-in switches). */
export type PlatformFlags = {
  recording: boolean;
  hlsSettingsTab: boolean;
  contentLibraryEnabled: boolean;
  projectsEnabled: boolean;
  editorEnabled: boolean;
  myContentEnabled: boolean;
  myContentRecordingsEnabled: boolean;
  audioMixerEnabled: boolean;
  advancedScreenShareEnabled: boolean;
  monetizationEnabled: boolean;
  payPerViewEnabled: boolean;
  invisibleHostEnabled: boolean;
  collaboratorDelegationEnabled: boolean;
  /** PLATFORM_TRANSCODE_ENABLED env (default true). */
  transcodeEnabled: boolean;
};

export type EffectiveEntitlements = {
  /** Effective plan id (what every feature must read). */
  planId: string;
  planName: string;
  /** Plan features AND platform switches: what the user can actually use. */
  features: EntitlementFeatures;
  /** Plan-only features (before platform switches), for "disabled platform-wide" UX. */
  planFeatures: EntitlementFeatures;
  /** null = unlimited, 0 = none. */
  limits: EntitlementLimits;
  source: EntitlementSource;
  platformFlags: PlatformFlags;
  /** epoch ms the entitlements were computed. */
  computedAt: number;
};

/** Server-side resolution result (adds the raw effective plan doc). */
export type ResolvedEntitlements = EffectiveEntitlements & {
  plan: NormalizedPlan;
};

// ---------------------------------------------------------------------------
// Limit helpers
// ---------------------------------------------------------------------------

export function isUnlimited(limit: Limit | undefined): limit is null {
  return limit === null;
}

/** Coerce anything to a v2 Limit (null stays null; invalid => 0). */
export function toLimit(value: unknown): Limit {
  if (value === null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/**
 * True when `used` is still within the limit (used <= limit).
 * Use for "is the account currently over its cap?" checks.
 */
export function isWithinLimit(used: number, limit: Limit): boolean {
  if (limit === null) return true;
  return Math.max(0, Number(used) || 0) <= limit;
}

/**
 * True when `amount` more units fit under the limit (used + amount <= limit).
 * Use for "may I create / add one more?" checks. A 0 limit never has room.
 */
export function hasRoomFor(used: number, limit: Limit, amount = 1): boolean {
  if (limit === null) return true;
  const u = Math.max(0, Number(used) || 0);
  const a = Math.max(0, Number(amount) || 0);
  return u + a <= limit;
}

/** Remaining units (null = unlimited). Never negative. */
export function remaining(limit: Limit, used: number): number | null {
  if (limit === null) return null;
  return Math.max(0, limit - Math.max(0, Number(used) || 0));
}

/** Human label for a limit ("Unlimited", "None", or the number + unit). */
export function formatLimit(limit: Limit, unit?: string): string {
  if (limit === null) return "Unlimited";
  if (limit === 0) return "None";
  return unit ? `${limit} ${unit}` : String(limit);
}

/**
 * Room capacity for non-host joins: the owner's effective `limits.guests`
 * when set (0 = no guests), else (unlimited plan) the MAX_GUESTS_PER_ROOM env
 * safety cap. undefined = no cap at all.
 */
export function resolveGuestCap(planGuests: Limit | undefined, envRaw: string | undefined): number | undefined {
  const envN = Number(envRaw || "0");
  const envCap = Number.isFinite(envN) && envN > 0 ? Math.floor(envN) : undefined;
  if (planGuests === null || planGuests === undefined) return envCap;
  return Math.max(0, Math.floor(Number(planGuests) || 0));
}

export function emptyFeatures(): EntitlementFeatures {
  const out = {} as EntitlementFeatures;
  for (const k of FEATURE_KEYS) out[k] = false;
  return out;
}
