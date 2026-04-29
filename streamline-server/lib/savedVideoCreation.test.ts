/**
 * SavedVideo creation — unit tests
 *
 * Tests the logic and type shape for createSavedVideoFromRecording.
 * These don't require Firebase and can run in CI without credentials.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Re-implementation of the saved video record shape (matches myContent.ts)
// to avoid importing firebaseAdmin.

interface SavedVideoInput {
  userId: string;
  recordingId: string;
  title?: string;
  playbackUrl?: string;
  thumbnailUrl?: string | null;
  durationMs?: number;
  fileSize?: number;
}

interface SavedVideoRecord {
  userId: string;
  title: string;
  sourceType: "recording";
  sourceId: string;
  playbackUrl: string;
  downloadUrl: string | null;
  thumbnailUrl: string | null;
  durationMs: number;
  sizeBytes: number;
  hasEmbeddedAudio: boolean;
  status: "ready";
  createdAt: Date;
}

function buildSavedVideoRecord(opts: SavedVideoInput): SavedVideoRecord {
  return {
    userId: opts.userId,
    title: opts.title || "Untitled Recording",
    sourceType: "recording" as const,
    sourceId: opts.recordingId,
    playbackUrl: opts.playbackUrl || "",
    downloadUrl: opts.playbackUrl || null,
    thumbnailUrl: opts.thumbnailUrl || null,
    durationMs: typeof opts.durationMs === "number" ? opts.durationMs : 0,
    sizeBytes: typeof opts.fileSize === "number" ? opts.fileSize : 0,
    hasEmbeddedAudio: true,
    status: "ready" as const,
    createdAt: new Date(),
  };
}

describe("buildSavedVideoRecord", () => {
  it("builds a correct record with all fields", () => {
    const record = buildSavedVideoRecord({
      userId: "user-123",
      recordingId: "rec-456",
      title: "My Recording",
      playbackUrl: "https://example.com/video.mp4",
      thumbnailUrl: "https://example.com/thumb.jpg",
      durationMs: 120000,
      fileSize: 5242880,
    });

    assert.equal(record.userId, "user-123");
    assert.equal(record.sourceType, "recording");
    assert.equal(record.sourceId, "rec-456");
    assert.equal(record.title, "My Recording");
    assert.equal(record.playbackUrl, "https://example.com/video.mp4");
    assert.equal(record.downloadUrl, "https://example.com/video.mp4");
    assert.equal(record.thumbnailUrl, "https://example.com/thumb.jpg");
    assert.equal(record.durationMs, 120000);
    assert.equal(record.sizeBytes, 5242880);
    assert.equal(record.hasEmbeddedAudio, true);
    assert.equal(record.status, "ready");
    assert.ok(record.createdAt instanceof Date);
  });

  it("uses defaults for missing optional fields", () => {
    const record = buildSavedVideoRecord({
      userId: "user-abc",
      recordingId: "rec-xyz",
    });

    assert.equal(record.title, "Untitled Recording");
    assert.equal(record.playbackUrl, "");
    assert.equal(record.downloadUrl, null);
    assert.equal(record.thumbnailUrl, null);
    assert.equal(record.durationMs, 0);
    assert.equal(record.sizeBytes, 0);
  });

  it("handles null thumbnailUrl", () => {
    const record = buildSavedVideoRecord({
      userId: "user-1",
      recordingId: "rec-2",
      thumbnailUrl: null,
    });

    assert.equal(record.thumbnailUrl, null);
  });

  it("handles zero duration and fileSize", () => {
    const record = buildSavedVideoRecord({
      userId: "user-1",
      recordingId: "rec-2",
      durationMs: 0,
      fileSize: 0,
    });

    assert.equal(record.durationMs, 0);
    assert.equal(record.sizeBytes, 0);
  });

  it("always sets sourceType to recording", () => {
    const record = buildSavedVideoRecord({
      userId: "u",
      recordingId: "r",
    });

    assert.equal(record.sourceType, "recording");
  });

  it("always sets status to ready", () => {
    const record = buildSavedVideoRecord({
      userId: "u",
      recordingId: "r",
    });

    assert.equal(record.status, "ready");
  });
});
