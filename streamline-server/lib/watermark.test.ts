import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeExportSettings, normalizeWatermarkSettings, FORCED_BRAND_MARK } from "./exportTypes.js";
import { readWatermarkAccess } from "./exportPolicyPure.js";
import { buildRenderPlan, watermarkXY } from "./renderPlan.js";
import type { ExportTimeline } from "./exportTypes.js";

describe("watermark settings", () => {
  it("validates text / image watermarks and clamps size + opacity", () => {
    assert.equal(normalizeWatermarkSettings(null), null);
    assert.equal(normalizeWatermarkSettings({ kind: "text", text: "   " }), null);
    assert.equal(normalizeWatermarkSettings({ kind: "image" }), null);
    assert.deepEqual(normalizeWatermarkSettings({ kind: "text", text: "  @mychannel\n ", position: "top-left", sizePct: 99, opacityPct: 1 }), {
      kind: "text", text: "@mychannel", position: "top-left", sizePct: 12, opacityPct: 10,
    });
    assert.deepEqual(normalizeWatermarkSettings({ kind: "image", assetId: "img1", position: "nowhere" }), {
      kind: "image", assetId: "img1", position: "bottom-right", sizePct: 15, opacityPct: 70,
    });
    assert.equal(normalizeWatermarkSettings({ kind: "text", text: "x".repeat(200) })!.text!.length, 60);
    assert.equal(normalizeExportSettings({ watermark: { kind: "text", text: "Hi" } }).watermark!.text, "Hi");
    assert.equal(normalizeExportSettings({}).watermark, undefined);
  });

  it("plan access: custom included unless explicitly off; forced mark only when on", () => {
    assert.deepEqual(readWatermarkAccess(undefined), { custom: true, forced: false });
    assert.deepEqual(readWatermarkAccess({ export: { watermark: false, forcedBrandMark: true } }), { custom: false, forced: true });
    assert.equal(FORCED_BRAND_MARK.text, "Made with Streamline");
  });

  it("positions", () => {
    assert.deepEqual(watermarkXY("top-left", "text"), { x: "(h*0.04)", y: "(h*0.04)" });
    assert.equal(watermarkXY("bottom-right", "image").x, "main_w-overlay_w-(main_h*0.04)");
    assert.equal(watermarkXY("center", "text").y, "(h-text_h)/2");
  });
});

describe("watermark render plan", () => {
  const tl: ExportTimeline = {
    version: 2, width: 1280, height: 720, fps: 30, durationMs: 0,
    tracks: [{ id: "video_1", kind: "video", muted: false, order: 0, clips: [{
      id: "v", assetId: "a", trackId: "video_1", startMs: 0, endMs: 2000, sourceInMs: 0, sourceOutMs: 2000,
      sourceUrl: "", sourceKey: "k", name: "v", kind: "video", mediaType: "video", volume: 1, muted: false, hidden: false, embeddedAudio: true,
    }] }],
  };
  const inputs = new Map([["key:k", { path: "/w/a.mp4", hasVideo: true, hasAudio: true }]]);
  const base = { outputPath: "/tmp/o.mp4", width: 1280, height: 720, fps: 30, container: "mp4" };

  it("image watermark: looped input, scaled to % of width, alpha, overlaid", () => {
    const p = buildRenderPlan(tl, inputs, { ...base, watermarks: [{ kind: "image", path: "/w/logo.png", position: "top-right", sizePct: 10, opacityPct: 50 }] });
    const i = p.args.indexOf("/w/logo.png");
    assert.deepEqual(p.args.slice(i - 5, i + 1), ["-loop", "1", "-t", "2.000", "-i", "/w/logo.png"]);
    assert.match(p.filterComplex, /\[1:v\]scale=128:-2,format=rgba,colorchannelmixer=aa=0\.50\[wmi0\]/);
    assert.match(p.filterComplex, /overlay=x=main_w-overlay_w-\(main_h\*0\.04\):y=\(main_h\*0\.04\)/);
    assert.match(p.filterComplex, /\[wm0\]format=yuv420p\[outv\]/);
  });

  it("text watermark: drawtext reads text from a file with the bundled font", () => {
    const p = buildRenderPlan(tl, inputs, { ...base, watermarks: [{ kind: "text", textFile: "/w/t.txt", fontFile: "/f/Font.ttf", position: "bottom-left", sizePct: 5, opacityPct: 60 }] });
    assert.match(p.filterComplex, /drawtext=fontfile='\/f\/Font\.ttf':textfile='\/w\/t\.txt':expansion=none:fontsize=36:fontcolor=white@0\.60/);
  });

  it("no watermarks: picture ends unchanged", () => {
    const p = buildRenderPlan(tl, inputs, base);
    assert.match(p.filterComplex, /\[bg1\]format=yuv420p\[outv\]/);
  });
});
