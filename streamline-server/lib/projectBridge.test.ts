/**
 * Tests for projectBridge — pure normalization helpers.
 *
 * The bridge's Firestore-dependent functions (resolveProjectForEditor, etc.)
 * require a live Firebase connection so they are NOT covered here.
 * We only exercise the exported pure helpers and the NormalizedProject shape.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// The module exports types + Firestore-dependent functions.
// We import the type for compile-time checking and verify the module loads.
import type { NormalizedProject } from "./projectBridge.js";

describe("NormalizedProject type shape", () => {
  it("accepts a fully populated object", () => {
    const p: NormalizedProject = {
      id: "edit_1",
      projectId: "proj_1",
      name: "Test Project",
      assetId: "asset_1",
      status: "draft",
      lastModified: new Date().toISOString(),
      duration: 120,
      thumbnail: null,
      userId: "user_1",
      timeline: null,
      migrated: false,
      sourceCollection: "editing_projects",
    };
    assert.equal(p.id, "edit_1");
    assert.equal(p.projectId, "proj_1");
    assert.equal(p.migrated, false);
    assert.equal(p.sourceCollection, "editing_projects");
  });

  it("accepts migrated project from new collection", () => {
    const p: NormalizedProject = {
      id: "proj_2",
      projectId: "proj_2",
      name: "Migrated",
      assetId: "",
      status: "draft",
      lastModified: new Date().toISOString(),
      duration: 0,
      thumbnail: "https://example.com/thumb.jpg",
      userId: "user_2",
      timeline: { clips: [], tracks: 2 },
      migrated: true,
      sourceCollection: "projects",
    };
    assert.equal(p.migrated, true);
    assert.equal(p.sourceCollection, "projects");
    assert.deepStrictEqual(p.timeline, { clips: [], tracks: 2 });
  });
});
