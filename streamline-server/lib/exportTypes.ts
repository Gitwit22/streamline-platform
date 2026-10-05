// ============================================================================
// Export Pipeline Types
// ============================================================================

/**
 * Job states for the export pipeline.
 * queued      → job created, waiting for worker
 * preparing   → worker claimed, downloading assets
 * rendering   → FFmpeg running
 * uploading   → rendered file being uploaded to R2
 * completed   → output URL ready
 * failed      → terminal error
 * canceled    → user canceled before completion
 */
export type ExportJobStatus =
  | "queued"
  | "preparing"
  | "rendering"
  | "uploading"
  | "completed"
  | "failed"
  | "canceled";

/** Persisted export job document shape (Firestore: editing_exports). */
export interface ExportJobDoc {
  id: string;
  userId: string;
  projectId: string;
  status: ExportJobStatus;
  progressPercent: number;
  currentStep: string;
  errorMessage: string | null;
  attemptCount: number;
  outputUrl: string | null;
  outputPath: string | null;
  settings: ExportSettingsInput | null;
  timeline: ExportTimeline | null;
  /** saved_videos doc created from this export's output ("Save to library"). */
  savedVideoId?: string | null;
  /** 1 = plan has priority rendering (claimed before FIFO jobs). */
  priority?: 0 | 1;
  /** Monthly export usage reservation (refunded on fail / cancel / reap). */
  exportUsage?: { monthKey: string; counted: boolean; refunded: boolean };
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

/** What the client sends when starting an export. */
export interface ExportSettingsInput {
  resolution?: "720p" | "1080p" | "4k";
  format?: "mp4" | "webm" | "mov";
  quality?: "draft" | "standard" | "high";
  /** Output frame rate (default 30). */
  fps?: 24 | 30 | 60;
  /** Custom watermark burned into the export (plan: editing.export.watermark). */
  watermark?: WatermarkSettings | null;
}

export type WatermarkPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";

/** What the user picks. Images come from their own media assets. */
export interface WatermarkSettings {
  kind: "text" | "image";
  /** kind text: up to 60 characters. */
  text?: string;
  /** kind image: the user's image asset id. */
  assetId?: string;
  position: WatermarkPosition;
  /** Image: % of output width (5..40). Text: % of output height (2..12). */
  sizePct: number;
  /** 10..100 */
  opacityPct: number;
}

/** Resolved overlay the worker renders (image source resolved server-side). */
export interface ExportWatermark {
  kind: "text" | "image";
  text?: string;
  sourceKey?: string;
  sourceUrl?: string;
  position: WatermarkPosition;
  sizePct: number;
  opacityPct: number;
  /** Plan-forced "Made with Streamline" mark. */
  forced?: boolean;
}

// ============================================================================
// Render input contract — the stable payload the worker consumes
// ============================================================================

export interface ExportTimelineClip {
  id: string;
  assetId: string;
  trackId: string;
  /** Start offset on the timeline in milliseconds */
  startMs: number;
  /** End offset on the timeline in milliseconds */
  endMs: number;
  /** Source in-point in milliseconds */
  sourceInMs: number;
  /** Source out-point in milliseconds */
  sourceOutMs: number;
  /** Resolved download URL for the source media (allowlisted storage host only) */
  sourceUrl: string;
  /**
   * R2 object key resolved server-side from the user's own recording /
   * editing asset doc. When present the worker presigns it instead of using
   * sourceUrl.
   */
  sourceKey?: string;
  name: string;
  // ── version 2 fields (absent on jobs queued by older servers) ──
  /** Clip type in the editor ("video" = picture, "audio" = sound). */
  kind?: "video" | "audio";
  /** What the source file is (images are looped for the clip length). */
  mediaType?: "video" | "audio" | "image";
  /** Linear gain 0..2 (1 = unity). */
  volume?: number;
  /** Clip muted: contributes no audio. */
  muted?: boolean;
  /** Video clip hidden: contributes no picture. */
  hidden?: boolean;
  /** Video clip contributes its own embedded audio (no linked audio clip). */
  embeddedAudio?: boolean;
  /** How this clip enters (audio clips inherit their linked video clip's). */
  transitionIn?: ClipTransition;
}

export type TransitionType = "fade" | "dip_to_black" | "crossfade";

export interface ClipTransition {
  type: TransitionType;
  durationMs: number;
}

export interface ExportTimelineTrack {
  id: string;
  kind: "video" | "audio";
  /** Effective mute (track mute, or not soloed while another track is). */
  muted: boolean;
  /** Editor track order: lower = drawn on top (video). */
  order?: number;
  clips: ExportTimelineClip[];
}

export interface ExportTimeline {
  /** 2 = canonical editor timeline with audio mixing fields. */
  version?: 2;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  tracks: ExportTimelineTrack[];
  /** Watermarks drawn over the picture (custom + plan-forced). */
  watermarks?: ExportWatermark[];
}

// ============================================================================
// Resolution / format helpers
// ============================================================================

export function resolutionToDimensions(
  resolution: string | undefined
): { width: number; height: number } {
  switch (resolution) {
    case "4k":
      return { width: 3840, height: 2160 };
    case "1080p":
      return { width: 1920, height: 1080 };
    case "720p":
    default:
      return { width: 1280, height: 720 };
  }
}

export function formatToContainer(format: string | undefined): string {
  switch (format) {
    case "webm":
      return "webm";
    case "mov":
      return "mov";
    case "mp4":
    default:
      return "mp4";
  }
}

/**
 * Validate and normalise an ExportSettingsInput.
 */
export function normalizeExportSettings(raw: any): ExportSettingsInput {
  const resolution =
    raw?.resolution === "4k" || raw?.resolution === "1080p"
      ? raw.resolution
      : "720p";
  const format =
    raw?.format === "webm" || raw?.format === "mov"
      ? raw.format
      : "mp4";
  const quality =
    raw?.quality === "draft" || raw?.quality === "high"
      ? raw.quality
      : "standard";
  const fpsNum = Number(raw?.fps);
  const fps = fpsNum === 24 || fpsNum === 60 ? fpsNum : 30;
  const watermark = normalizeWatermarkSettings(raw?.watermark);
  return { resolution, format, quality, fps, ...(watermark ? { watermark } : {}) } as ExportSettingsInput;
}

const WATERMARK_POSITIONS: readonly WatermarkPosition[] = ["top-left", "top-right", "bottom-left", "bottom-right", "center"];
export const WATERMARK_TEXT_MAX = 60;

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

/** Validate a client watermark; null when absent or unusable (empty text / no image). */
export function normalizeWatermarkSettings(raw: any): WatermarkSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const position: WatermarkPosition = WATERMARK_POSITIONS.includes(raw.position) ? raw.position : "bottom-right";
  const opacityPct = clampNum(raw.opacityPct, 10, 100, 70);
  if (raw.kind === "text") {
    // Control characters are dropped; the worker passes text via a file (no escaping issues).
    const text = String(raw.text ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, WATERMARK_TEXT_MAX);
    if (!text) return null;
    return { kind: "text", text, position, sizePct: clampNum(raw.sizePct, 2, 12, 5), opacityPct };
  }
  if (raw.kind === "image") {
    const assetId = typeof raw.assetId === "string" ? raw.assetId.trim().slice(0, 200) : "";
    if (!assetId) return null;
    return { kind: "image", assetId, position, sizePct: clampNum(raw.sizePct, 5, 40, 15), opacityPct };
  }
  return null;
}

/** The plan-forced brand mark. */
export const FORCED_BRAND_MARK: ExportWatermark = {
  kind: "text",
  text: "Made with Streamline",
  position: "bottom-right",
  sizePct: 4,
  opacityPct: 60,
  forced: true,
};
