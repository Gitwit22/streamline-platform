// ============================================================================
// Export Queue — Firestore-backed job queue
//
// This is a simple, zero-infra queue that uses Firestore as the backing store.
// Jobs are written with status "queued". A poller picks the oldest queued job,
// atomically transitions it to "preparing", and hands it off to the render
// worker. This avoids adding Redis/BullMQ for now while still providing
// retries, progress, and durable job records.
// ============================================================================

import { firestore as db } from "../firebaseAdmin";
import { logger } from "./logger";
import type { ExportJobDoc, ExportJobStatus, ExportSettingsInput, ExportTimeline } from "./exportTypes";

const COLLECTION = "editing_exports";

// ============================================================================
// Write helpers
// ============================================================================

/** Create a new export job in "queued" state. Returns the document ID. */
export async function createExportJob(params: {
  userId: string;
  projectId: string;
  settings: ExportSettingsInput | null;
  timeline: ExportTimeline | null;
}): Promise<ExportJobDoc> {
  const ref = db.collection(COLLECTION).doc();
  const now = new Date();

  const doc: ExportJobDoc = {
    id: ref.id,
    userId: params.userId,
    projectId: params.projectId,
    status: "queued",
    progressPercent: 0,
    currentStep: "Waiting in queue",
    errorMessage: null,
    attemptCount: 0,
    outputUrl: null,
    outputPath: null,
    settings: params.settings,
    timeline: params.timeline,
    createdAt: now,
    startedAt: null,
    completedAt: null,
  };

  await ref.set(doc);
  return doc;
}

/** Update job fields. Merges with existing document. */
export async function updateExportJob(
  jobId: string,
  patch: Partial<Pick<
    ExportJobDoc,
    | "status"
    | "progressPercent"
    | "currentStep"
    | "errorMessage"
    | "attemptCount"
    | "outputUrl"
    | "outputPath"
    | "startedAt"
    | "completedAt"
  >>
): Promise<void> {
  await db.collection(COLLECTION).doc(jobId).set(patch, { merge: true });
}

/** Fetch a single export job by ID. Returns null if missing. */
export async function getExportJob(jobId: string): Promise<ExportJobDoc | null> {
  const snap = await db.collection(COLLECTION).doc(jobId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() } as ExportJobDoc;
}

// ============================================================================
// Queue polling
// ============================================================================

/**
 * Claim the oldest queued job (FIFO). Uses a Firestore transaction to
 * atomically verify status is still "queued" before transitioning to
 * "preparing", preventing two workers from claiming the same job.
 *
 * Returns null when the queue is empty.
 */
export async function claimNextJob(): Promise<ExportJobDoc | null> {
  const snap = await db
    .collection(COLLECTION)
    .where("status", "==", "queued")
    .orderBy("createdAt", "asc")
    .limit(1)
    .get();

  if (snap.empty) return null;

  const docSnap = snap.docs[0];
  const ref = docSnap.ref;
  const now = new Date();

  try {
    const claimed = await db.runTransaction(async (txn) => {
      const freshSnap = await txn.get(ref);
      if (!freshSnap.exists) return null;
      const data = freshSnap.data() as any;
      if (data.status !== "queued") return null; // another worker claimed it

      txn.update(ref, {
        status: "preparing",
        currentStep: "Downloading assets",
        startedAt: now,
        attemptCount: (data.attemptCount || 0) + 1,
      });

      return {
        id: freshSnap.id,
        ...data,
        status: "preparing" as ExportJobStatus,
        currentStep: "Downloading assets",
        startedAt: now,
        attemptCount: (data.attemptCount || 0) + 1,
      } as ExportJobDoc;
    });

    return claimed;
  } catch (err) {
    logger.warn({ err: (err as any)?.message, jobId: docSnap.id }, "Failed to claim export job");
    return null;
  }
}

/**
 * Mark a job as failed (terminal).
 */
export async function failJob(jobId: string, errorMessage: string): Promise<void> {
  await updateExportJob(jobId, {
    status: "failed",
    currentStep: "Failed",
    errorMessage: (errorMessage || "Unknown error").slice(0, 500),
    completedAt: new Date(),
  });
}

/**
 * Mark a job as completed with output info.
 */
export async function completeJob(jobId: string, outputUrl: string, outputPath: string): Promise<void> {
  await updateExportJob(jobId, {
    status: "completed",
    progressPercent: 100,
    currentStep: "Complete",
    outputUrl,
    outputPath,
    completedAt: new Date(),
  });
}

/**
 * Cancel a job (only if it's still in a non-terminal state).
 */
export async function cancelJob(jobId: string): Promise<boolean> {
  const job = await getExportJob(jobId);
  if (!job) return false;

  const terminalStates: ExportJobStatus[] = ["completed", "failed", "canceled"];
  if (terminalStates.includes(job.status)) return false;

  await updateExportJob(jobId, {
    status: "canceled",
    currentStep: "Canceled",
    completedAt: new Date(),
  });
  return true;
}
