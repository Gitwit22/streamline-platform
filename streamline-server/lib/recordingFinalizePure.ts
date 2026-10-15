/**
 * Recording finalization rules (pure).
 *
 * LiveKit's SDK parses EgressInfo.status as an enum NUMBER (3 = complete,
 * 4 = failed, 5 = aborted, 6 = limit reached), not the "EGRESS_COMPLETE"
 * string the webhook used to compare against — so the egress_ended webhook
 * never marked recordings ready or failed (audit P1-2). Names and numbers are
 * both accepted here (egressStatusName).
 */
import { egressStatusName } from "./streamSummaryPure";

/**
 * check_file – egress ended in a way that may have produced a file: ready if
 *              the object exists in storage, failed if not
 * failed     – egress reported an error / failure
 * processing – egress hasn't ended (or an unknown status): leave it
 */
export type EgressRecordingOutcome = "check_file" | "failed" | "processing";

export function recordingOutcomeFromEgress(status: unknown, egressError: unknown): EgressRecordingOutcome {
  if (typeof egressError === "string" && egressError.trim()) return "failed";
  const name = egressStatusName(status);
  if (name === "complete" || name === "limit_reached" || name === "aborted") return "check_file";
  if (name === "failed") return "failed";
  return "processing";
}

/**
 * Whether a finalization write may replace the recording's current status.
 * A ready (or deleted) recording is never downgraded, and a failed one is not
 * put back to processing (late or out-of-order webhooks, head-check races).
 */
export function mayApplyRecordingStatus(current: unknown, next: "ready" | "failed" | "processing"): boolean {
  const cur = String(current || "").toLowerCase();
  if (cur === "ready" || cur === "deleted" || cur === "deleting") return false;
  if (cur === "failed" && next !== "ready") return false;
  return true;
}

/** Stuck-recording sweep: re-check after this long in "processing", give up after the second. */
export const STUCK_RECHECK_AFTER_MS = 10 * 60 * 1000;
export const STUCK_GIVE_UP_AFTER_MS = 6 * 60 * 60 * 1000;

export function stuckRecordingAction(
  processingSinceMs: number | null,
  nowMs: number
): "wait" | "recheck" | "recheck_or_fail" {
  if (processingSinceMs === null) return "recheck";
  const age = nowMs - processingSinceMs;
  if (age < STUCK_RECHECK_AFTER_MS) return "wait";
  return age >= STUCK_GIVE_UP_AFTER_MS ? "recheck_or_fail" : "recheck";
}

/**
 * One recording at a time per room (audit P1-4). recordingLocks/{roomId}
 * points at the latest recording started in the room; a new start is refused
 * while that recording is still starting/recording. No explicit release: a
 * lock whose recording ended (or whose start never created a doc) is stale.
 */
export const LOCK_INFLIGHT_MS = 2 * 60 * 1000;
export const LOCK_STARTING_STALE_MS = 5 * 60 * 1000;

export function recordingLockBlocks(
  lock: { recordingId?: unknown; claimedAtMs?: unknown } | null,
  recording: { status?: unknown; updatedAtMs?: number | null } | null,
  nowMs: number
): boolean {
  if (!lock || typeof lock.recordingId !== "string" || !lock.recordingId) return false;
  if (!recording) {
    // Start in flight (doc not created yet) — e.g. a double click.
    const claimed = Number(lock.claimedAtMs);
    return Number.isFinite(claimed) && nowMs - claimed < LOCK_INFLIGHT_MS;
  }
  const status = String(recording.status || "").toLowerCase();
  if (status === "recording") return true;
  if (status === "starting") {
    const at = recording.updatedAtMs;
    return typeof at !== "number" || nowMs - at < LOCK_STARTING_STALE_MS;
  }
  return false;
}

/**
 * The recording a reloaded host page should adopt (audit P1-3): the room's
 * lock points at it, it belongs to this room and it is actually recording.
 * "starting" is not adopted — it has no egress to stop yet and either becomes
 * "recording" or is cleaned up by the stuck-recordings job.
 */
export function activeRecordingFromLock(
  lock: { recordingId?: unknown } | null,
  recording: { roomId?: unknown; status?: unknown; startedAtMs?: number | null } | null,
  roomId: string
): { recordingId: string; startedAtMs: number | null } | null {
  if (!lock || typeof lock.recordingId !== "string" || !lock.recordingId) return null;
  if (!recording) return null;
  if (typeof recording.roomId === "string" && recording.roomId && recording.roomId !== roomId) return null;
  if (String(recording.status || "").toLowerCase() !== "recording") return null;
  const startedAtMs = typeof recording.startedAtMs === "number" && Number.isFinite(recording.startedAtMs) ? recording.startedAtMs : null;
  return { recordingId: lock.recordingId, startedAtMs };
}
