/**
 * "Save to library" for completed exports (pure part).
 *
 * editing_exports stays the job/queue record; its output is a temporary
 * download (purged after EXPORT_RETENTION_DAYS by jobs/expiredExports). Saving
 * moves the output under a stable My Content key and creates a saved_videos
 * doc (SavedVideo = finalized/exported video) that owns the bytes from then on.
 */

export type SaveExportDecision =
  | { ok: true }
  | { ok: false; status: number; error: string };

/** Can this export's output be saved to the library right now? */
export function decideSaveExport(job: Record<string, any> | null, uid: string): SaveExportDecision {
  if (!job) return { ok: false, status: 404, error: "export_not_found" };
  if (job.userId !== uid) return { ok: false, status: 403, error: "forbidden" };
  if (job.savedVideoId) return { ok: true }; // idempotent: already saved
  if (job.status !== "completed") return { ok: false, status: 409, error: "export_not_completed" };
  if (job.outputExpired === true || job.outputExpiring === true || job.outputStorageReleased === true) {
    return { ok: false, status: 410, error: "export_output_expired" };
  }
  if (typeof job.outputPath !== "string" || !job.outputPath.trim()) {
    return { ok: false, status: 409, error: "export_output_missing" };
  }
  return { ok: true };
}

/** Deterministic saved_videos id for an export (one library copy per export). */
export function savedVideoIdForExport(exportId: string): string {
  return `export_${exportId}`;
}

/** Stable library key: my-content/{uid}/exports/{exportId}.{ext} */
export function exportLibraryKey(uid: string, exportId: string, outputPath: string): string {
  const raw = String(outputPath || "").split("?")[0].split(".").pop() || "mp4";
  const ext = /^[a-z0-9]{1,5}$/i.test(raw) ? raw.toLowerCase() : "mp4";
  return `my-content/${uid}/exports/${exportId}.${ext}`;
}

export function buildSavedVideoFromExport(
  exportId: string,
  job: Record<string, any>,
  opts: { storagePath: string; sizeBytes: number; title: string; now: Date },
): Record<string, any> {
  const durationMs = Number(job?.timeline?.durationMs);
  const settings = job?.settings || {};
  return {
    userId: String(job.userId),
    title: String(opts.title || "Exported video").slice(0, 200),
    sourceType: "export",
    sourceId: exportId,
    sourceProjectId: typeof job.projectId === "string" ? job.projectId : null,
    playbackUrl: "",
    downloadUrl: null,
    thumbnailUrl: null,
    durationMs: Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : 0,
    sizeBytes: Math.max(0, Math.round(Number(opts.sizeBytes) || 0)),
    hasEmbeddedAudio: true,
    status: "ready",
    storagePath: opts.storagePath,
    metadata: {
      resolution: settings.resolution ?? null,
      format: settings.format ?? null,
      quality: settings.quality ?? null,
      width: job?.timeline?.width ?? null,
      height: job?.timeline?.height ?? null,
      fps: job?.timeline?.fps ?? null,
      renderedAt: job?.completedAt ?? null,
    },
    createdAt: opts.now,
  };
}
