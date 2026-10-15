import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_KIT_VIDEO,
  buildProgramOverlay,
  mergeOverlayIntoMetadata,
  mergeRoomMetadata,
  normalizeKitVideo,
  parseKitVideoInput,
} from "./programOverlayPure";
import { requiredKitFeatures } from "./brandKitsPure";
import { normalizePlanDoc } from "./entitlements/normalizePlanV2";

test("parseKitVideoInput validates each field", () => {
  assert.deepEqual(parseKitVideoInput(undefined), { ok: true, value: {} });
  assert.equal(parseKitVideoInput("x").ok, false);
  assert.equal(parseKitVideoInput({ logoPosition: "center" }).field, "video.logoPosition");
  assert.equal(parseKitVideoInput({ logoSize: 2 }).field, "video.logoSize");
  assert.equal(parseKitVideoInput({ logoSize: "12" }).field, "video.logoSize");
  assert.equal(parseKitVideoInput({ logoOpacity: 1.5 }).field, "video.logoOpacity");
  assert.equal(parseKitVideoInput({ backgroundColor: "red" }).field, "video.backgroundColor");
  assert.equal(parseKitVideoInput({ backgroundImageUrl: "javascript:alert(1)" }).field, "video.backgroundImageUrl");
  assert.equal(parseKitVideoInput({ showLogo: "yes" }).field, "video.showLogo");
  assert.deepEqual(
    parseKitVideoInput({ showLogo: true, logoPosition: "bottom-left", logoSize: 10.4, logoOpacity: 0.555, backgroundColor: " #AABBCC " }),
    { ok: true, value: { showLogo: true, logoPosition: "bottom-left", logoSize: 10, logoOpacity: 0.56, backgroundColor: "#aabbcc" } }
  );
});

test("normalizeKitVideo fills defaults and drops bad stored values", () => {
  assert.deepEqual(normalizeKitVideo(undefined), DEFAULT_KIT_VIDEO);
  const v = normalizeKitVideo({ showLogo: true, logoSize: 999, backgroundColor: "#112233" });
  assert.equal(v.showLogo, true);
  assert.equal(v.logoSize, DEFAULT_KIT_VIDEO.logoSize);
  assert.equal(v.backgroundColor, "#112233");
});

test("buildProgramOverlay draws only what the kit turns on", () => {
  assert.equal(buildProgramOverlay(null), null);
  // Old kits (no video settings) draw nothing.
  assert.equal(buildProgramOverlay({ logoUrl: "https://x.example/l.png" }), null);
  // Logo on, but no logo image: nothing to draw.
  assert.equal(buildProgramOverlay({ logoUrl: "", video: { showLogo: true } }), null);
  assert.deepEqual(buildProgramOverlay({ logoUrl: "https://x.example/l.png", video: { showLogo: true, logoPosition: "top-left" } }), {
    v: 1,
    logo: { url: "https://x.example/l.png", position: "top-left", size: 12, opacity: 0.9 },
    background: null,
    lowerThird: null,
    banner: null,
  });
  assert.deepEqual(buildProgramOverlay({ logoUrl: "", video: { backgroundColor: "#000000" } }), {
    v: 1,
    logo: null,
    background: { color: "#000000", imageUrl: "" },
    lowerThird: null,
    banner: null,
  });
});

test("mergeOverlayIntoMetadata keeps programState and refuses non-object metadata", () => {
  const ps = { version: 2, landscape: { presetId: "solo" } };
  const overlay = buildProgramOverlay({ logoUrl: "", video: { backgroundColor: "#101010" } });
  const merged = JSON.parse(mergeOverlayIntoMetadata(JSON.stringify({ programState: ps }), overlay)!);
  assert.deepEqual(merged.programState, ps);
  assert.equal(merged.programOverlay.background.color, "#101010");
  const cleared = JSON.parse(mergeOverlayIntoMetadata(JSON.stringify(merged), null)!);
  assert.equal(cleared.programOverlay, null);
  assert.deepEqual(cleared.programState, ps);
  assert.equal(mergeOverlayIntoMetadata("not json", overlay), null);
  assert.equal(mergeOverlayIntoMetadata("[1]", overlay), null);
  assert.equal(JSON.parse(mergeOverlayIntoMetadata("", overlay)!).programOverlay.v, 1);
});

test("requiredKitFeatures: viewer fields need hlsCustomization, video needs roomBranding", () => {
  const v = (o: object = {}) => ({ ...DEFAULT_KIT_VIDEO, ...o });
  // Create with only a name: either feature is enough.
  assert.deepEqual(requiredKitFeatures(null, { name: "K", title: "", theme: "dark" }, v()), { features: [], any: true });
  assert.deepEqual(requiredKitFeatures(null, { name: "K", title: "Show" }, v()).features, ["hlsCustomization"]);
  assert.deepEqual(requiredKitFeatures(null, { name: "K" }, v({ backgroundColor: "#000000" })).features, ["roomBranding"]);
  const existing = { title: "Show", logoUrl: "https://a.example/l.png", theme: "dark", video: { showLogo: true } };
  // Unchanged echo of the stored kit: rename only.
  assert.equal(requiredKitFeatures(existing, { name: "New", title: "Show", theme: "dark" }, v({ showLogo: true })).any, true);
  // The logo is shared by the viewer page and the video: either feature may change it.
  assert.deepEqual(requiredKitFeatures(existing, { logoUrl: "https://b.example/l.png" }, v({ showLogo: true })), {
    features: [],
    any: true,
  });
  assert.deepEqual(
    requiredKitFeatures(existing, { title: "Other", logoUrl: "https://b.example/l.png" }, v({ showLogo: false })).features,
    ["hlsCustomization", "roomBranding"]
  );
});

test("roomBranding defaults to the plan's hlsCustomization when the plan doesn't set it", () => {
  const v2 = (features: object) => normalizePlanDoc("p", { limitsVersion: 2, features, limits: {} }).features.roomBranding;
  assert.equal(v2({ hlsCustomization: true }), true);
  assert.equal(v2({ hlsCustomization: false }), false);
  assert.equal(v2({ hlsCustomization: true, roomBranding: false }), false);
  assert.equal(v2({ hlsCustomization: false, roomBranding: true }), true);
  // Legacy (v1) docs: same inheritance.
  assert.equal(normalizePlanDoc("legacy", { features: { hlsCustomization: true } }).features.roomBranding, true);
  assert.equal(normalizePlanDoc("legacy", { features: { hlsCustomization: false } }).features.roomBranding, false);
});

test("mergeRoomMetadata sets only the given keys and keeps the rest", () => {
  const base = JSON.stringify({ programState: { v: 1 }, programOverlay: { logo: "a" }, other: 1 });
  assert.deepEqual(JSON.parse(mergeRoomMetadata(base, { programState: { v: 2 } })!), {
    programState: { v: 2 },
    programOverlay: { logo: "a" },
    other: 1,
  });
  assert.deepEqual(JSON.parse(mergeRoomMetadata(base, { programState: { v: 3 }, programOverlay: null })!), {
    programState: { v: 3 },
    programOverlay: null,
    other: 1,
  });
  assert.deepEqual(JSON.parse(mergeRoomMetadata("", { programOverlay: null })!), { programOverlay: null });
  assert.equal(mergeRoomMetadata("[1]", { programState: {} }), null);
  assert.equal(mergeRoomMetadata("not json", { programState: {} }), null);
});
