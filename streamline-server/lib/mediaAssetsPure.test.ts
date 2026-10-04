import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  inferMediaType,
  mergeMediaAssets,
  projectAssetToMediaAsset,
  publicMediaAsset,
  recordingToMediaAsset,
  savedVideoToMediaAsset,
  uploadToMediaAsset,
} from "./mediaAssetsPure.js";
import { parseProbeOutput } from "./mediaProbe.js";

describe("MediaAsset mapping", () => {
  it("recordings are type recording with stream stats and their storage key", () => {
    const a = recordingToMediaAsset("r1", {
      userId: "u", title: "Show", status: "ready", duration: 90, objectKey: "/recordings/u/r1.mp4",
      roomName: "room", viewerCount: 3, createdAt: new Date("2026-02-01"),
    });
    assert.equal(a.type, "recording");
    assert.equal(a.source, "stream");
    assert.equal(a.storageKey, "recordings/u/r1.mp4");
    assert.equal(a.viewerCount, 3);
    assert.equal(a.duration, 90);
  });

  it("uploads infer video / audio / image", () => {
    assert.equal(uploadToMediaAsset("e1", { type: "audio", name: "vo" }).type, "audio");
    assert.equal(uploadToMediaAsset("e2", { name: "x", storagePath: "uploads/u/a.mp3" }).type, "audio");
    assert.equal(uploadToMediaAsset("e3", { name: "x", mimeType: "image/png" }).type, "image");
    assert.equal(uploadToMediaAsset("e4", { name: "legacy" }).type, "video");
    assert.equal(uploadToMediaAsset("e3", { name: "x", mimeType: "image/png" }).hasAudio, false);
    assert.equal(inferMediaType("application/octet-stream", "clip.wav"), "audio");
  });

  it("saved videos: exports and uploads listed, recording references are not", () => {
    assert.equal(savedVideoToMediaAsset("s1", { sourceType: "recording", sourceId: "r1" }), null);
    const exp = savedVideoToMediaAsset("export_j1", { sourceType: "export", title: "Cut", durationMs: 12_000, sizeBytes: 9, storagePath: "my-content/u/exports/j1.mp4", sourceProjectId: "p1" })!;
    assert.equal(exp.source, "export");
    assert.equal(exp.duration, 12);
    assert.equal(exp.sourceProjectId, "p1");
    assert.equal(savedVideoToMediaAsset("s2", { sourceType: "upload", title: "Up" })!.source, "upload");
  });

  it("merge: one list, deleted dropped, de-duplicated, newest first; storage keys stripped for clients", () => {
    const rec = recordingToMediaAsset("r1", { userId: "u", status: "ready", createdAt: "2026-01-01T00:00:00Z" });
    const del = recordingToMediaAsset("r2", { userId: "u", status: "deleted", createdAt: "2026-05-01T00:00:00Z" });
    const up = uploadToMediaAsset("e1", { userId: "u", name: "u", createdAt: "2026-03-01T00:00:00Z", storagePath: "uploads/u/x.mp4" });
    const dupe = uploadToMediaAsset("e1", { userId: "u", name: "dupe", createdAt: "2026-04-01T00:00:00Z" });
    const sv = savedVideoToMediaAsset("export_j", { userId: "u", sourceType: "export", createdAt: "2026-02-01T00:00:00Z" })!;
    const merged = mergeMediaAssets([rec, del], [up, dupe], [sv]);
    assert.deepEqual(merged.map((a) => a.id), ["e1", "export_j", "r1"]);
    assert.equal(merged[0].name, "u");
    assert.equal("storageKey" in publicMediaAsset(merged[0]), false);
  });

  it("project assets resolve with their key", () => {
    const a = projectAssetToMediaAsset("pa1", { ownerId: "u", filename: "take.mov", storageKey: "projects/u/p/take.mov", type: "upload" });
    assert.equal(a.collection, "project_assets");
    assert.equal(a.storageKey, "projects/u/p/take.mov");
  });
});

describe("parseProbeOutput", () => {
  it("detects audio/video streams (cover art is not video)", () => {
    const p = parseProbeOutput(JSON.stringify({
      format: { duration: "3.5" },
      streams: [{ codec_type: "audio" }, { codec_type: "video", disposition: { attached_pic: 1 } }],
    }));
    assert.deepEqual(p, { durationMs: 3500, hasVideo: false, hasAudio: true });
    assert.equal(parseProbeOutput("not json"), null);
  });
});
