/**
 * Recording Retention Cleanup Service
 *
 * Automatically deletes recordings older than 24 hours every hour.
 * Respects the retention policy:
 *   - DELETE: recordings older than 24 hours (ready / stopped / processing)
 *   - KEEP:   recordings less than 24 hours old
 *   - KEEP:   active recordings (status "recording" or "starting")
 *   - KEEP:   recordings without a valid createdAt (can't verify age)
 *
 * DRY_RUN mode: set env RECORDING_CLEANUP_DRY_RUN=1 to preview deletions
 * without actually removing any files or Firestore documents.
 *
 * Schedule: every hour (equivalent to cron pattern "0 * * * *")
 */

import { purgeOldRecordings, RECORDING_RETENTION_HOURS } from "../routes/maintenance";

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

async function runCleanup(): Promise<void> {
  const now = new Date();
  const dryRun = process.env.RECORDING_CLEANUP_DRY_RUN === "1";

  console.log(
    `[recordingCleanup] Starting retention sweep at ${now.toISOString()} ` +
      `(retentionHours=${RECORDING_RETENTION_HOURS}, dryRun=${dryRun})`
  );

  try {
    const { deletedCount, skippedCount } = await purgeOldRecordings(now, {
      dryRun,
      retentionHours: RECORDING_RETENTION_HOURS,
    });

    console.log(
      `[recordingCleanup] Sweep complete — deleted=${deletedCount} skipped=${skippedCount} dryRun=${dryRun}`
    );
  } catch (err: any) {
    console.error("[recordingCleanup] Sweep failed:", err?.message || err);
  }
}

/**
 * Start the hourly recording cleanup service.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function startRecordingCleanup(): void {
  if (cleanupInterval) return;

  console.log(
    `[recordingCleanup] Service started — runs every ${INTERVAL_MS / 1000 / 60} minutes ` +
      `(dryRun=${process.env.RECORDING_CLEANUP_DRY_RUN === "1"})`
  );

  // Run once immediately at startup, then every hour.
  void runCleanup();
  cleanupInterval = setInterval(() => void runCleanup(), INTERVAL_MS);
  cleanupInterval.unref(); // Don't keep the process alive solely for cleanup.
}

/**
 * Stop the cleanup service (useful for tests / graceful shutdown).
 */
export function stopRecordingCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
