import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedResolutions,
  exportLimitReached,
  normalizeFps,
  parseMaxResolution,
  qualityEncoding,
  readExportLimit,
  readPriorityQueue,
  resolutionAllowed,
} from "./exportPolicyPure";
import { normalizeExportSettings } from "./exportTypes";

test("parseMaxResolution / allowedResolutions: null = no cap, case-insensitive", () => {
  assert.equal(parseMaxResolution(undefined), null);
  assert.equal(parseMaxResolution("4K"), "4k");
  assert.equal(parseMaxResolution("8k"), null);
  assert.deepEqual(allowedResolutions(null), ["720p", "1080p", "4k"]);
  assert.deepEqual(allowedResolutions("1080p"), ["720p", "1080p"]);
  assert.deepEqual(allowedResolutions("720p"), ["720p"]);
  assert.equal(resolutionAllowed("4k", "1080p"), false);
  assert.equal(resolutionAllowed("1080p", "1080p"), true);
});

test("readExportLimit: v2 (null = unlimited, 0 = none) vs legacy (0/missing = unlimited)", () => {
  assert.equal(readExportLimit({ limitsVersion: 2, exportsPerMonth: null }), null);
  assert.equal(readExportLimit({ limitsVersion: 2 }), null);
  assert.equal(readExportLimit({ limitsVersion: 2, exportsPerMonth: 0 }), 0);
  assert.equal(readExportLimit({ limitsVersion: 2, exportsPerMonth: 10.7 }), 10);
  assert.equal(readExportLimit({ exportsPerMonth: 0 }), null);
  assert.equal(readExportLimit({ exportsPerMonth: 5 }), 5);
  assert.equal(readExportLimit({ exportsPerMonth: 5, unlimitedExports: true }), null);
  assert.equal(readExportLimit(undefined), null);
});

test("exportLimitReached + priority + fps", () => {
  assert.equal(exportLimitReached(100, null), false);
  assert.equal(exportLimitReached(0, 0), true);
  assert.equal(exportLimitReached(9, 10), false);
  assert.equal(exportLimitReached(10, 10), true);
  assert.equal(readPriorityQueue({ export: { priorityQueue: true } }), true);
  assert.equal(readPriorityQueue({}), false);
  assert.equal(normalizeFps(60), 60);
  assert.equal(normalizeFps("24"), 24);
  assert.equal(normalizeFps(50), 30);
});

test("qualityEncoding: x264 CRF/preset per quality; VP9 for webm", () => {
  assert.deepEqual(qualityEncoding("draft", "mp4"), { crf: 28, preset: "veryfast" });
  assert.deepEqual(qualityEncoding("standard", "mov"), { crf: 23, preset: "fast" });
  assert.deepEqual(qualityEncoding("high", "mp4"), { crf: 18, preset: "medium" });
  assert.deepEqual(qualityEncoding(undefined, "mp4"), { crf: 23, preset: "fast" });
  assert.deepEqual(qualityEncoding("high", "webm"), { crf: 28 });
});

test("normalizeExportSettings: fps defaults to 30, accepts 24/60", () => {
  assert.equal(normalizeExportSettings({}).fps, 30);
  assert.equal(normalizeExportSettings({ fps: 60 }).fps, 60);
  assert.equal(normalizeExportSettings({ fps: "24" }).fps, 24);
  assert.equal(normalizeExportSettings({ fps: 120 }).fps, 30);
});
