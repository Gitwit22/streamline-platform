import { firestore } from "../firebaseAdmin";
import { getEffectiveEntitlements } from "./effectiveEntitlements";

export type MediaPresetId = "standard_720p30" | "hd_1080p30" | "sports_1080p60" | "pro_1440p30" | "ultra_4k30";

export type MediaPresetProfile = { width: number; height: number; fps: number; videoKbps: number; audioKbps: number };

export type MediaPreset = {
  id: MediaPresetId;
  label: string;
  record: MediaPresetProfile;
  stream: MediaPresetProfile;
};

export const MEDIA_PRESETS: MediaPreset[] = [
  {
    id: "standard_720p30",
    label: "Standard (720p30)",
    record: { width: 1280, height: 720, fps: 30, videoKbps: 2800, audioKbps: 128 },
    stream: { width: 1280, height: 720, fps: 30, videoKbps: 2500, audioKbps: 128 },
  },
  {
    id: "hd_1080p30",
    label: "Full HD (1080p30)",
    record: { width: 1920, height: 1080, fps: 30, videoKbps: 5200, audioKbps: 160 },
    stream: { width: 1920, height: 1080, fps: 30, videoKbps: 4500, audioKbps: 160 },
  },
  {
    id: "sports_1080p60",
    label: "Action/Sports (1080p60)",
    record: { width: 1920, height: 1080, fps: 60, videoKbps: 7800, audioKbps: 192 },
    stream: { width: 1920, height: 1080, fps: 60, videoKbps: 6800, audioKbps: 192 },
  },
  {
    id: "pro_1440p30",
    label: "Studio (1440p30)",
    record: { width: 2560, height: 1440, fps: 30, videoKbps: 9000, audioKbps: 192 },
    stream: { width: 2560, height: 1440, fps: 30, videoKbps: 8000, audioKbps: 192 },
  },
  {
    id: "ultra_4k30",
    label: "Cinema (4K30)",
    record: { width: 3840, height: 2160, fps: 30, videoKbps: 16000, audioKbps: 192 },
    stream: { width: 3840, height: 2160, fps: 30, videoKbps: 14000, audioKbps: 192 },
  },
];

const MEDIA_PRESET_MAP = Object.fromEntries(MEDIA_PRESETS.map((p) => [p.id, p])) as Record<MediaPresetId, MediaPreset>;

export const QUALITY_ORDER: MediaPresetId[] = [
  "standard_720p30",
  "hd_1080p30",
  "sports_1080p60",
  "pro_1440p30",
  "ultra_4k30",
];

/** Built-in fallback ceilings, used when plans/{id} defines no preset cap. */
export const PLAN_MAX_PRESET: Record<string, MediaPresetId> = {
  free: "hd_1080p30",
  starter: "hd_1080p30",
  basic: "hd_1080p30",
  pro: "sports_1080p60",
  enterprise: "ultra_4k30",
  internal_unlimited: "ultra_4k30",
};

export const DEFAULT_PRESET_ID: MediaPresetId = "standard_720p30";

/** Static id -> label map. The client keeps a copy in src/lib/mediaPresetLabels.ts. */
export const MEDIA_PRESET_LABELS: Record<MediaPresetId, string> = Object.fromEntries(
  MEDIA_PRESETS.map((p) => [p.id, p.label])
) as Record<MediaPresetId, string>;

/** Returns the id when it names a known preset, otherwise null. */
export function normalizePresetId(id?: unknown): MediaPresetId | null {
  if (typeof id !== "string") return null;
  const trimmed = id.trim();
  return MEDIA_PRESET_MAP[trimmed as MediaPresetId] ? (trimmed as MediaPresetId) : null;
}

export function presetRank(id?: unknown): number {
  const n = normalizePresetId(id);
  return n ? QUALITY_ORDER.indexOf(n) : -1;
}

export function getPresetById(id?: string | null): MediaPreset {
  const preset = id ? MEDIA_PRESET_MAP[id as MediaPresetId] : undefined;
  return preset || MEDIA_PRESET_MAP[DEFAULT_PRESET_ID];
}

const RESOLUTION_ALIASES: Record<string, MediaPresetId> = {
  "720p": "standard_720p30",
  "720p30": "standard_720p30",
  "1080p": "hd_1080p30",
  "1080p30": "hd_1080p30",
  "1080p60": "sports_1080p60",
  "1440p": "pro_1440p30",
  "1440p30": "pro_1440p30",
  "2160p": "ultra_4k30",
  "4k": "ultra_4k30",
  "4k30": "ultra_4k30",
};

/**
 * Highest preset a plan may use. A plan doc (plans/{id}) may define
 * `limits.maxPresetId` / `maxPresetId` (a preset id) or `limits.maxResolution`
 * ("720p", "1080p", "1080p60", "1440p", "4k"); otherwise the built-in table
 * applies, and unknown plans get the free ceiling.
 */
export function resolvePlanMaxPreset(planId: string, planRaw?: any): MediaPresetId {
  const raw = planRaw || {};
  const limits = raw.limits || {};
  const candidates = [limits.maxPresetId, raw.maxPresetId, limits.maxMediaPresetId, limits.maxResolution, raw.maxResolution];
  for (const c of candidates) {
    if (typeof c !== "string" || !c.trim()) continue;
    const asId = normalizePresetId(c);
    if (asId) return asId;
    const alias = RESOLUTION_ALIASES[c.trim().toLowerCase()];
    if (alias) return alias;
  }
  return PLAN_MAX_PRESET[String(planId || "").toLowerCase()] || PLAN_MAX_PRESET["free"];
}

/** Clamp a requested preset to an explicit maximum preset id. */
export function clampPresetToMax(maxPresetId: MediaPresetId, requestedId?: string | null) {
  const requested = getPresetById(requestedId || undefined);
  const maxIndex = Math.max(0, QUALITY_ORDER.indexOf(maxPresetId));
  const requestedIndex = QUALITY_ORDER.indexOf(requested.id);
  const effectiveId = requestedIndex <= maxIndex ? requested.id : QUALITY_ORDER[maxIndex];
  const effective = getPresetById(effectiveId);
  return {
    requestedId: requested.id,
    effectiveId: effective.id,
    preset: effective,
    clamped: effective.id !== requested.id,
    maxPresetId: QUALITY_ORDER[maxIndex],
  };
}

/**
 * Clamp a requested preset to the plan's ceiling. Pass `maxPresetId` (from
 * getPresetPlanContext, which reads plans/{id}) whenever available; the
 * built-in table is only the fallback.
 */
export function clampPresetForPlan(planId: string, requestedId?: string | null, maxPresetId?: MediaPresetId | null) {
  return clampPresetToMax(maxPresetId || resolvePlanMaxPreset(planId), requestedId);
}

/** Every preset with `allowed` for a plan ceiling (settings UI). */
export function presetsWithAvailability(maxPresetId: MediaPresetId) {
  const maxIndex = QUALITY_ORDER.indexOf(maxPresetId);
  return MEDIA_PRESETS.map((p) => ({ ...p, allowed: QUALITY_ORDER.indexOf(p.id) <= maxIndex }));
}

/**
 * Which preset was asked for, before any clamping.
 * - A choice made in the Stream Setup modal (presetExplicit: true) wins.
 * - The room owner's presetId is honoured even without the flag (older
 *   clients); a non-owner's implicit presetId is ignored so cohosts and
 *   producers get the OWNER's default, not their own.
 * - Otherwise the owner's saved mediaPrefs.defaultPresetId, then 720p30.
 */
export function resolveRequestedPresetId(input: {
  bodyPresetId?: unknown;
  presetExplicit?: unknown;
  actorIsOwner: boolean;
  ownerDefaultPresetId?: unknown;
}): { requestedId: MediaPresetId; source: "explicit" | "owner_default" | "fallback" } {
  const body = normalizePresetId(input.bodyPresetId);
  const explicit = input.presetExplicit === true || input.presetExplicit === "true";
  if (body && (explicit || input.actorIsOwner)) return { requestedId: body, source: "explicit" };
  const ownerDefault = normalizePresetId(input.ownerDefaultPresetId);
  if (ownerDefault) return { requestedId: ownerDefault, source: "owner_default" };
  return { requestedId: DEFAULT_PRESET_ID, source: "fallback" };
}

export function clampRecordingPreset(
  planId: string,
  requestedId?: string | null,
  streamPresetId?: string | null,
  allowHigherThanStream: boolean = false,
  maxPresetId?: MediaPresetId | null
) {
  const planClamp = clampPresetForPlan(planId, requestedId, maxPresetId);

  // If a stream preset is active and higher-than-stream is not allowed, pick the lower quality of the two
  if (streamPresetId && !allowHigherThanStream) {
    const streamPreset = getPresetById(streamPresetId);
    const streamIdx = QUALITY_ORDER.indexOf(streamPreset.id);
    const currentIdx = QUALITY_ORDER.indexOf(planClamp.effectiveId as MediaPresetId);
    if (streamIdx >= 0 && currentIdx >= 0 && streamIdx < currentIdx) {
      const lowered = getPresetById(streamPreset.id);
      return {
        ...planClamp,
        effectiveId: lowered.id,
        preset: lowered,
        clamped: true,
        clampedToStream: true,
      };
    }
  }

  return { ...planClamp, clampedToStream: false };
}

// ---------------------------------------------------------------------------
// Destination-aware stream caps
// ---------------------------------------------------------------------------

export type DestinationCap = { label: string; maxHeight: number; maxFps: number; maxVideoKbps: number | null };

/**
 * Ingest limits per platform. One RoomComposite egress feeds every RTMP URL,
 * so the strictest destination in the set wins.
 * - Twitch: 1080p60, 6000 kbps max (non-partner ingest guidance).
 * - Facebook Live: 1080p60, 6000 kbps (stay inside the recommended band).
 * - YouTube: accepts up to 4K.
 * - Custom RTMP: no platform limit.
 * - Other named platforms (kick, linkedin, ...): 1080p60.
 */
export const DESTINATION_CAPS: Record<string, DestinationCap> = {
  twitch: { label: "Twitch", maxHeight: 1080, maxFps: 60, maxVideoKbps: 6000 },
  facebook: { label: "Facebook", maxHeight: 1080, maxFps: 60, maxVideoKbps: 6000 },
  youtube: { label: "YouTube", maxHeight: 2160, maxFps: 60, maxVideoKbps: null },
  custom: { label: "Custom RTMP", maxHeight: 2160, maxFps: 60, maxVideoKbps: null },
};
const OTHER_PLATFORM_CAP: Omit<DestinationCap, "label"> = { maxHeight: 1080, maxFps: 60, maxVideoKbps: null };

/** RoomComposite above 1080p is heavy; only enterprise-tier ceilings get it. */
const COMPOSITE_STREAM_MAX_HEIGHT_DEFAULT = 1080;

function normalizePlatform(p: string): string {
  const v = String(p || "").trim().toLowerCase();
  if (!v || v === "destination" || v === "rtmp" || v === "custom_rtmp") return "custom";
  if (v === "fb" || v === "facebook_live") return "facebook";
  if (v === "yt") return "youtube";
  return v;
}

export type StreamProfileResult = {
  effectiveId: MediaPresetId;
  profile: MediaPresetProfile;
  adjusted: boolean;
  bitrateCapped: boolean;
  limitingPlatform: string | null;
  adjustmentReason: string | null;
};

/**
 * Apply destination caps to an (already plan-clamped) stream preset.
 * `planMaxPresetId` decides whether >1080p composites are allowed at all
 * (only when the plan ceiling is above 1080p60 AND every destination is
 * YouTube / custom).
 */
export function applyDestinationCaps(
  presetId: string,
  platforms: string[],
  planMaxPresetId: MediaPresetId
): StreamProfileResult {
  const start = getPresetById(presetId);
  const normalized = Array.from(new Set((platforms || []).map(normalizePlatform)));

  let maxHeight = Number.POSITIVE_INFINITY;
  let maxFps = Number.POSITIVE_INFINITY;
  let maxKbps = Number.POSITIVE_INFINITY;
  let heightLimiter: string | null = null;
  let fpsLimiter: string | null = null;
  let kbpsLimiter: string | null = null;

  for (const p of normalized) {
    const cap = DESTINATION_CAPS[p] || { ...OTHER_PLATFORM_CAP, label: p.charAt(0).toUpperCase() + p.slice(1) };
    if (cap.maxHeight < maxHeight) { maxHeight = cap.maxHeight; heightLimiter = cap.label; }
    if (cap.maxFps < maxFps) { maxFps = cap.maxFps; fpsLimiter = cap.label; }
    if (cap.maxVideoKbps !== null && cap.maxVideoKbps < maxKbps) { maxKbps = cap.maxVideoKbps; kbpsLimiter = cap.label; }
  }

  const enterpriseComposite = presetRank(planMaxPresetId) > presetRank("sports_1080p60");
  if (!enterpriseComposite && COMPOSITE_STREAM_MAX_HEIGHT_DEFAULT < maxHeight) {
    maxHeight = COMPOSITE_STREAM_MAX_HEIGHT_DEFAULT;
    heightLimiter = null; // plan/composite limit, not a destination
  }

  let idx = QUALITY_ORDER.indexOf(start.id);
  while (idx > 0) {
    const s = MEDIA_PRESET_MAP[QUALITY_ORDER[idx]].stream;
    if (s.height <= maxHeight && s.fps <= maxFps) break;
    idx -= 1;
  }
  const effective = MEDIA_PRESET_MAP[QUALITY_ORDER[idx]];
  const profile = { ...effective.stream };
  let bitrateCapped = false;
  if (Number.isFinite(maxKbps) && profile.videoKbps > maxKbps) {
    profile.videoKbps = maxKbps;
    bitrateCapped = true;
  }

  const adjusted = effective.id !== start.id;
  let limitingPlatform: string | null = null;
  if (adjusted) {
    const startStream = start.stream;
    limitingPlatform = startStream.height > maxHeight ? heightLimiter : fpsLimiter;
  } else if (bitrateCapped) {
    limitingPlatform = kbpsLimiter;
  }

  let adjustmentReason: string | null = null;
  const shortLabel = (id: MediaPresetId) => {
    const s = MEDIA_PRESET_MAP[id].stream;
    return `${s.height === 2160 ? "4K" : `${s.height}p`}${s.fps === 60 ? "60" : ""}`;
  };
  if (adjusted) {
    adjustmentReason = limitingPlatform
      ? `Adjusted to ${shortLabel(effective.id)} for ${limitingPlatform}`
      : `Adjusted to ${shortLabel(effective.id)} for live streaming`;
  } else if (bitrateCapped && limitingPlatform) {
    adjustmentReason = `Bitrate capped at ${profile.videoKbps} kbps for ${limitingPlatform}`;
  }

  return { effectiveId: effective.id, profile, adjusted, bitrateCapped, limitingPlatform, adjustmentReason };
}

// ---------------------------------------------------------------------------
// HLS
// ---------------------------------------------------------------------------

export type HlsQualityId = "hls_720p" | "hls_1080p";

/**
 * HLS quality: explicit choice (hls_* or a media preset id) when given,
 * otherwise the owner's default; then clamped by plan and to 1080p30 (HLS
 * never goes above 1080p30).
 */
export function resolveHlsPreset(input: {
  bodyPresetId?: unknown;
  ownerDefaultPresetId?: unknown;
  planMaxPresetId: MediaPresetId;
}): { hlsPresetId: HlsQualityId; mediaPresetId: MediaPresetId; clamped: boolean } {
  const raw = typeof input.bodyPresetId === "string" ? input.bodyPresetId.trim() : "";
  let requested: MediaPresetId | null = null;
  if (raw === "hls_1080p") requested = "hd_1080p30";
  else if (raw === "hls_720p") requested = "standard_720p30";
  else requested = normalizePresetId(raw);
  if (!requested) requested = normalizePresetId(input.ownerDefaultPresetId) || DEFAULT_PRESET_ID;

  const planClamp = clampPresetToMax(input.planMaxPresetId, requested);
  const hlsCeiling = presetRank(planClamp.effectiveId) >= presetRank("hd_1080p30");
  const mediaPresetId: MediaPresetId = hlsCeiling ? "hd_1080p30" : "standard_720p30";
  const hlsPresetId: HlsQualityId = hlsCeiling ? "hls_1080p" : "hls_720p";
  // "clamped" = the delivered quality is lower than the requested preset.
  const clamped = presetRank(mediaPresetId) < presetRank(requested);
  return { hlsPresetId, mediaPresetId, clamped };
}

// ---------------------------------------------------------------------------
// Encoding options
// ---------------------------------------------------------------------------

/** Seconds between keyframes for every egress (platform ingest guidance: 2s). */
export const KEYFRAME_INTERVAL_SEC = 2;

/**
 * LiveKit egress "advanced" EncodingOptions (protobuf livekit.EncodingOptions).
 * Field names must match the proto exactly (width / height / framerate /
 * keyFrameInterval) – unknown keys are silently dropped – and bitrates are in
 * **kbps**; keyFrameInterval is in seconds (proto `double key_frame_interval`).
 */
export type EgressEncodingOptions = {
  width: number;
  height: number;
  framerate: number;
  videoBitrate: number;
  audioBitrate: number;
  keyFrameInterval: number;
};

export function encodingOptionsFor(cfg: MediaPresetProfile): EgressEncodingOptions {
  return {
    width: cfg.width,
    height: cfg.height,
    framerate: cfg.fps,
    videoBitrate: cfg.videoKbps,
    audioBitrate: cfg.audioKbps,
    keyFrameInterval: KEYFRAME_INTERVAL_SEC,
  };
}

export function toEncodingOptions(preset: MediaPreset, target: "record" | "stream"): EgressEncodingOptions {
  return encodingOptionsFor(preset[target]);
}

/** Instagram Live (vertical 9:16) profile: 1080x1920 @30fps, ~3500 kbps. */
export const INSTAGRAM_STREAM_PROFILE: MediaPresetProfile = {
  width: 1080,
  height: 1920,
  fps: 30,
  videoKbps: 3500,
  audioKbps: 128,
};

// ---------------------------------------------------------------------------
// Plan / owner lookups
// ---------------------------------------------------------------------------

export type PresetPlanContext = {
  planId: string;
  maxPresetId: MediaPresetId;
  /** The user's saved mediaPrefs.defaultPresetId, clamped to the plan (null if unset). */
  defaultPresetId: MediaPresetId | null;
};

/**
 * Effective plan (honours adminOverridePlanId via getEffectiveEntitlements),
 * the plan's preset ceiling (plans/{id} limits, built-in fallback) and the
 * user's saved default preset clamped to that ceiling.
 */
export async function getPresetPlanContext(uid: string): Promise<PresetPlanContext> {
  const snap = await firestore.collection("users").doc(uid).get();
  if (!snap.exists) {
    return { planId: "free", maxPresetId: resolvePlanMaxPreset("free"), defaultPresetId: null };
  }
  const data = (snap.data() as any) || {};
  let planId = String(data.adminOverridePlanId || data.planId || data.plan || "free");
  let planRaw: any = null;
  try {
    const ent = await getEffectiveEntitlements(uid);
    planId = ent.planId;
    planRaw = ent.plan?.raw ?? null;
  } catch (e: any) {
    console.warn("[mediaPresets] entitlements lookup failed; using user doc plan", e?.message || e);
  }
  const maxPresetId = resolvePlanMaxPreset(planId, planRaw);
  const saved = normalizePresetId(data?.mediaPrefs?.defaultPresetId);
  const defaultPresetId = saved ? clampPresetToMax(maxPresetId, saved).effectiveId : null;
  return { planId, maxPresetId, defaultPresetId };
}

/** Effective plan id (incl. adminOverridePlanId). */
export async function getUserPlanId(uid: string): Promise<string> {
  return (await getPresetPlanContext(uid)).planId;
}
