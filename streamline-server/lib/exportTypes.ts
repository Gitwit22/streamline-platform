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
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

/** What the client sends when starting an export. */
export interface ExportSettingsInput {
  resolution?: "720p" | "1080p" | "4k";
  format?: "mp4" | "webm" | "mov";
  quality?: "draft" | "standard" | "high";
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
  /** Resolved download URL for the source media */
  sourceUrl: string;
  name: string;
}

export interface ExportTimelineTrack {
  id: string;
  kind: "video" | "audio";
  muted: boolean;
  clips: ExportTimelineClip[];
}

export interface ExportTimeline {
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  tracks: ExportTimelineTrack[];
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
  return { resolution, format, quality } as ExportSettingsInput;
}
