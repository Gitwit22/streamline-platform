/**
 * Plan document normalization (pure).
 *
 * Every plan document is turned into a NormalizedPlan with v2 limit semantics
 * (null = unlimited, 0 = none) no matter how it is stored:
 *
 *  - `limitsVersion: 2` docs: read `features.*` / `limits.*` by their v2 keys.
 *    A limit stored as null is unlimited, a number is the cap (0 = none).
 *    A missing v2 limit key reads as 0 (fail closed).
 *
 *  - Legacy docs (no limitsVersion): read every historic alias and translate
 *    the legacy meaning of 0 / missing exactly as the old enforcement code did,
 *    so production behavior does not change on deploy:
 *      monthly minutes      0/missing => unlimited   (streamingMeterPure)
 *      destinations         0/missing => unlimited when the feature is on (multistream.ts cap)
 *      guests               0/missing => unlimited   (roomGuestAccess; env cap still applies)
 *      storage              first positive candidate, else unlimited (storagePure)
 *      recording per clip   0/missing => unlimited   (recordings.ts auto-stop)
 *      max session minutes  0/missing => unlimited   (shouldStopForSessionCap)
 *      projects             0/missing => unlimited   (editing.ts maxProjects)
 *      HLS minutes/session  null/0/missing => unlimited (hls.ts)
 *
 * scripts/migratePlansToV2.ts uses `toPlanDocV2()` to rewrite stored docs.
 */
import { resolvePlanMaxPreset } from "../mediaPresets";
import { PLAN_LIMITS_VERSION, type PlanDocV2 } from "./planCatalog";
import {
  FEATURE_KEYS,
  LIMIT_KEYS,
  emptyFeatures,
  toLimit,
  type EntitlementFeatures,
  type EntitlementLimits,
  type Limit,
  type LimitKey,
  type NormalizedPlan,
} from "./types";

const GB = 1024 * 1024 * 1024;

function toBool(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

/** true / false when explicitly set, undefined when absent. */
function triBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  return toBool(value);
}

function firstDefined(...values: unknown[]): unknown {
  for (const v of values) if (v !== undefined && v !== null) return v;
  return undefined;
}

function finiteOrUndefined(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Legacy "0 or missing means unlimited" numeric limit. */
function legacyZeroIsUnlimited(value: unknown): Limit {
  const n = finiteOrUndefined(value);
  if (n === undefined || n <= 0) return null;
  return Math.floor(n);
}

function firstFiniteNumber(values: unknown[], fallback: number): number {
  for (const v of values) {
    const n = finiteOrUndefined(v);
    if (n !== undefined) return n;
  }
  return fallback;
}

function readVisibility(id: string, data: any): NormalizedPlan["visibility"] {
  const raw = data.visibility ?? (data.hidden === true ? "hidden" : undefined);
  if (raw === "hidden" || raw === "admin" || raw === "public") return raw;
  if (id === "enterprise" || id === "internal" || id === "internal_unlimited") return "admin";
  return "public";
}

export function isV2PlanDoc(doc: any): boolean {
  return Number(doc?.limitsVersion) === PLAN_LIMITS_VERSION;
}

// ---------------------------------------------------------------------------
// Legacy (v1) readers
// ---------------------------------------------------------------------------

/** Plans whose HLS default is ON when a legacy doc carries no HLS key at all. */
const LEGACY_HLS_DEFAULT_ON = new Set(["pro", "enterprise", "internal_unlimited"]);
/** Plans whose overage default is ON when a legacy doc carries no overage key. */
const LEGACY_OVERAGES_DEFAULT_ON = new Set(["pro", "internal_unlimited"]);
/** Built-in destination caps for legacy docs that enable the feature but store no cap. */
const LEGACY_DEFAULT_DESTINATIONS: Record<string, number> = { pro: 3, internal_unlimited: 10 };

export function readLegacyFeatures(id: string, data: any): EntitlementFeatures {
  const f = (data.features || {}) as any;
  const idLower = String(id).toLowerCase();
  const out = emptyFeatures();

  // Multistream / Stream Destinations. The admin toggle writes
  // features.rtmp + features.rtmpMultistream (+ destinations 0); an explicit
  // false on either is OFF even when an older seeded `features.multistream:
  // true` is still present (the bug this engine fixes).
  const rtmp = triBool(f.rtmp ?? data.rtmpEnabled);
  const rtmpMultistream = triBool(f.rtmpMultistream);
  const multistreamFlag = triBool(firstDefined(f.multistream, f.rtmpMultistream, data.multistreamEnabled, data.multistream));
  const legacyCap = firstFiniteNumber(
    [
      data.limits?.rtmpDestinationsMax,
      data.limits?.maxDestinations,
      data.limits?.rtmpDestinations,
      data.rtmpDestinationsMax,
      data.maxDestinations,
      data.rtmpDestinations,
    ],
    0
  );
  if (rtmp === false || rtmpMultistream === false) {
    out.multistream = false;
  } else {
    out.multistream = rtmp === true || multistreamFlag === true || legacyCap > 0;
  }

  out.recording = toBool(f.recording ?? data.recordingEnabled);
  out.dualRecording = toBool(firstDefined(f.dualRecording, f.dual_recording, data.dualRecordingEnabled));

  // HLS: any explicit key (OR of the aliases the old gate honored); else plan default.
  const hlsCandidates = [
    f.hls,
    f.canHls,
    f.hlsEnabled,
    f.hlsBroadcast,
    data.hlsEnabled,
    data.hlsBroadcastEnabled,
    data.canHls,
    data.hls && typeof data.hls === "object" ? data.hls.enabled : undefined,
  ].filter((v) => v !== undefined && v !== null);
  out.hls = hlsCandidates.length > 0 ? hlsCandidates.some((v) => toBool(v)) : LEGACY_HLS_DEFAULT_ON.has(idLower);

  const customization = firstDefined(
    f.hlsCustomizationEnabled,
    f.hlsCustomization,
    f.canCustomizeHlsPage,
    data.hlsCustomizationEnabled,
    data.canCustomizeHlsPage
  );
  out.hlsCustomization = customization !== undefined ? toBool(customization) : out.hls;

  const editingAccess = data.editing?.access === true;
  out.editing = editingAccess;
  out.projects = editingAccess;
  out.contentLibrary = editingAccess;

  out.monetization = toBool(firstDefined(f.monetization, data.monetizationEnabled, data.monetization));
  out.payPerView = toBool(firstDefined(f.payPerView, f.ppv, data.payPerViewEnabled, data.ppvEnabled));
  out.invisibleHost = toBool(firstDefined(f.invisibleHost, data.invisibleHostEnabled, data.invisibleHost));

  const overages = firstDefined(f.allowsOverages, f.overagesAllowed, data.allowsOverages, data.overagesAllowed);
  out.overages = overages !== undefined ? toBool(overages) : LEGACY_OVERAGES_DEFAULT_ON.has(idLower);

  out.watermark = toBool(firstDefined(f.watermarkRecordings, f.watermark));
  return out;
}

/** Legacy storage cap: first POSITIVE candidate wins (storagePure order), else unlimited. */
export function readLegacyStorageBytes(data: any): Limit {
  const editing = data.editing || {};
  const candidates: Array<{ val: unknown; unit: "gb" | "bytes" }> = [
    { val: editing.maxStorageGB, unit: "gb" },
    { val: editing.maxStorageBytes, unit: "bytes" },
    { val: data.maxStorageGB, unit: "gb" },
    { val: data.maxStorageBytes, unit: "bytes" },
  ];
  for (const { val, unit } of candidates) {
    const n = finiteOrUndefined(val);
    if (n !== undefined && n > 0) return unit === "gb" ? Math.round(n * GB) : Math.round(n);
  }
  return null;
}

export function readLegacyLimits(id: string, data: any, features: EntitlementFeatures): Record<LimitKey, Limit> {
  const limits = (data.limits || {}) as any;
  const caps = (data.caps || {}) as any;
  const idLower = String(id).toLowerCase();

  const monthly = legacyZeroIsUnlimited(
    firstDefined(
      limits.monthlyMinutesIncluded,
      limits.participantMinutes,
      limits.monthlyMinutes,
      data.monthlyMinutesIncluded,
      data.participantMinutes,
      data.monthlyMinutes
    )
  );

  let destinations: Limit;
  if (!features.multistream) {
    destinations = 0;
  } else {
    const cap = firstFiniteNumber(
      [
        limits.rtmpDestinationsMax,
        limits.maxDestinations,
        limits.rtmpDestinations,
        data.rtmpDestinationsMax,
        data.maxDestinations,
        data.rtmpDestinations,
      ],
      0
    );
    if (cap > 0) destinations = Math.floor(cap);
    else if (LEGACY_DEFAULT_DESTINATIONS[idLower]) destinations = LEGACY_DEFAULT_DESTINATIONS[idLower];
    else destinations = null; // legacy "0 = no cap"
  }

  const hlsCapRaw = caps.hlsMaxMinutesPerSession !== undefined ? caps.hlsMaxMinutesPerSession : data?.hls?.maxSessionMinutes;

  return {
    monthlyStreamingMinutes: monthly,
    destinations,
    guests: legacyZeroIsUnlimited(firstDefined(limits.maxGuests, data.maxGuests)),
    storageBytes: readLegacyStorageBytes(data),
    recordingMinutesPerClip: legacyZeroIsUnlimited(
      firstDefined(
        limits.maxRecordingMinutesPerClip,
        limits.maxRecordingMinutesPerSession,
        data.maxRecordingMinutesPerClip,
        data.maxRecordingMinutesPerSession
      )
    ),
    maxSessionMinutes: legacyZeroIsUnlimited(firstDefined(limits.maxSessionMinutes, data.maxSessionMinutes)),
    projects: legacyZeroIsUnlimited(data.editing?.maxProjects),
    hlsMaxMinutesPerSession: legacyZeroIsUnlimited(hlsCapRaw),
  };
}

// ---------------------------------------------------------------------------
// v2 readers
// ---------------------------------------------------------------------------

function readV2Features(data: any): EntitlementFeatures {
  const f = (data.features || {}) as any;
  const out = emptyFeatures();
  for (const k of FEATURE_KEYS) out[k] = toBool(f[k]);
  return out;
}

function readV2Limits(data: any): Record<LimitKey, Limit> {
  const l = (data.limits || {}) as any;
  const out = {} as Record<LimitKey, Limit>;
  for (const k of LIMIT_KEYS) {
    // Missing key => 0 (fail closed); explicit null => unlimited.
    out[k] = Object.prototype.hasOwnProperty.call(l, k) ? toLimit(l[k]) : 0;
  }
  return out;
}

/** Feature dependencies that hold for every plan regardless of storage. */
function applyFeatureInvariants(features: EntitlementFeatures, limits: Record<LimitKey, Limit>) {
  if (!features.multistream) limits.destinations = 0;
  if (limits.destinations === 0) features.multistream = false;
  if (!features.recording) features.dualRecording = false;
  if (!features.monetization) features.payPerView = false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function normalizePlanDoc(id: string, doc: any | null | undefined): NormalizedPlan {
  const data = doc || {};
  const v2 = isV2PlanDoc(data);
  const features = v2 ? readV2Features(data) : readLegacyFeatures(id, data);
  const limitsBase = v2 ? readV2Limits(data) : readLegacyLimits(id, data, features);
  applyFeatureInvariants(features, limitsBase);

  const limits: EntitlementLimits = {
    ...limitsBase,
    maxPresetId: resolvePlanMaxPreset(id, data),
  };

  return {
    id,
    name: String(data.name || id),
    description: String(data.description || ""),
    visibility: readVisibility(id, data),
    priceMonthly: firstFiniteNumber([data.priceMonthly, data.price], 0),
    limitsVersion: v2 ? 2 : 1,
    features,
    limits,
    raw: data,
  };
}

/**
 * Build the v2 fields to store for a plan doc (used by the migration script
 * and the admin plan editor). Preserves the plan's CURRENT meaning: a legacy
 * "0 = unlimited" becomes null, a legacy "feature off" becomes 0.
 */
export function toPlanDocV2(id: string, doc: any): Pick<PlanDocV2, "limitsVersion" | "features" | "limits"> {
  const normalized = normalizePlanDoc(id, doc);
  const storedPreset = (doc?.limits || {}).maxPresetId ?? (doc || {}).maxPresetId;
  const { maxPresetId: _resolved, ...numeric } = normalized.limits;
  return {
    limitsVersion: PLAN_LIMITS_VERSION,
    features: { ...normalized.features },
    limits: {
      ...(numeric as Record<LimitKey, Limit>),
      maxPresetId: typeof storedPreset === "string" && storedPreset.trim() ? storedPreset.trim() : null,
    },
  };
}

/**
 * Validate + coerce an admin-submitted v2 plan body. Unknown keys are dropped;
 * limits accept null (unlimited) or a non-negative number (0 = none).
 */
export function sanitizePlanV2Input(body: any): {
  features: Partial<Record<(typeof FEATURE_KEYS)[number], boolean>>;
  limits: Partial<Record<LimitKey, Limit>> & { maxPresetId?: string | null };
  errors: string[];
} {
  const errors: string[] = [];
  const features: any = {};
  const limits: any = {};
  const f = body?.features && typeof body.features === "object" ? body.features : {};
  const l = body?.limits && typeof body.limits === "object" ? body.limits : {};
  for (const k of FEATURE_KEYS) {
    if (f[k] === undefined) continue;
    if (typeof f[k] !== "boolean") errors.push(`features.${k} must be boolean`);
    else features[k] = f[k];
  }
  for (const k of LIMIT_KEYS) {
    if (l[k] === undefined) continue;
    if (l[k] === null) {
      limits[k] = null;
      continue;
    }
    const n = Number(l[k]);
    if (typeof l[k] === "boolean" || !Number.isFinite(n) || n < 0) {
      errors.push(`limits.${k} must be null (unlimited) or a number >= 0`);
    } else {
      limits[k] = Math.floor(n);
    }
  }
  if (l.maxPresetId !== undefined) {
    if (l.maxPresetId === null || (typeof l.maxPresetId === "string" && l.maxPresetId.trim() === "")) limits.maxPresetId = null;
    else if (typeof l.maxPresetId === "string") limits.maxPresetId = l.maxPresetId.trim();
    else errors.push("limits.maxPresetId must be a preset id or null");
  }
  return { features, limits, errors };
}
