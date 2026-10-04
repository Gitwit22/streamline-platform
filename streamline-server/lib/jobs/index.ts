/**
 * Scheduled jobs: importing this module registers every job.
 *
 *   job                     interval   what
 *   recording-enforcement   1 min      stop recordings past autoStopAt (per-clip limit)
 *   streaming-meter-sweep   2 min      bill / close / cap streaming outputs (STREAMING_METER_SWEEP_MS)
 *   stale-hls               5 min      purge orphaned HLS sessions
 *   media-purge             1 h        emergency expiry, deleteAfterMs, 24h retention
 *   account-purge           1 h        hard-delete closed accounts past deleteAfterMs
 *   expired-sessions        1 h        expired invites / pending codes / presence / old markers + job history
 *   temp-uploads            1 h        leftover multer temp files + render work dirs
 *   expired-exports         24 h       rendered export files older than EXPORT_RETENTION_DAYS
 *
 * Any interval can be overridden with JOB_<NAME>_MS (e.g. JOB_MEDIA_PURGE_MS);
 * "0" disables that job's timer (cron / admin "Run now" still work).
 */
export * from "./framework";
export { recordingEnforcementJob, enforceRecordingLimits } from "./recordingEnforcement";
export { streamingMeterJob, streamingMeterIntervalMs } from "./streamingMeterJob";
export { staleHlsJob, purgeStaleHls } from "./staleHls";
export {
  mediaPurgeJob,
  expireEmergencyRecordings,
  purgeExpiredRecordings,
  purgeOldRecordings,
  RECORDING_RETENTION_HOURS,
} from "./mediaPurge";
export { accountPurgeJob, purgeDeletedAccounts } from "./accountPurge";
export { ephemeralCleanupJob, cleanupEphemeralDocs } from "./ephemeralCleanup";
export { tempUploadsJob, cleanupTempUploads } from "./tempUploads";
export { expiredExportsJob, purgeExpiredExports } from "./expiredExports";

import { startJobScheduler } from "./framework";

/** Start the in-process scheduler unless JOBS_ENABLED=0. */
export function startScheduledJobs(): boolean {
  const flag = String(process.env.JOBS_ENABLED ?? "1").trim().toLowerCase();
  if (flag === "0" || flag === "false") {
    console.log("[jobs] in-process scheduler disabled (JOBS_ENABLED=0); cron / admin runs still work");
    return false;
  }
  const tick = Number(process.env.JOBS_TICK_MS);
  startJobScheduler({ tickMs: Number.isFinite(tick) && tick > 0 ? tick : undefined });
  return true;
}
