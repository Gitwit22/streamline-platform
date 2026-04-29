/**
 * Processing Queue — Firestore-backed job queue for background asset processing
 *
 * Follows the same pattern as exportQueue.ts: zero-infra, Firestore-backed,
 * transactional claim semantics.
 *
 * Supported job types:
 *   - thumbnail   — generate a poster frame from a video asset
 *   - waveform    — extract audio waveform data for the timeline UI
 *   - transcription — speech-to-text transcription
 *
 * Lifecycle:
 *   asset created / media uploaded
 *     → enqueueProcessingJob(...)
 *       → status: "queued"
 *   worker picks up job
 *     → status: "processing"
 *   worker finishes
 *     → status: "completed" | "failed"
 *
 * UI can poll GET /api/editing/processing/:jobId for progress.
 */

import { firestore as db } from "../firebaseAdmin";
import { logger } from "./logger";

// ── Types ───────────────────────────────────────────────────────────────────

export type ProcessingJobType = "thumbnail" | "waveform" | "transcription";
export type ProcessingJobStatus = "queued" | "processing" | "completed" | "failed";

export interface ProcessingJobDoc {
  id: string;
  userId: string;
  projectId: string;
  assetId: string;
  type: ProcessingJobType;
  status: ProcessingJobStatus;
  progressPercent: number;
  currentStep: string | null;
  errorMessage: string | null;
  attemptCount: number;
  outputUrl: string | null;
  outputPath: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

const COLLECTION = "processing_jobs";
const MAX_ERROR_MESSAGE_LENGTH = 500;

// ── Write helpers ───────────────────────────────────────────────────────────

/** Enqueue a new processing job. Returns the full doc. */
export async function enqueueProcessingJob(params: {
  userId: string;
  projectId: string;
  assetId: string;
  type: ProcessingJobType;
}): Promise<ProcessingJobDoc> {
  const ref = db.collection(COLLECTION).doc();
  const now = new Date();

  const doc: ProcessingJobDoc = {
    id: ref.id,
    userId: params.userId,
    projectId: params.projectId,
    assetId: params.assetId,
    type: params.type,
    status: "queued",
    progressPercent: 0,
    currentStep: "Waiting in queue",
    errorMessage: null,
    attemptCount: 0,
    outputUrl: null,
    outputPath: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
  };

  await ref.set(doc);
  return doc;
}

/** Update processing job fields. Merges with existing document. */
export async function updateProcessingJob(
  jobId: string,
  patch: Partial<Pick<
    ProcessingJobDoc,
    | "status"
    | "progressPercent"
    | "currentStep"
    | "errorMessage"
    | "attemptCount"
    | "outputUrl"
    | "outputPath"
    | "startedAt"
    | "completedAt"
  >>,
): Promise<void> {
  await db.collection(COLLECTION).doc(jobId).set(patch, { merge: true });
}

/** Fetch a single processing job by ID. */
export async function getProcessingJob(jobId: string): Promise<ProcessingJobDoc | null> {
  const snap = await db.collection(COLLECTION).doc(jobId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() } as ProcessingJobDoc;
}

/** List processing jobs for a specific asset. */
export async function listAssetProcessingJobs(
  assetId: string,
): Promise<ProcessingJobDoc[]> {
  const snap = await db
    .collection(COLLECTION)
    .where("assetId", "==", assetId)
    .orderBy("createdAt", "desc")
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ProcessingJobDoc));
}

/** List processing jobs for a specific project. */
export async function listProjectProcessingJobs(
  projectId: string,
): Promise<ProcessingJobDoc[]> {
  const snap = await db
    .collection(COLLECTION)
    .where("projectId", "==", projectId)
    .orderBy("createdAt", "desc")
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ProcessingJobDoc));
}

// ── Queue polling ───────────────────────────────────────────────────────────

/**
 * Claim the oldest queued processing job (FIFO). Uses a Firestore transaction
 * to prevent two workers from claiming the same job.
 */
export async function claimNextProcessingJob(): Promise<ProcessingJobDoc | null> {
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
      if (data.status !== "queued") return null;

      txn.update(ref, {
        status: "processing",
        currentStep: "Starting",
        startedAt: now,
        attemptCount: (data.attemptCount || 0) + 1,
      });

      return {
        id: freshSnap.id,
        ...data,
        status: "processing" as ProcessingJobStatus,
        currentStep: "Starting",
        startedAt: now,
        attemptCount: (data.attemptCount || 0) + 1,
      } as ProcessingJobDoc;
    });

    return claimed;
  } catch (err) {
    logger.warn({ err: (err as any)?.message, jobId: docSnap.id }, "Failed to claim processing job");
    return null;
  }
}

/** Mark a processing job as failed (terminal). */
export async function failProcessingJob(jobId: string, errorMessage: string): Promise<void> {
  await updateProcessingJob(jobId, {
    status: "failed",
    currentStep: "Failed",
    errorMessage: (errorMessage || "Unknown error").slice(0, MAX_ERROR_MESSAGE_LENGTH),
    completedAt: new Date(),
  });
}

/** Mark a processing job as completed. */
export async function completeProcessingJob(
  jobId: string,
  outputUrl: string,
  outputPath: string,
): Promise<void> {
  await updateProcessingJob(jobId, {
    status: "completed",
    progressPercent: 100,
    currentStep: "Complete",
    outputUrl,
    outputPath,
    completedAt: new Date(),
  });
}

// ── Convenience: enqueue standard jobs for a new asset ──────────────────────

/**
 * Enqueue the standard set of background processing jobs for a newly created
 * or uploaded asset. Call this after the asset is written to Firestore.
 */
export async function enqueueStandardJobs(params: {
  userId: string;
  projectId: string;
  assetId: string;
}): Promise<ProcessingJobDoc[]> {
  const types: ProcessingJobType[] = ["thumbnail", "waveform", "transcription"];
  const jobs: ProcessingJobDoc[] = [];

  for (const type of types) {
    const job = await enqueueProcessingJob({ ...params, type });
    jobs.push(job);
  }

  return jobs;
}
