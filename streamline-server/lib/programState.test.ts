import test from "node:test";
import assert from "node:assert/strict";

import {
  applyProgramStatePatch,
  upgradeProgramState,
  normalizeFracSlot,
  normalizeOrientationLayout,
  normalizeProgramStateV2Patch,
  normalizeProgramState,
  pxSlotToFrac,
  fracSlotToPx,
  isV2Body,
} from "./programState";
import { buildOrientationLayout } from "./programPresets";

const NOW = 1_700_000_000_000;

test("normalizeFracSlot clamps fractions and preserves source/fit/label/z", () => {
  const r = normalizeFracSlot({
    id: " s1 ",
    x: -0.2,
    y: 0.5,
    w: 2,
    h: 0.9,
    z: 3.4,
    fit: "contain",
    label: false,
    source: { kind: "participant", identity: " u1 ", track: "screen" },
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.value, {
    id: "s1",
    x: 0,
    y: 0.5,
    w: 1,
    h: 0.5,
    z: 3,
    fit: "contain",
    label: false,
    source: { kind: "participant", identity: "u1", track: "screen" },
  });
});

test("normalizeFracSlot rejects bad geometry / ids / sources; defaults missing source to auto", () => {
  assert.equal(normalizeFracSlot({ id: "a", x: 0, y: 0, w: 0, h: 1 }).ok, false);
  assert.equal(normalizeFracSlot({ id: "a", x: 1, y: 0, w: 0.5, h: 1 }).ok, false);
  assert.equal(normalizeFracSlot({ id: "a", x: "0", y: 0, w: 1, h: 1 }).ok, false);
  assert.equal(normalizeFracSlot({ id: "", x: 0, y: 0, w: 1, h: 1 }).ok, false);
  assert.equal(normalizeFracSlot({ id: "a", x: 0, y: 0, w: 1, h: 1, source: { kind: "magic" } }).ok, false);
  assert.equal(
    normalizeFracSlot({ id: "a", x: 0, y: 0, w: 1, h: 1, source: { kind: "participant", identity: "x".repeat(129), track: "camera" } }).ok,
    false,
  );
  assert.equal(
    normalizeFracSlot({ id: "a", x: 0, y: 0, w: 1, h: 1, source: { kind: "participant", identity: "u", track: "mic" } }).ok,
    false,
  );
  const ok = normalizeFracSlot({ id: "a", x: 0, y: 0, w: 1, h: 1, fit: "stretch", label: "yes" });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.value, { id: "a", x: 0, y: 0, w: 1, h: 1, source: { kind: "auto" } });
});

test("normalizeOrientationLayout enforces max 9 slots and unique ids", () => {
  const slot = (i: number) => ({ id: `s${i}`, x: 0, y: 0, w: 0.1, h: 0.1, source: { kind: "auto" } });
  assert.ok(normalizeOrientationLayout({ presetId: "custom", slots: Array.from({ length: 9 }, (_, i) => slot(i)) }).ok);
  const tooMany = normalizeOrientationLayout({ presetId: "custom", slots: Array.from({ length: 10 }, (_, i) => slot(i)) });
  assert.deepEqual(tooMany, { ok: false, error: "too_many_slots" });
  assert.deepEqual(normalizeOrientationLayout({ presetId: "custom", slots: [slot(1), slot(1)] }), {
    ok: false,
    error: "duplicate_slot_id",
  });
  assert.equal(normalizeOrientationLayout({ presetId: "", slots: [] }).ok, false);
  assert.equal(normalizeOrientationLayout({ presetId: "x" }).ok, false);
  assert.ok(normalizeOrientationLayout({ presetId: "custom", slots: [] }).ok);
});

test("normalizeProgramStateV2Patch", () => {
  assert.equal(normalizeProgramStateV2Patch({ version: 2 }).ok, false);
  assert.equal(normalizeProgramStateV2Patch({ screenShareMode: "sometimes" }).ok, false);
  const r = normalizeProgramStateV2Patch({ screenShareMode: "manual" });
  assert.ok(r.ok && r.value.screenShareMode === "manual");
  const bad = normalizeProgramStateV2Patch({ landscape: { presetId: "x", slots: [{ id: "a" }] } });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.error, /^landscape:/);
  assert.equal(isV2Body({ programLayout: "solo" }), false);
  assert.equal(isV2Body({ version: 2 }), true);
  assert.equal(isV2Body({ landscape: {} }), true);
});

test("px <-> fraction conversion round-trips on the 1280×720 canvas", () => {
  const f = pxSlotToFrac({ id: "a", x: 640, y: 360, width: 640, height: 360, zIndex: 2 });
  assert.deepEqual(f, { id: "a", x: 0.5, y: 0.5, w: 0.5, h: 0.5, z: 2, source: { kind: "auto" } });
  assert.deepEqual(fracSlotToPx(f!), { id: "a", x: 640, y: 360, width: 640, height: 360, zIndex: 2 });
});

test("upgradeProgramState: null → empty landscape (auto grid) + portrait default", () => {
  const s = upgradeProgramState(null, "owner");
  assert.equal(s.version, 2);
  assert.equal(s.hostIdentity, "owner");
  assert.equal(s.screenShareMode, "auto");
  assert.deepEqual(s.landscape.slots, []);
  assert.equal(s.portrait.presetId, "stack_2");
  assert.equal(s.programLayout, s.landscape.presetId);
});

test("upgradeProgramState: legacy v1 preset id → v2 preset (+ portrait) with legacy mirror", () => {
  const s = upgradeProgramState(
    {
      programLayout: "side_by_side",
      programSlots: [
        { id: "slot1", x: 0, y: 0, width: 640, height: 720, zIndex: 1 },
        { id: "slot2", x: 640, y: 0, width: 640, height: 720, zIndex: 1 },
      ],
      programParticipants: ["a", "b"],
      programMode: "interview",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    "owner",
  );
  assert.deepEqual(s.landscape, buildOrientationLayout("side_by_side", "landscape"));
  assert.equal(s.portrait.presetId, "stack_2");
  assert.deepEqual(s.programParticipants, ["a", "b"]);
  assert.equal(s.programMode, "interview");
  assert.equal(s.updatedAt, Date.parse("2024-01-01T00:00:00.000Z"));
  assert.equal(s.programSlots.length, 2);
});

test("upgradeProgramState: legacy custom px slots → fractional auto slots", () => {
  const s = upgradeProgramState(
    { programLayout: "custom", programSlots: [{ id: "x", x: 0, y: 0, width: 1280, height: 360, zIndex: 1 }] },
    null,
  );
  assert.equal(s.landscape.presetId, "custom");
  assert.deepEqual(s.landscape.slots, [{ id: "x", x: 0, y: 0, w: 1, h: 0.5, z: 1, source: { kind: "auto" } }]);
});

test("upgradeProgramState: stored v2 is kept (source preserved); hostIdentity comes from the room", () => {
  const stored = {
    version: 2,
    landscape: {
      presetId: "custom",
      slots: [{ id: "a", x: 0, y: 0, w: 1, h: 1, source: { kind: "participant", identity: "g1", track: "screen" } }],
    },
    portrait: buildOrientationLayout("stack_3", "portrait"),
    screenShareMode: "manual",
    hostIdentity: "stale",
    updatedAt: 5,
  };
  const s = upgradeProgramState(stored, "owner");
  assert.deepEqual(s.landscape.slots[0].source, { kind: "participant", identity: "g1", track: "screen" });
  assert.equal(s.portrait.presetId, "stack_3");
  assert.equal(s.screenShareMode, "manual");
  assert.equal(s.hostIdentity, "owner");
  assert.equal(s.updatedAt, 5);
  assert.deepEqual(s.programParticipants, ["g1"]);
});

test("applyProgramStatePatch: v2 landscape without portrait derives portrait via portraitFor", () => {
  const r = applyProgramStatePatch(
    null,
    { version: 2, landscape: buildOrientationLayout("screen_focus", "landscape") },
    "owner",
    NOW,
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.landscape.presetId, "screen_focus");
  assert.equal(r.value.landscape.slots[0].source.kind, "auto-screen");
  assert.equal(r.value.portrait.presetId, "screenshare_facecam");
  assert.equal(r.value.hostIdentity, "owner");
  assert.equal(r.value.updatedAt, NOW);
  assert.equal(r.value.programLayout, "screen_focus");
  assert.deepEqual(r.value.programSlots[0], { id: "screen", x: 0, y: 0, width: 1024, height: 720, zIndex: 1 });
});

test("applyProgramStatePatch: explicit portrait kept; screenShareMode-only patch keeps layouts", () => {
  const first = applyProgramStatePatch(
    null,
    {
      version: 2,
      landscape: buildOrientationLayout("grid_2x2", "landscape"),
      portrait: buildOrientationLayout("vertical_interview", "portrait"),
    },
    "owner",
    NOW,
  );
  assert.ok(first.ok);
  if (!first.ok) return;
  assert.equal(first.value.portrait.presetId, "vertical_interview");
  const second = applyProgramStatePatch(first.value, { screenShareMode: "manual" }, "owner", NOW + 1);
  assert.ok(second.ok);
  if (!second.ok) return;
  assert.equal(second.value.screenShareMode, "manual");
  assert.equal(second.value.landscape.presetId, "grid_2x2");
  assert.equal(second.value.portrait.presetId, "vertical_interview");
  // Portrait-only patch leaves landscape alone.
  const third = applyProgramStatePatch(
    second.value,
    { portrait: buildOrientationLayout("stack_2", "portrait") },
    "owner",
    NOW + 2,
  );
  assert.ok(third.ok && third.value.landscape.presetId === "grid_2x2" && third.value.portrait.presetId === "stack_2");
});

test("applyProgramStatePatch: invalid v2 body is rejected", () => {
  const r = applyProgramStatePatch(null, { version: 2, landscape: { presetId: "x", slots: "nope" } }, "o", NOW);
  assert.equal(r.ok, false);
  const r2 = applyProgramStatePatch(null, {}, "o", NOW);
  assert.equal(r2.ok, false);
});

test("applyProgramStatePatch: legacy v1 body (current client) still works", () => {
  const r = applyProgramStatePatch(
    null,
    {
      programLayout: "floating_host",
      programSlots: [
        { id: "slot1", x: 0, y: 0, width: 1280, height: 720, zIndex: 1 },
        { id: "slot2", x: 940, y: 470, width: 320, height: 230, zIndex: 2 },
      ],
      programParticipants: ["g1", "owner"],
    },
    "owner",
    NOW,
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.version, 2);
  assert.deepEqual(r.value.landscape, buildOrientationLayout("floating_host", "landscape"));
  assert.equal(r.value.portrait.presetId, "stack_2");
  assert.deepEqual(r.value.programParticipants, ["g1", "owner"]);
  assert.equal(r.value.programLayout, "floating_host");
});

test("normalizeProgramState (legacy) caps slots and identity lengths", () => {
  const p = normalizeProgramState({
    programSlots: Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, x: 0, y: 0, width: 10, height: 10 })),
    programParticipants: ["x".repeat(300)],
  });
  assert.equal(p!.programSlots!.length, 9);
  assert.equal(p!.programParticipants![0].length, 128);
});
