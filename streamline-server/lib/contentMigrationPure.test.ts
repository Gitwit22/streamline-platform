import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  contentItemToSavedVideo,
  countProjectsForLimit,
  planEditingProjectMigration,
  planLayeredTimelineMigration,
  projectNeedsTimeline,
} from "./contentMigrationPure.js";

const now = new Date("2026-10-01T00:00:00Z");

describe("planEditingProjectMigration", () => {
  it("standalone legacy project becomes projects/{sameId} with converted timeline", () => {
    const step = planEditingProjectMigration("ep1", {
      userId: "u1",
      name: "My edit",
      status: "draft",
      createdAt: new Date("2026-01-01"),
      timeline: {
        tracks: 2,
        clips: [{ id: "c1", assetId: "rec1", trackId: "video_1", startTime: 0, duration: 4, inPoint: 0, outPoint: 4, name: "R" }],
      },
    }, now);
    assert.equal(step.action, "create_project");
    assert.equal(step.targetProjectId, "ep1");
    assert.equal(step.ownerId, "u1");
    assert.equal(step.projectCreate?.ownerId, "u1");
    assert.equal(step.projectCreate?.status, "active");
    assert.deepEqual(step.projectCreate?.migratedFrom, { collection: "editing_projects", id: "ep1" });
    assert.equal(step.timeline?.version, 2);
    assert.equal(step.timeline?.clips[0].timelineEnd, 4);
    assert.deepEqual(step.legacyPatch, { migratedToProjectId: "ep1", migratedAt: now });
  });

  it("bridge-linked doc targets the linked projects id", () => {
    const step = planEditingProjectMigration("ep2", { userId: "u1", projectId: "p9", timeline: { clips: [], tracks: 2 } }, now);
    assert.equal(step.action, "migrate_into_linked");
    assert.equal(step.targetProjectId, "p9");
    assert.equal(step.legacyPatch?.migratedToProjectId, "p9");
  });

  it("empty timeline with assetId is seeded with that asset (as the old editor did)", () => {
    const step = planEditingProjectMigration("ep3", { userId: "u1", assetId: "rec7", name: "From rec", timeline: { clips: [], tracks: 2 } }, now, { seedAssetDurationSec: 42 });
    assert.equal(step.timeline?.clips.length, 1);
    assert.equal(step.timeline?.clips[0].assetId, "rec7");
    assert.equal(step.timeline?.clips[0].timelineEnd, 42);
  });

  it("already migrated / ownerless docs are skipped (idempotent re-runs)", () => {
    assert.equal(planEditingProjectMigration("ep4", { userId: "u1", migratedToProjectId: "ep4" }, now).action, "skip_already_migrated");
    assert.equal(planEditingProjectMigration("ep5", { name: "x" }, now).action, "skip_no_owner");
  });
});

describe("planLayeredTimelineMigration (Layer 3)", () => {
  it("maps ms clips through editing_project_assets to saved video ids", () => {
    const t = planLayeredTimelineMigration(
      [
        { id: "tc1", projectAssetId: "pa1", kind: "video", startMs: 1000, endMs: 3000, trimInMs: 500, trimOutMs: 2500, linkGroupId: "lg" },
        { id: "tc2", projectAssetId: "pa1", kind: "audio", startMs: 1000, endMs: 3000, trimInMs: 500, trimOutMs: 2500, linkGroupId: "lg" },
        { id: "tc3", projectAssetId: "missing", kind: "video", startMs: 0, endMs: 1000 },
      ],
      [{ id: "pa1", savedVideoId: "sv1" }],
      new Map([["sv1", "Saved"]]),
    );
    assert.ok(t);
    assert.equal(t!.clips.length, 2);
    assert.deepEqual([t!.clips[0].assetId, t!.clips[0].timelineStart, t!.clips[0].sourceStart], ["sv1", 1, 0.5]);
    assert.equal(t!.clips[1].trackId, "audio_1");
    assert.equal(t!.clips[0].displayName, "Saved");
    assert.equal(planLayeredTimelineMigration([], []), null);
  });
});

describe("projectNeedsTimeline", () => {
  it("true unless a v2 timeline is present", () => {
    assert.equal(projectNeedsTimeline({}), true);
    assert.equal(projectNeedsTimeline({ timeline: { clips: [] } }), true);
    assert.equal(projectNeedsTimeline({ timeline: { version: 2, clips: [], tracks: [] } }), false);
  });
});

describe("contentItemToSavedVideo", () => {
  it("maps a recording reference to a saved_videos row (no storage of its own)", () => {
    const sv = contentItemToSavedVideo("ci1", { userId: "u1", sourceType: "recording", sourceId: "rec1", title: "T", durationMs: 5000, playbackUrl: "https://p" }, now);
    assert.equal(sv?.sourceType, "recording");
    assert.equal(sv?.sourceId, "rec1");
    assert.equal(sv?.sizeBytes, 0);
    assert.equal(sv?.storagePath, undefined);
    assert.deepEqual(sv?.migratedFrom, { collection: "content_items", id: "ci1" });
    assert.equal(contentItemToSavedVideo("x", { userId: "u1" }, now), null);
  });
});

describe("countProjectsForLimit", () => {
  it("counts active projects plus unmigrated, unlinked, non-archived legacy docs", () => {
    assert.equal(
      countProjectsForLimit(3, [{}, { projectId: "p" }, { migratedToProjectId: "x" }, { status: "archived" }, { status: "draft" }]),
      5,
    );
  });
});
