import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildExportTimeline, normalizeTransition, sanitizeEditorTimeline } from "./editorTimeline.js";
import { planClipEffects } from "./renderPlan.js";
import { firstDisallowedTransition, readTransitionAccess, transitionTier } from "./exportPolicyPure.js";
import { sanitizePlanMetaInput } from "./planSeedPure.js";

const track = (id: string, kind: "video" | "audio" = "video") => ({ id, kind, muted: false, order: 0, clips: [] as any[] });
const nc = (id: string, trackId: string, startMs: number, endMs: number, transitionIn?: any, picture = true, audio = true) => ({
  clip: { id, startMs, endMs, transitionIn } as any,
  track: track(trackId) as any,
  durMs: endMs - startMs,
  picture,
  audio,
});

describe("transitions: timeline storage", () => {
  it("normalizeTransition validates type and clamps duration", () => {
    assert.equal(normalizeTransition(null), null);
    assert.equal(normalizeTransition({ type: "wipe", durationMs: 500 }), null);
    assert.deepEqual(normalizeTransition({ type: "fade", durationMs: 50 }), { type: "fade", durationMs: 100 });
    assert.deepEqual(normalizeTransition({ type: "crossfade", durationMs: 99999 }), { type: "crossfade", durationMs: 3000 });
  });

  it("sanitizeEditorTimeline keeps transitions on video clips only; linked audio inherits on export", () => {
    const r = sanitizeEditorTimeline({
      version: 2,
      tracks: [
        { id: "video_1", name: "V", type: "video", order: 0 },
        { id: "audio_1", name: "A", type: "audio", order: 1 },
      ],
      clips: [
        { id: "v1", assetId: "a", trackId: "video_1", type: "video", timelineStart: 0, timelineEnd: 2, sourceStart: 0, sourceEnd: 2, linkedGroupId: "g", transitionIn: { type: "fade", durationMs: 800 } },
        { id: "a1", assetId: "a", trackId: "audio_1", type: "audio", timelineStart: 0, timelineEnd: 2, sourceStart: 0, sourceEnd: 2, linkedGroupId: "g", transitionIn: { type: "fade", durationMs: 800 } },
      ],
    });
    assert.ok(r.ok);
    if (!r.ok) return;
    const v = r.timeline.clips.find((c) => c.id === "v1")!;
    const a = r.timeline.clips.find((c) => c.id === "a1")!;
    assert.deepEqual(v.transitionIn, { type: "fade", durationMs: 800 });
    assert.equal(a.transitionIn, undefined);
    const built = buildExportTimeline(r.timeline, new Map([["a", { sourceKey: "k", mediaType: "video" as const }]]), { width: 1280, height: 720 });
    assert.ok(built.ok);
    if (!built.ok) return;
    const clips = built.timeline.tracks.flatMap((t) => t.clips);
    assert.deepEqual(clips.find((c) => c.id === "a1")!.transitionIn, { type: "fade", durationMs: 800 });
  });
});

describe("transitions: render effects", () => {
  it("fade: alpha fade in; sound fades in over the full duration", () => {
    const fx = planClipEffects([nc("b", "v", 2000, 4000, { type: "fade", durationMs: 1000 })]);
    assert.deepEqual(fx.get("b"), { fadeInMs: 1000, fadeInAlpha: true, fadeOutMs: 0, holdMs: 0, afadeInMs: 1000, afadeOutMs: 0 });
  });

  it("dip_to_black: previous touching clip fades out to black, this one fades in from black (D/2 each)", () => {
    const fx = planClipEffects([nc("a", "v", 0, 2000), nc("b", "v", 2000, 4000, { type: "dip_to_black", durationMs: 1000 })]);
    assert.equal(fx.get("a")!.fadeOutMs, 500);
    assert.equal(fx.get("a")!.afadeOutMs, 500);
    assert.equal(fx.get("b")!.fadeInMs, 500);
    assert.equal(fx.get("b")!.fadeInAlpha, false);
    assert.equal(fx.get("b")!.afadeInMs, 500);
  });

  it("crossfade: previous clip holds its last frame while this clip alpha-fades in", () => {
    const fx = planClipEffects([nc("a", "v", 0, 2000), nc("b", "v", 2000, 4000, { type: "crossfade", durationMs: 1000 })]);
    assert.equal(fx.get("a")!.holdMs, 1000);
    assert.equal(fx.get("b")!.fadeInMs, 1000);
    assert.equal(fx.get("b")!.fadeInAlpha, true);
  });

  it("no touching previous clip (gap / other track): behaves like a fade in; duration clamped to the clip", () => {
    const fx = planClipEffects([nc("a", "v", 0, 1000), nc("b", "v", 1500, 1800, { type: "crossfade", durationMs: 2000 }), nc("c", "other", 1800, 3000)]);
    assert.equal(fx.get("a"), undefined);
    assert.equal(fx.get("b")!.fadeInMs, 300);
    assert.equal(fx.get("b")!.holdMs, 0);
  });
});

describe("transitions: plan tiers", () => {
  it("missing = included; explicit false respected", () => {
    assert.deepEqual(readTransitionAccess(undefined), { basic: true, advanced: true });
    assert.deepEqual(readTransitionAccess({ transitions: { basic: true, advanced: false } }), { basic: true, advanced: false });
    assert.equal(transitionTier("fade"), "basic");
    assert.equal(transitionTier("crossfade"), "advanced");
    const clips = [{ transitionIn: { type: "fade" } }, { transitionIn: { type: "crossfade" } }];
    assert.equal(firstDisallowedTransition(clips, { basic: true, advanced: false }), "crossfade");
    assert.equal(firstDisallowedTransition(clips, { basic: true, advanced: true }), null);
    assert.equal(firstDisallowedTransition([{}], { basic: false, advanced: false }), null);
  });

  it("admin can save transition tiers", () => {
    const ok = sanitizePlanMetaInput({ editing: { transitions: { basic: true, advanced: false } } });
    assert.deepEqual(ok.meta.editing, { transitions: { basic: true, advanced: false } });
    assert.equal(sanitizePlanMetaInput({ editing: { transitions: { basic: "yes" } } }).errors.length, 1);
  });
});
