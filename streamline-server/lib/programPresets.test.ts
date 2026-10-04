import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  LANDSCAPE_PRESETS,
  PORTRAIT_PRESETS,
  SCREEN_OVERRIDE,
  MAX_SLOTS,
  buildOrientationLayout,
  suggestPreset,
  portraitFor,
  autoGridSlots,
  resolveProgramLayout,
  isEligibleParticipant,
  orderParticipants,
  type ResolverParticipant,
  type OrientationLayout,
} from "./programPresets";

// dist/lib/*.test.js → streamline-server/
const SERVER_ROOT = [path.resolve(__dirname, "..", ".."), path.resolve(__dirname, ".."), process.cwd()].find((p) =>
  fs.existsSync(path.join(p, "lib", "programPresets.ts")),
)!;
const TEMPLATES = path.join(SERVER_ROOT, "public", "egress-templates");

const LEGACY_STUDIO_IDS = [
  "solo",
  "side_by_side",
  "host_large_guest_small",
  "two_up_split",
  "three_grid",
  "four_grid",
  "screen_share_speaker",
  "floating_guest",
  "floating_host",
];
const LEGACY_VERTICAL_IDS = [
  "vertical_solo",
  "vertical_host_guest_stack",
  "vertical_3up_panel",
  "vertical_featured_2small",
  "vertical_screenshare_facecam",
  "vertical_interview",
];

// ---------------------------------------------------------------------------
// Preset data
// ---------------------------------------------------------------------------

test("presets: every legacy studio id + new landscape ids exist", () => {
  const ids = LANDSCAPE_PRESETS.map((p) => p.id);
  for (const id of [
    ...LEGACY_STUDIO_IDS,
    "grid_2x2",
    "grid_3x3",
    "speaker_focus",
    "screen_focus",
    "screen_side",
    "screen_pip",
  ]) {
    assert.ok(ids.includes(id), `missing landscape preset ${id}`);
  }
  assert.equal(new Set(ids).size, ids.length, "duplicate landscape ids");
});

test("presets: every legacy vertical id + aliases exist", () => {
  const ids = PORTRAIT_PRESETS.map((p) => p.id);
  for (const id of [...LEGACY_VERTICAL_IDS, "solo_vertical", "stack_2", "stack_3", "screenshare_facecam"]) {
    assert.ok(ids.includes(id), `missing portrait preset ${id}`);
  }
  assert.equal(new Set(ids).size, ids.length, "duplicate portrait ids");
});

test("presets: all slots are fractional, in bounds, ≤ MAX_SLOTS, unique slot ids", () => {
  for (const p of [...LANDSCAPE_PRESETS, ...PORTRAIT_PRESETS]) {
    assert.ok(p.slots.length >= 1 && p.slots.length <= MAX_SLOTS, p.id);
    const ids = new Set<string>();
    for (const s of p.slots) {
      assert.ok(!ids.has(s.id), `${p.id}: duplicate slot ${s.id}`);
      ids.add(s.id);
      for (const v of [s.x, s.y, s.w, s.h]) assert.ok(v >= 0 && v <= 1, `${p.id}/${s.id} out of range`);
      assert.ok(s.x + s.w <= 1.0001 && s.y + s.h <= 1.0001, `${p.id}/${s.id} overflows`);
      assert.ok(["auto", "auto-screen"].includes(s.source.kind), `${p.id}/${s.id} preset source`);
    }
  }
});

test("presets: screen presets carry an auto-screen slot; overrides exist", () => {
  for (const id of ["screen_focus", "screen_side", "screen_pip", "screen_share_speaker"]) {
    const l = buildOrientationLayout(id, "landscape");
    assert.ok(l.slots.some((s) => s.source.kind === "auto-screen"), id);
  }
  const vs = buildOrientationLayout("screenshare_facecam", "portrait");
  assert.equal(vs.slots[0].source.kind, "auto-screen");
  assert.ok(buildOrientationLayout(SCREEN_OVERRIDE.landscape, "landscape").slots.length > 0);
  assert.ok(buildOrientationLayout(SCREEN_OVERRIDE.portrait, "portrait").slots.length > 0);
});

test("buildOrientationLayout returns deep copies; unknown id → empty slots", () => {
  const a = buildOrientationLayout("grid_2x2", "landscape");
  a.slots[0].x = 0.9;
  (a.slots[0].source as any).kind = "auto-screen";
  const b = buildOrientationLayout("grid_2x2", "landscape");
  assert.equal(b.slots[0].x, 0);
  assert.equal(b.slots[0].source.kind, "auto");
  assert.deepEqual(buildOrientationLayout("nope", "portrait"), { presetId: "nope", slots: [] });
  // Landscape ids are not portrait ids.
  assert.equal(buildOrientationLayout("grid_2x2", "portrait").slots.length, 0);
});

test("suggestPreset / portraitFor", () => {
  assert.equal(suggestPreset(1, "landscape"), "solo");
  assert.equal(suggestPreset(2, "landscape"), "side_by_side");
  assert.equal(suggestPreset(3, "landscape"), "three_grid");
  assert.equal(suggestPreset(4, "landscape"), "grid_2x2");
  assert.equal(suggestPreset(7, "landscape"), "grid_3x3");
  assert.equal(suggestPreset(1, "portrait"), "solo_vertical");
  assert.equal(suggestPreset(2, "portrait"), "stack_2");
  assert.equal(suggestPreset(5, "portrait"), "stack_3");

  assert.equal(portraitFor("solo"), "solo_vertical");
  assert.equal(portraitFor("side_by_side"), "stack_2");
  assert.equal(portraitFor("two_up_split"), "stack_2");
  assert.equal(portraitFor("floating_host"), "stack_2");
  assert.equal(portraitFor("grid_2x2"), "stack_3");
  assert.equal(portraitFor("four_grid"), "stack_3");
  assert.equal(portraitFor("speaker_focus"), "vertical_featured_2small");
  assert.equal(portraitFor("screen_focus"), "screenshare_facecam");
  assert.equal(portraitFor("screen_pip"), "screenshare_facecam");
  assert.equal(portraitFor("custom"), "stack_2");
  assert.equal(portraitFor(null), "stack_2");
  assert.equal(portraitFor("__proto__"), "stack_2");
  // every landscape preset maps to an existing portrait preset
  for (const p of LANDSCAPE_PRESETS) {
    assert.ok(buildOrientationLayout(portraitFor(p.id), "portrait").slots.length > 0, p.id);
  }
});

test("autoGridSlots geometry", () => {
  assert.deepEqual(autoGridSlots(0, "landscape"), []);
  const one = autoGridSlots(1, "landscape");
  assert.deepEqual([one[0].x, one[0].y, one[0].w, one[0].h], [0, 0, 1, 1]);
  const three = autoGridSlots(3, "landscape"); // 2 cols, last row centred
  assert.deepEqual(three.map((s) => [s.x, s.y]), [[0, 0], [0.5, 0], [0.25, 0.5]]);
  const p2 = autoGridSlots(2, "portrait");
  assert.deepEqual(p2.map((s) => [s.x, s.y, s.w, s.h]), [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]]);
  assert.equal(autoGridSlots(20, "landscape").length, MAX_SLOTS);
});

// ---------------------------------------------------------------------------
// Resolution algorithm
// ---------------------------------------------------------------------------

const P = (identity: string, joinedAt: number, extra: Partial<ResolverParticipant> = {}): ResolverParticipant => ({
  identity,
  name: identity.toUpperCase(),
  canPublish: true,
  joinedAt,
  camera: { publishedAt: joinedAt },
  ...extra,
});

test("eligibility filters invisible, hidden, recorder, audience", () => {
  assert.equal(isEligibleParticipant(P("a", 1)), true);
  assert.equal(isEligibleParticipant(P("invisible_u1_123", 1)), false);
  assert.equal(isEligibleParticipant(P("b", 1, { metadata: JSON.stringify({ presenceMode: "invisible" }) })), false);
  assert.equal(isEligibleParticipant(P("b", 1, { metadata: JSON.stringify({ hidden: true }) })), false);
  assert.equal(isEligibleParticipant(P("b", 1, { metadata: "not json" })), true);
  assert.equal(isEligibleParticipant(P("EG_abc", 1)), false);
  assert.equal(isEligibleParticipant(P("agent", 1, { isAgent: true })), false);
  assert.equal(isEligibleParticipant(P("aud", 1, { canPublish: false, camera: null })), false);
  // canPublish unknown: eligible only with a published track
  assert.equal(isEligibleParticipant({ identity: "x", camera: null }), false);
  assert.equal(isEligibleParticipant({ identity: "x", screen: { publishedAt: 1 } }), true);
  // canPublish true without tracks: eligible (on stage, camera off)
  assert.equal(isEligibleParticipant({ identity: "x", canPublish: true }), true);
});

test("ordering: host, producers, joinedAt, identity", () => {
  const list = [P("g2", 5), P("producer:u:o", 9), P("g1", 3), P("host", 10), P("b", 3)];
  assert.deepEqual(orderParticipants(list, "host").map((p) => p.identity), ["host", "producer:u:o", "b", "g1", "g2"]);
});

const resolve = (layout: OrientationLayout | null, participants: ResolverParticipant[], extra: any = {}) =>
  resolveProgramLayout({
    layout,
    orientation: "landscape",
    screenShareMode: "auto",
    hostIdentity: "host",
    participants,
    ...extra,
  });

test("resolve: auto slots fill in order; unfilled slots stay empty (no fallback layout)", () => {
  const r = resolve(buildOrientationLayout("grid_2x2", "landscape"), [P("g1", 2), P("host", 5)]);
  assert.equal(r.presetId, "grid_2x2");
  assert.equal(r.autoGrid, false);
  assert.deepEqual(r.slots.map((s) => s.identity), ["host", "g1", null, null]);
  assert.equal(r.slots[0].fit, "cover");
  assert.equal(r.slots[0].label, "HOST");
  assert.equal(r.slots[2].label, null);
});

test("resolve: explicit participant slots win; camera slot skips auto duplicate", () => {
  const layout: OrientationLayout = {
    presetId: "custom",
    slots: [
      { id: "a", x: 0, y: 0, w: 0.5, h: 1, source: { kind: "auto" } },
      { id: "b", x: 0.5, y: 0, w: 0.5, h: 1, source: { kind: "participant", identity: "g1", track: "camera" }, label: false },
    ],
  };
  const r = resolve(layout, [P("host", 1), P("g1", 2)]);
  assert.deepEqual(r.slots.map((s) => [s.identity, s.track]), [["host", "camera"], ["g1", "camera"]]);
  assert.equal(r.slots[1].label, null);
  // Explicit slot for someone not eligible → empty, not reassigned.
  const r2 = resolve(layout, [P("host", 1), P("g2", 2)]);
  assert.deepEqual(r2.slots.map((s) => s.identity), ["host", null]);
});

test("resolve: auto screen override when sharing and layout has no screen slot", () => {
  const ps = [P("host", 1), P("g1", 2, { screen: { publishedAt: 50 } })];
  const r = resolve(buildOrientationLayout("side_by_side", "landscape"), ps);
  assert.equal(r.overridden, true);
  assert.equal(r.presetId, "screen_focus");
  assert.deepEqual(r.slots.map((s) => [s.identity, s.track]), [
    ["g1", "screen"],
    ["host", "camera"],
    ["g1", "camera"], // camera stays visible while sharing
    [null, null],
  ]);
  assert.equal(r.slots[0].fit, "contain");
  // manual mode: no override
  const m = resolve(buildOrientationLayout("side_by_side", "landscape"), ps, { screenShareMode: "manual" });
  assert.equal(m.overridden, false);
  assert.equal(m.presetId, "side_by_side");
  // portrait override
  const p = resolve(buildOrientationLayout("stack_2", "portrait"), ps, { orientation: "portrait" });
  assert.equal(p.presetId, "screenshare_facecam");
  assert.deepEqual(p.slots.map((s) => s.identity), ["g1", "host"]);
});

test("resolve: screen layout without a share leaves the screen slot empty", () => {
  const r = resolve(buildOrientationLayout("screen_pip", "landscape"), [P("host", 1)]);
  assert.equal(r.overridden, false);
  assert.deepEqual(r.slots.map((s) => s.identity), [null, "host"]);
  assert.equal(r.slots[0].fit, "contain");
});

test("resolve: multiple screen shares ordered by publish time", () => {
  const ps = [P("host", 1, { screen: { publishedAt: 90 } }), P("g1", 2, { screen: { publishedAt: 10 } })];
  const layout: OrientationLayout = {
    presetId: "custom",
    slots: [
      { id: "s1", x: 0, y: 0, w: 0.5, h: 1, source: { kind: "auto-screen" } },
      { id: "s2", x: 0.5, y: 0, w: 0.5, h: 1, source: { kind: "auto-screen" } },
    ],
  };
  assert.deepEqual(resolve(layout, ps).slots.map((s) => s.identity), ["g1", "host"]);
});

test("resolve: nothing resolves → automatic grid of eligible cameras", () => {
  const ps = [P("g1", 2), P("host", 1), P("invisible_x", 0), P("EG_rec", 0)];
  const empty = resolve({ presetId: "custom", slots: [] }, ps);
  assert.equal(empty.autoGrid, true);
  assert.deepEqual(empty.slots.map((s) => s.identity), ["host", "g1"]);
  const none = resolve(null, []);
  assert.equal(none.autoGrid, true);
  assert.equal(none.slots.length, 0);
});

// ---------------------------------------------------------------------------
// Generated compositor copies stay in sync with this file
// ---------------------------------------------------------------------------

test("program-presets.json matches the TypeScript presets", () => {
  const json = JSON.parse(fs.readFileSync(path.join(TEMPLATES, "program-presets.json"), "utf8"));
  assert.deepEqual(json.LANDSCAPE_PRESETS, LANDSCAPE_PRESETS);
  assert.deepEqual(json.PORTRAIT_PRESETS, PORTRAIT_PRESETS);
  assert.deepEqual(json.SCREEN_OVERRIDE, SCREEN_OVERRIDE);
  assert.equal(json.MAX_SLOTS, MAX_SLOTS);
});

test("program-layout.mjs is regenerated from programPresets.ts (run scripts/gen-program-layout.mjs)", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ts = require("typescript");
  const src = fs.readFileSync(path.join(SERVER_ROOT, "lib", "programPresets.ts"), "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2020, removeComments: false },
  });
  const expected =
    "// GENERATED from streamline-server/lib/programPresets.ts by scripts/gen-program-layout.mjs.\n" +
    "// Do not edit by hand.\n" +
    out.outputText;
  const actual = fs.readFileSync(path.join(TEMPLATES, "program-layout.mjs"), "utf8");
  assert.equal(actual, expected);
});

test("compositor module resolves identically to the TypeScript resolver", async () => {
  const mod = await import(pathToFileURL(path.join(TEMPLATES, "program-layout.mjs")).href);
  const scenarios: Array<Parameters<typeof resolveProgramLayout>[0]> = [];
  const people = [
    P("host", 3),
    P("g1", 1, { screen: { publishedAt: 7 } }),
    P("producer:p:o", 2),
    P("aud", 0, { canPublish: false, camera: null }),
    P("invisible_z", 0),
    P("g2", 4, { camera: null }),
  ];
  for (const orientation of ["landscape", "portrait"] as const) {
    for (const p of orientation === "landscape" ? LANDSCAPE_PRESETS : PORTRAIT_PRESETS) {
      for (const screenShareMode of ["auto", "manual"] as const) {
        for (const n of [0, 1, 3, people.length]) {
          scenarios.push({
            layout: buildOrientationLayout(p.id, orientation),
            orientation,
            screenShareMode,
            hostIdentity: "host",
            participants: people.slice(0, n),
          });
        }
      }
    }
  }
  for (const sc of scenarios) {
    assert.deepEqual(mod.resolveProgramLayout(sc), resolveProgramLayout(sc));
  }
});
