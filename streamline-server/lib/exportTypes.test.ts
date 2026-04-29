// Tests for export types helpers
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolutionToDimensions,
  formatToContainer,
  normalizeExportSettings,
} from "./exportTypes.js";

describe("resolutionToDimensions", () => {
  it("returns 720p for undefined", () => {
    const r = resolutionToDimensions(undefined);
    assert.equal(r.width, 1280);
    assert.equal(r.height, 720);
  });

  it("returns 720p for unknown string", () => {
    const r = resolutionToDimensions("banana");
    assert.equal(r.width, 1280);
    assert.equal(r.height, 720);
  });

  it("returns 1080p", () => {
    const r = resolutionToDimensions("1080p");
    assert.equal(r.width, 1920);
    assert.equal(r.height, 1080);
  });

  it("returns 4k", () => {
    const r = resolutionToDimensions("4k");
    assert.equal(r.width, 3840);
    assert.equal(r.height, 2160);
  });
});

describe("formatToContainer", () => {
  it("defaults to mp4", () => {
    assert.equal(formatToContainer(undefined), "mp4");
    assert.equal(formatToContainer("xyz"), "mp4");
  });

  it("returns webm", () => {
    assert.equal(formatToContainer("webm"), "webm");
  });

  it("returns mov", () => {
    assert.equal(formatToContainer("mov"), "mov");
  });
});

describe("normalizeExportSettings", () => {
  it("normalises undefined to safe defaults", () => {
    const s = normalizeExportSettings(undefined);
    assert.equal(s.resolution, "720p");
    assert.equal(s.format, "mp4");
    assert.equal(s.quality, "standard");
  });

  it("normalises garbage values to defaults", () => {
    const s = normalizeExportSettings({ resolution: "xxx", format: 42, quality: null });
    assert.equal(s.resolution, "720p");
    assert.equal(s.format, "mp4");
    assert.equal(s.quality, "standard");
  });

  it("preserves valid values", () => {
    const s = normalizeExportSettings({ resolution: "4k", format: "webm", quality: "high" });
    assert.equal(s.resolution, "4k");
    assert.equal(s.format, "webm");
    assert.equal(s.quality, "high");
  });

  it("preserves 1080p / mov / draft combo", () => {
    const s = normalizeExportSettings({ resolution: "1080p", format: "mov", quality: "draft" });
    assert.equal(s.resolution, "1080p");
    assert.equal(s.format, "mov");
    assert.equal(s.quality, "draft");
  });
});
