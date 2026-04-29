/**
 * Tests for processingQueue types.
 *
 * Firestore-dependent functions require a live connection; we only verify the
 * module loads and the type shape compiles correctly.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type {
  ProcessingJobDoc,
  ProcessingJobType,
  ProcessingJobStatus,
} from "./processingQueue.js";

describe("ProcessingJobDoc type shape", () => {
  it("accepts a fully populated thumbnail job", () => {
    const job: ProcessingJobDoc = {
      id: "job_1",
      userId: "user_1",
      projectId: "proj_1",
      assetId: "asset_1",
      type: "thumbnail",
      status: "queued",
      progressPercent: 0,
      currentStep: "Waiting in queue",
      errorMessage: null,
      attemptCount: 0,
      outputUrl: null,
      outputPath: null,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
    };
    assert.equal(job.type, "thumbnail");
    assert.equal(job.status, "queued");
  });

  it("accepts a completed transcription job", () => {
    const now = new Date();
    const job: ProcessingJobDoc = {
      id: "job_2",
      userId: "user_1",
      projectId: "proj_1",
      assetId: "asset_2",
      type: "transcription",
      status: "completed",
      progressPercent: 100,
      currentStep: "Complete",
      errorMessage: null,
      attemptCount: 1,
      outputUrl: "https://example.com/output.json",
      outputPath: "transcripts/job_2.json",
      createdAt: now,
      startedAt: now,
      completedAt: now,
    };
    assert.equal(job.type, "transcription");
    assert.equal(job.status, "completed");
    assert.equal(job.progressPercent, 100);
  });

  it("all job types are valid", () => {
    const types: ProcessingJobType[] = ["thumbnail", "waveform", "transcription"];
    assert.equal(types.length, 3);
  });

  it("all statuses are valid", () => {
    const statuses: ProcessingJobStatus[] = ["queued", "processing", "completed", "failed"];
    assert.equal(statuses.length, 4);
  });
});
