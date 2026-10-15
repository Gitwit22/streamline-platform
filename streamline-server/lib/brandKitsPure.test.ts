import test from "node:test";
import assert from "node:assert/strict";
import {
  BRAND_KIT_LIMITS,
  chooseChannelBranding,
  kitBrandingForRoom,
  overlayKitOnHlsConfig,
  parseBrandKitInput,
  pickCreateBrandKit,
  roomBrandKitId,
  serializeBrandKit,
} from "./brandKitsPure";

test("parseBrandKitInput: create requires a name and fills defaults", () => {
  assert.equal(parseBrandKitInput({}, { partial: false }).field, "name");
  assert.equal(parseBrandKitInput({ name: "   " }, { partial: false }).field, "name");
  const r = parseBrandKitInput({ name: "  Main  ", title: " Show " }, { partial: false });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    name: "Main",
    title: "Show",
    subtitle: "",
    logoUrl: "",
    offlineMessage: "",
    theme: "dark",
  });
});

test("parseBrandKitInput: reuses the viewer branding limits and logo URL rule", () => {
  assert.equal(parseBrandKitInput({ name: "x".repeat(BRAND_KIT_LIMITS.name + 1) }, { partial: false }).field, "name");
  assert.equal(parseBrandKitInput({ name: "a", title: "x".repeat(81) }, { partial: false }).field, "title");
  assert.equal(parseBrandKitInput({ name: "a", logoUrl: "javascript:alert(1)" }, { partial: false }).field, "logoUrl");
  assert.equal(parseBrandKitInput({ name: "a", theme: "neon" }, { partial: false }).field, "theme");
  assert.equal(parseBrandKitInput({ name: "a", subtitle: 5 }, { partial: false }).field, "subtitle");
});

test("parseBrandKitInput: update only returns provided fields", () => {
  const r = parseBrandKitInput({ theme: "light" }, { partial: true });
  assert.deepEqual(r, { ok: true, value: { theme: "light" } });
  assert.equal(parseBrandKitInput({ name: "" }, { partial: true }).field, "name");
});

test("kitBrandingForRoom only applies a kit to its owner's rooms", () => {
  const kit = { ownerId: "u1", title: "T", logoUrl: "javascript:x", theme: "light" };
  assert.equal(kitBrandingForRoom(kit, { ownerId: "u2" }), null);
  assert.equal(kitBrandingForRoom(kit, {}), null);
  assert.equal(kitBrandingForRoom({ title: "T" }, { ownerId: "" }), null);
  assert.deepEqual(kitBrandingForRoom(kit, { ownerId: "u1" }), {
    title: "T",
    subtitle: "",
    logoUrl: "",
    offlineMessage: "",
    theme: "light",
  });
});

test("roomBrandKitId ignores missing or path-like ids", () => {
  assert.equal(roomBrandKitId({}), "");
  assert.equal(roomBrandKitId({ brandKitId: null }), "");
  assert.equal(roomBrandKitId({ brandKitId: "a/b" }), "");
  assert.equal(roomBrandKitId({ brandKitId: " k1 " }), "k1");
});

test("chooseChannelBranding: live room kit > home kit > legacy channel branding", () => {
  const b = (title: string) => ({ title, subtitle: "", logoUrl: "", offlineMessage: "", theme: "dark" as const });
  assert.equal(chooseChannelBranding({ activeRoomKit: null, homeRoomKit: null, homeLegacy: null }), null);
  assert.equal(chooseChannelBranding({ activeRoomKit: null, homeRoomKit: null, homeLegacy: b("L") })!.title, "L");
  assert.equal(chooseChannelBranding({ activeRoomKit: null, homeRoomKit: b("H"), homeLegacy: b("L") })!.title, "H");
  assert.equal(chooseChannelBranding({ activeRoomKit: b("A"), homeRoomKit: b("H"), homeLegacy: b("L") })!.title, "A");
});

test("overlayKitOnHlsConfig keeps enabled and replaces branding fields", () => {
  const cfg = { enabled: true, title: "old", subtitle: "old sub" };
  assert.equal(overlayKitOnHlsConfig(cfg, null), cfg);
  const out = overlayKitOnHlsConfig(cfg, { title: "new", subtitle: "", logoUrl: "", offlineMessage: "", theme: "dark" });
  assert.equal(out.enabled, true);
  assert.equal(out.title, "new");
  assert.equal(out.subtitle, "");
});

test("pickCreateBrandKit: default when unspecified, none when cleared, explicit otherwise", () => {
  assert.deepEqual(pickCreateBrandKit(undefined, "k1"), { source: "default", kitId: "k1" });
  assert.deepEqual(pickCreateBrandKit(undefined, undefined), { source: "none", kitId: "" });
  assert.deepEqual(pickCreateBrandKit(null, "k1"), { source: "none", kitId: "" });
  assert.deepEqual(pickCreateBrandKit("", "k1"), { source: "none", kitId: "" });
  assert.deepEqual(pickCreateBrandKit("k2", "k1"), { source: "explicit", kitId: "k2" });
  assert.equal(pickCreateBrandKit(42, "k1").source, "invalid");
  assert.equal(pickCreateBrandKit("a/b", "k1").source, "invalid");
});

test("serializeBrandKit normalizes stored documents", () => {
  const out = serializeBrandKit("k1", { name: "", theme: "weird", updatedAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(out.name, "Untitled kit");
  assert.equal(out.theme, "dark");
  assert.equal(out.updatedAt, "2026-01-01T00:00:00.000Z");
});
