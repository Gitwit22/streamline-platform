import { describe, expect, it } from "vitest";
import {
  LANDSCAPE_PRESETS,
  PORTRAIT_PRESETS,
  SCREEN_OVERRIDE,
  MAX_SLOTS,
  autoGridSlots,
  buildOrientationLayout,
  portraitFor,
  suggestPreset,
} from "../programPresets";
import { PORTRAIT_ALIASES, buildLayout, layoutHasScreenSlot, pickerPresets } from "../programResolve";
import { ALL_PRESET_IDS } from "../studioLayout";
import { VERTICAL_PRESETS } from "../verticalLayouts";

// ../programPresets.ts is a byte-for-byte copy of
// streamline-server/lib/programPresets.ts (enforced by the server test
// lib/programPresetsShared.test.ts).  These tests pin the shared geometry the
// in-room stage and the egress compositor both render.

const EPS = 1e-6;

describe("preset geometry", () => {
  for (const [orientation, list] of [
    ["landscape", LANDSCAPE_PRESETS],
    ["portrait", PORTRAIT_PRESETS],
  ] as const) {
    for (const p of list) {
      it(`${orientation}/${p.id} has valid fractional slots`, () => {
        expect(p.slots.length).toBeGreaterThan(0);
        expect(p.slots.length).toBeLessThanOrEqual(MAX_SLOTS);
        const ids = new Set<string>();
        for (const s of p.slots) {
          expect(ids.has(s.id)).toBe(false);
          ids.add(s.id);
          for (const v of [s.x, s.y, s.w, s.h]) {
            expect(Number.isFinite(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
          expect(s.w).toBeGreaterThan(0);
          expect(s.h).toBeGreaterThan(0);
          expect(s.x + s.w).toBeLessThanOrEqual(1 + EPS);
          expect(s.y + s.h).toBeLessThanOrEqual(1 + EPS);
          expect(["auto", "auto-screen"]).toContain(s.source.kind);
        }
      });
    }
  }

  it("preset ids are unique per orientation", () => {
    expect(new Set(LANDSCAPE_PRESETS.map((p) => p.id)).size).toBe(LANDSCAPE_PRESETS.length);
    expect(new Set(PORTRAIT_PRESETS.map((p) => p.id)).size).toBe(PORTRAIT_PRESETS.length);
  });
});

describe("landscape presets", () => {
  it("include every legacy studio preset id (camera-only unless it is a screen preset)", () => {
    for (const id of ALL_PRESET_IDS) {
      const l = buildLayout(id, "landscape");
      expect(l, id).not.toBeNull();
      expect(layoutHasScreenSlot(l), id).toBe(String(id).startsWith("screen_"));
    }
  });

  it("include the grid / speaker / screen presets", () => {
    const ids = LANDSCAPE_PRESETS.map((p) => p.id);
    for (const id of ["grid_2x2", "grid_3x3", "speaker_focus", "screen_focus", "screen_side", "screen_pip", "screen_share_speaker"]) {
      expect(ids).toContain(id);
    }
  });

  it("host_large_guest_small geometry", () => {
    const l = buildOrientationLayout("host_large_guest_small", "landscape");
    expect(l.slots[0]).toMatchObject({ x: 0, y: 0, w: 0.75, h: 1 });
    expect(l.slots[1]).toMatchObject({ x: 0.7578, y: 0.5556, w: 0.2344, h: 0.4167, z: 2 });
  });

  it("floating presets: host (first in order) floats or fills", () => {
    const fh = buildOrientationLayout("floating_host", "landscape");
    expect(fh.slots.map((s) => s.id)).toEqual(["inset", "main"]);
    expect(fh.slots[0]).toMatchObject({ x: 0.73, y: 0.715, w: 0.25, h: 0.25, z: 2 });
    const fg = buildOrientationLayout("floating_guest", "landscape");
    expect(fg.slots.map((s) => s.id)).toEqual(["main", "inset"]);
    expect(fg.slots[1]).toMatchObject({ x: 0.73, y: 0.715, w: 0.25, h: 0.25, z: 2 });
  });

  it("screen_focus: auto-screen 80% + 3 stacked cams in the right 20%", () => {
    const l = buildOrientationLayout("screen_focus", "landscape");
    expect(l.slots[0]).toMatchObject({ x: 0, y: 0, w: 0.8, h: 1, source: { kind: "auto-screen" } });
    const cams = l.slots.slice(1);
    expect(cams).toHaveLength(3);
    for (const c of cams) {
      expect(c.source.kind).toBe("auto");
      expect(c.x).toBe(0.8);
      expect(c.w).toBe(0.2);
    }
    expect(cams[2].y + cams[2].h).toBeCloseTo(1, 3);
  });

  it("screen_side and screen_pip geometry", () => {
    const side = buildOrientationLayout("screen_side", "landscape");
    expect(side.slots[0]).toMatchObject({ x: 0, w: 0.7, source: { kind: "auto-screen" } });
    expect(side.slots[1]).toMatchObject({ x: 0.7, y: 0.35, w: 0.3, h: 0.3, source: { kind: "auto" } });
    const pip = buildOrientationLayout("screen_pip", "landscape");
    expect(pip.slots[0]).toMatchObject({ x: 0, y: 0, w: 1, h: 1, source: { kind: "auto-screen" } });
    expect(pip.slots[1]).toMatchObject({ x: 0.76, y: 0.75, w: 0.22, h: 0.22, source: { kind: "auto" } });
    expect(pip.slots[1].z).toBeGreaterThan(pip.slots[0].z ?? 1);
  });

  it("unknown ids: shared builder yields empty slots, buildLayout null; copies are fresh", () => {
    expect(buildOrientationLayout("nope", "landscape")).toEqual({ presetId: "nope", slots: [] });
    expect(buildLayout("nope", "landscape")).toBeNull();
    const a = buildOrientationLayout("solo", "landscape");
    a.slots[0].x = 0.5;
    expect(buildOrientationLayout("solo", "landscape").slots[0].x).toBe(0);
  });
});

describe("portrait presets", () => {
  it("contain the required ids", () => {
    for (const id of ["solo_vertical", "stack_2", "stack_3", "screenshare_facecam"]) {
      expect(buildLayout(id, "portrait")?.presetId).toBe(id);
    }
  });

  it("cover every VERTICAL_PRESETS id; aliases share the canonical slots", () => {
    for (const v of VERTICAL_PRESETS) {
      const l = buildLayout(v.id, "portrait");
      expect(l, v.id).not.toBeNull();
      expect(l!.slots).toHaveLength(v.slots.length);
    }
    for (const [from, to] of Object.entries(PORTRAIT_ALIASES)) {
      expect(buildOrientationLayout(from, "portrait").slots).toEqual(buildOrientationLayout(to, "portrait").slots);
    }
  });

  it("screenshare_facecam: exact 16:9 screen on top, face cam fills the rest", () => {
    const l = buildOrientationLayout("screenshare_facecam", "portrait");
    expect(l.slots[0]).toMatchObject({ x: 0, y: 0, w: 1, h: 0.3164, fit: "contain", source: { kind: "auto-screen" } });
    expect(l.slots[1]).toMatchObject({ x: 0, y: 0.3164, w: 1, h: 0.6836, fit: "cover", source: { kind: "auto" } });
    // 16:9 content at full width of a 9:16 canvas
    expect(l.slots[0].h).toBeCloseTo((9 / 16) * (9 / 16), 4);
    expect(l.slots[1].y + l.slots[1].h).toBeCloseTo(1, 6);
    expect(layoutHasScreenSlot(l)).toBe(true);
    expect(layoutHasScreenSlot(buildOrientationLayout("stack_2", "portrait"))).toBe(false);
  });

  it("picker hides portrait aliases but offers every landscape preset", () => {
    expect(pickerPresets("landscape")).toEqual(LANDSCAPE_PRESETS);
    const ids = pickerPresets("portrait").map((p) => p.id);
    for (const alias of Object.keys(PORTRAIT_ALIASES)) expect(ids).not.toContain(alias);
    expect(ids).toEqual(expect.arrayContaining(["solo_vertical", "stack_2", "stack_3", "screenshare_facecam", "vertical_featured_2small", "vertical_interview"]));
  });
});

describe("portraitFor", () => {
  it("maps every landscape preset to an existing portrait preset", () => {
    for (const p of LANDSCAPE_PRESETS) {
      expect(buildLayout(portraitFor(p.id), "portrait"), p.id).not.toBeNull();
    }
  });

  it("follows the shared mapping", () => {
    expect(portraitFor("solo")).toBe("solo_vertical");
    expect(portraitFor("side_by_side")).toBe("stack_2");
    expect(portraitFor("two_up_split")).toBe("stack_2");
    expect(portraitFor("three_grid")).toBe("stack_3");
    expect(portraitFor("four_grid")).toBe("stack_3");
    expect(portraitFor("grid_3x3")).toBe("stack_3");
    expect(portraitFor("speaker_focus")).toBe("vertical_featured_2small");
    expect(portraitFor("floating_guest")).toBe("stack_2");
    expect(portraitFor("floating_host")).toBe("stack_2");
    expect(portraitFor("screen_share_speaker")).toBe("screenshare_facecam");
    expect(portraitFor("screen_focus")).toBe("screenshare_facecam");
    expect(portraitFor("screen_side")).toBe("screenshare_facecam");
    expect(portraitFor("screen_pip")).toBe("screenshare_facecam");
    expect(portraitFor("custom")).toBe("stack_2");
  });
});

describe("suggestPreset / SCREEN_OVERRIDE / autoGridSlots", () => {
  it("suggests by count", () => {
    expect([1, 2, 3, 4, 5, 9].map((n) => suggestPreset(n, "landscape"))).toEqual([
      "solo",
      "side_by_side",
      "three_grid",
      "grid_2x2",
      "grid_3x3",
      "grid_3x3",
    ]);
    expect([0, 2, 5].map((n) => suggestPreset(n, "portrait"))).toEqual(["solo_vertical", "stack_2", "stack_3"]);
  });

  it("override presets exist and have screen slots", () => {
    expect(layoutHasScreenSlot(buildOrientationLayout(SCREEN_OVERRIDE.landscape, "landscape"))).toBe(true);
    expect(layoutHasScreenSlot(buildOrientationLayout(SCREEN_OVERRIDE.portrait, "portrait"))).toBe(true);
  });

  it("portrait auto grid: 1 column up to 3, 2 up to 8, else 3", () => {
    const cols = (n: number) => 1 / autoGridSlots(n, "portrait")[0].w;
    expect(Math.round(cols(3))).toBe(1);
    expect(Math.round(cols(4))).toBe(2);
    expect(Math.round(cols(8))).toBe(2);
    expect(Math.round(cols(9))).toBe(3);
    expect(autoGridSlots(20, "landscape")).toHaveLength(MAX_SLOTS);
  });
});
