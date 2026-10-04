import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSavedVideoFromExport,
  decideSaveExport,
  exportLibraryKey,
  savedVideoIdForExport,
} from "./exportLibraryPure.js";

const job = {
  userId: "u1",
  projectId: "p1",
  status: "completed",
  outputPath: "exports/u1/p1/1700000000.mp4",
  settings: { resolution: "1080p", format: "mp4", quality: "standard" },
  timeline: { durationMs: 12_345, width: 1920, height: 1080, fps: 30 },
  completedAt: new Date("2026-09-01"),
};

describe("save export to library", () => {
  it("allows a completed, unexpired export owned by the caller", () => {
    assert.deepEqual(decideSaveExport(job, "u1"), { ok: true });
  });

  it("is idempotent once saved", () => {
    assert.deepEqual(decideSaveExport({ ...job, savedVideoId: "export_j", outputExpired: true }, "u1"), { ok: true });
  });

  it("rejects other owners, unfinished and expired exports", () => {
    assert.equal((decideSaveExport(job, "u2") as any).status, 403);
    assert.equal((decideSaveExport(null, "u1") as any).status, 404);
    assert.equal((decideSaveExport({ ...job, status: "rendering" }, "u1") as any).status, 409);
    assert.equal((decideSaveExport({ ...job, outputExpired: true }, "u1") as any).status, 410);
    assert.equal((decideSaveExport({ ...job, outputStorageReleased: true }, "u1") as any).status, 410);
    assert.equal((decideSaveExport({ ...job, outputPath: "" }, "u1") as any).status, 409);
  });

  it("uses a stable key under my-content and a deterministic doc id", () => {
    assert.equal(exportLibraryKey("u1", "j1", job.outputPath), "my-content/u1/exports/j1.mp4");
    assert.equal(exportLibraryKey("u1", "j1", "exports/u1/p1/x.WEBM"), "my-content/u1/exports/j1.webm");
    assert.equal(savedVideoIdForExport("j1"), "export_j1");
  });

  it("builds a saved_videos row that owns the bytes and points back to the project", () => {
    const now = new Date("2026-10-01");
    const sv = buildSavedVideoFromExport("j1", job, { storagePath: "my-content/u1/exports/j1.mp4", sizeBytes: 1234.4, title: "Final cut", now });
    assert.equal(sv.userId, "u1");
    assert.equal(sv.sourceType, "export");
    assert.equal(sv.sourceId, "j1");
    assert.equal(sv.sourceProjectId, "p1");
    assert.equal(sv.storagePath, "my-content/u1/exports/j1.mp4");
    assert.equal(sv.sizeBytes, 1234);
    assert.equal(sv.durationMs, 12_345);
    assert.equal(sv.metadata.resolution, "1080p");
    assert.equal(sv.metadata.width, 1920);
    assert.equal(sv.createdAt, now);
  });
});
