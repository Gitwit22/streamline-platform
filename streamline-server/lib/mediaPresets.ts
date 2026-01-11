import { firestore } from "../firebaseAdmin";

export type MediaPresetId = "standard_720p30" | "hd_1080p30" | "sports_1080p60" | "pro_1440p30" | "ultra_4k30";

export type MediaPreset = {
  id: MediaPresetId;
  label: string;
  record: { width: number; height: number; fps: number; videoKbps: number; audioKbps: number };
  stream: { width: number; height: number; fps: number; videoKbps: number; audioKbps: number };
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

const MEDIA_PRESET_MAP = Object.fromEntries(MEDIA_PRESETS.map((p) => [p.id, p]));

const QUALITY_ORDER: MediaPresetId[] = [
  "standard_720p30",
  "hd_1080p30",
  "sports_1080p60",
  "pro_1440p30",
  "ultra_4k30",
];

const PLAN_MAX_PRESET: Record<string, MediaPresetId> = {
  free: "hd_1080p30",
  starter: "hd_1080p30",
  basic: "hd_1080p30",
  pro: "sports_1080p60",
  enterprise: "ultra_4k30",
  internal_unlimited: "ultra_4k30",
};

export function getPresetById(id?: string | null): MediaPreset {
  const preset = id ? MEDIA_PRESET_MAP[id as MediaPresetId] : undefined;
  return preset || MEDIA_PRESET_MAP["standard_720p30"];
}

export function clampPresetForPlan(planId: string, requestedId?: string | null) {
  const requested = getPresetById(requestedId || undefined);
  const maxAllowed = PLAN_MAX_PRESET[planId] || PLAN_MAX_PRESET["free"];
  const maxIndex = QUALITY_ORDER.indexOf(maxAllowed);
  const requestedIndex = QUALITY_ORDER.indexOf(requested.id);

  const effectiveId = requestedIndex <= maxIndex ? requested.id : QUALITY_ORDER[maxIndex];
  const effective = getPresetById(effectiveId);

  return {
    requestedId: requested.id,
    effectiveId: effective.id,
    preset: effective,
    clamped: effective.id !== requested.id,
  };
}

export function clampRecordingPreset(
  planId: string,
  requestedId?: string | null,
  streamPresetId?: string | null,
  allowHigherThanStream: boolean = false
) {
  const planClamp = clampPresetForPlan(planId, requestedId);

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

export function toEncodingOptions(preset: MediaPreset, target: "record" | "stream") {
  const cfg = preset[target];
  return {
    videoWidth: cfg.width,
    videoHeight: cfg.height,
    videoBitrate: cfg.videoKbps * 1000,
    audioBitrate: cfg.audioKbps * 1000,
    frameRate: cfg.fps,
  } as const;
}

export async function getUserPlanId(uid: string): Promise<string> {
  const snap = await firestore.collection("users").doc(uid).get();
  if (!snap.exists) return "free";
  const data = snap.data() || {};
  return String(data.planId || data.plan || "free");
}
