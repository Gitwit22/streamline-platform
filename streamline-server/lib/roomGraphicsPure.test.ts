import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_ROOM_GRAPHICS,
  GRAPHICS_LIMITS,
  graphicsChangeNeedsFeature,
  hasActiveGraphics,
  normalizeRoomGraphics,
  parseRoomGraphicsInput,
} from "./roomGraphicsPure";
import { buildProgramOverlay, parseKitVideoInput } from "./programOverlayPure";

const LT = { id: "lt1", name: "Jane Doe", title: "CEO" };
const BN = { id: "bn1", text: "Follow us @streamline", scroll: true };

test("parseRoomGraphicsInput validates items, ids and the active selection", () => {
  assert.deepEqual(parseRoomGraphicsInput({}), { ok: true, value: EMPTY_ROOM_GRAPHICS });
  const ok = parseRoomGraphicsInput({ lowerThirds: [{ ...LT, name: "  Jane Doe " }], banners: [BN], activeLowerThirdId: "lt1" });
  assert.equal(ok.ok, true);
  assert.equal(ok.value!.lowerThirds[0].name, "Jane Doe");
  assert.equal(ok.value!.activeLowerThirdId, "lt1");
  assert.equal(ok.value!.activeBannerId, null);

  assert.equal(parseRoomGraphicsInput({ lowerThirds: [{ id: "a", name: "" }] }).field, "lowerThirds[0].name");
  assert.equal(parseRoomGraphicsInput({ lowerThirds: [{ id: "a b", name: "x" }] }).field, "lowerThirds[0].id");
  assert.equal(parseRoomGraphicsInput({ lowerThirds: [LT], banners: [{ ...BN, id: "lt1" }] }).details, "duplicate id");
  assert.equal(parseRoomGraphicsInput({ banners: [{ id: "b", text: "x".repeat(GRAPHICS_LIMITS.bannerText + 1) }] }).field, "banners[0].text");
  assert.equal(parseRoomGraphicsInput({ banners: [{ id: "b", text: "x", scroll: "yes" }] }).field, "banners[0].scroll");
  assert.equal(parseRoomGraphicsInput({ lowerThirds: [LT], activeLowerThirdId: "nope" }).field, "activeLowerThirdId");
  const many = Array.from({ length: GRAPHICS_LIMITS.items + 1 }, (_, i) => ({ id: `x${i}`, name: "n" }));
  assert.equal(parseRoomGraphicsInput({ lowerThirds: many }).field, "lowerThirds");
});

test("normalizeRoomGraphics tolerates missing or broken stored data", () => {
  assert.deepEqual(normalizeRoomGraphics(undefined), EMPTY_ROOM_GRAPHICS);
  assert.deepEqual(normalizeRoomGraphics({ lowerThirds: "bad" }), EMPTY_ROOM_GRAPHICS);
  assert.equal(hasActiveGraphics({ lowerThirds: [LT], activeLowerThirdId: "lt1", rev: 3 }), true);
  assert.equal(hasActiveGraphics({ lowerThirds: [LT] }), false);
});

test("graphicsChangeNeedsFeature: adding/editing/showing yes, hiding/deleting no", () => {
  const prev = normalizeRoomGraphics({ lowerThirds: [LT], banners: [BN], activeLowerThirdId: "lt1", activeBannerId: "bn1" });
  assert.equal(graphicsChangeNeedsFeature(prev, { ...prev, activeLowerThirdId: null, activeBannerId: null }), false);
  assert.equal(graphicsChangeNeedsFeature(prev, { ...prev, banners: [], activeBannerId: null }), false);
  assert.equal(graphicsChangeNeedsFeature(prev, prev), false);
  assert.equal(graphicsChangeNeedsFeature(prev, { ...prev, lowerThirds: [{ ...LT, title: "CTO" }] }), true);
  const hidden = { ...prev, activeLowerThirdId: null };
  assert.equal(graphicsChangeNeedsFeature(hidden, prev), true);
  assert.equal(graphicsChangeNeedsFeature(EMPTY_ROOM_GRAPHICS, { ...EMPTY_ROOM_GRAPHICS, banners: [BN] }), true);
});

test("buildProgramOverlay adds the visible lower third and banner with the kit accent", () => {
  const graphics = { lowerThirds: [LT], banners: [BN], activeLowerThirdId: "lt1", activeBannerId: "bn1" };
  // Without a kit: default accent, no logo/background.
  const noKit = buildProgramOverlay(null, graphics)!;
  assert.deepEqual(noKit.lowerThird, { name: "Jane Doe", title: "CEO", accent: "#dc2626" });
  assert.deepEqual(noKit.banner, { text: "Follow us @streamline", scroll: true, accent: "#dc2626" });
  assert.equal(noKit.logo, null);
  const withKit = buildProgramOverlay({ logoUrl: "", video: { accentColor: "#0055ff" } }, graphics)!;
  assert.equal(withKit.lowerThird!.accent, "#0055ff");
  // Nothing visible and nothing from the kit: no overlay.
  assert.equal(buildProgramOverlay(null, { lowerThirds: [LT] }), null);
  assert.equal(parseKitVideoInput({ accentColor: "blue" }).field, "video.accentColor");
});
