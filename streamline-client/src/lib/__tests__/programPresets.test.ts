import { describe, expect, it } from "vitest";
import {
  LANDSCAPE_PRESETS,
  PORTRAIT_PRESETS,
  PORTRAIT_ALIASES,
  SCREEN_OVERRIDE,
  buildOrientationLayout,
  layoutHasScreenSlot,
  portraitFor,
  suggestPreset,
} from "../programPresets";
import { ALL_PRESET_IDS } from "../studioLayout";
import { VERTICAL_PRESETS } from "../verticalLayouts";

const EPS = 1e-6;

describe("preset geometry", () => {
  for (const p of [...LANDSCAPE_PRESETS, ...PORTRAIT_PRESETS]) {
    it(`${p.orientation}/${p.id} has valid fractional slots`, () => {
      expect(p.slots.length).toBeGreaterThan(0);
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

  it("preset ids are unique per orientation", () => {
    expect(new Set(LANDSCAPE_PRESETS.map((p) => p.id)).size).toBe(LANDSCAPE_PRESETS.length);
    expect(new Set(PORTRAIT_PRESETS.map((p) => p.id)).size).toBe(PORTRAIT_PRESETS.length);
  });
});

describe("landscape presets", () => {
  it("include every legacy studio preset id with auto sources", () => {
    for (const id of ALL_PRESET_IDS) {
      const l = buildOrientationLayout(id, "landscape");
      expect(l, id).not.toBeNull();
      expect(l!.slots.every((s) => s.source.kind === "auto")).toBe(true);
    }
  });

  it("converts legacy pixel geometry to fractions of 1280x720", () => {
    const l = buildOrientationLayout("host_large_guest_small", "landscape")!;
    expect(l.slots[0]).toMatchObject({ x: 0, y: 0, w: 0.75, h: 1 });
    expect(l.slots[1]).toMatchObject({ x: 0.7578, y: 0.5556, w: 0.2344, h: 0.4167, z: 2 });
  });

  it("screen_focus: auto-screen 80% + 3 stacked cams in the right 20%", () => {
    const l = buildOrientationLayout("screen_focus", "landscape")!;
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
    const side = buildOrientationLayout("screen_side", "landscape")!;
    expect(side.slots[0]).toMatchObject({ x: 0, w: 0.7, source: { kind: "auto-screen" } });
    expect(side.slots[1]).toMatchObject({ x: 0.7, w: 0.3, source: { kind: "auto" } });
    const pip = buildOrientationLayout("screen_pip", "landscape")!;
    expect(pip.slots[0]).toMatchObject({ x: 0, y: 0, w: 1, h: 1, source: { kind: "auto-screen" } });
    expect(pip.slots[1]).toMatchObject({ x: 0.76, y: 0.76, w: 0.22, h: 0.22, source: { kind: "auto" } });
    expect(pip.slots[1].z).toBeGreaterThan(pip.slots[0].z ?? 1);
  });

  it("returns null for unknown ids and fresh copies", () => {
    expect(buildOrientationLayout("nope", "landscape")).toBeNull();
    const a = buildOrientationLayout("solo", "landscape")!;
    a.slots[0].x = 0.5;
    expect(buildOrientationLayout("solo", "landscape")!.slots[0].x).toBe(0);
  });
});

describe("portrait presets", () => {
  it("contain the required ids", () => {
    for (const id of ["solo_vertical", "stack_2", "stack_3", "screenshare_facecam"]) {
      expect(buildOrientationLayout(id, "portrait")?.presetId).toBe(id);
    }
  });

  it("cover every VERTICAL_PRESETS id (directly or via alias)", () => {
    for (const v of VERTICAL_PRESETS) {
      const l = buildOrientationLayout(v.id, "portrait");
      expect(l, v.id).not.toBeNull();
      expect(l!.slots).toHaveLength(v.slots.length);
    }
    for (const [from, to] of Object.entries(PORTRAIT_ALIASES)) {
      expect(buildOrientationLayout(from, "portrait")!.presetId).toBe(to);
    }
  });

  it("screenshare_facecam has an auto-screen slot", () => {
    expect(layoutHasScreenSlot(buildOrientationLayout("screenshare_facecam", "portrait"))).toBe(true);
    expect(layoutHasScreenSlot(buildOrientationLayout("stack_2", "portrait"))).toBe(false);
  });
});

describe("portraitFor", () => {
  it("maps every landscape preset to an existing portrait preset", () => {
    for (const p of LANDSCAPE_PRESETS) {
      expect(buildOrientationLayout(portraitFor(p.id), "portrait"), p.id).not.toBeNull();
    }
  });

  it("follows the documented mapping", () => {
    expect(portraitFor("solo")).toBe("solo_vertical");
    expect(portraitFor("side_by_side")).toBe("stack_2");
    expect(portraitFor("two_up_split")).toBe("stack_2");
    expect(portraitFor("three_grid")).toBe("stack_3");
    expect(portraitFor("four_grid")).toBe("stack_3");
    expect(portraitFor("speaker_focus")).toBe("stack_3");
    expect(portraitFor("floating_guest")).toBe("stack_2");
    expect(portraitFor("floating_host")).toBe("stack_2");
    expect(portraitFor("screen_share_speaker")).toBe("screenshare_facecam");
    expect(portraitFor("screen_focus")).toBe("screenshare_facecam");
    expect(portraitFor("screen_side")).toBe("screenshare_facecam");
    expect(portraitFor("screen_pip")).toBe("screenshare_facecam");
  });
});

describe("suggestPreset / SCREEN_OVERRIDE", () => {
  it("suggests by count", () => {
    expect([1, 2, 3, 4, 9].map((n) => suggestPreset(n, "landscape"))).toEqual([
      "solo",
      "side_by_side",
      "three_grid",
      "four_grid",
      "four_grid",
    ]);
    expect([0, 2, 5].map((n) => suggestPreset(n, "portrait"))).toEqual(["solo_vertical", "stack_2", "stack_3"]);
  });

  it("override presets exist and have screen slots", () => {
    expect(layoutHasScreenSlot(buildOrientationLayout(SCREEN_OVERRIDE.landscape, "landscape"))).toBe(true);
    expect(layoutHasScreenSlot(buildOrientationLayout(SCREEN_OVERRIDE.portrait, "portrait"))).toBe(true);
  });
});
