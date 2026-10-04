import { describe, expect, it } from "vitest";
import { buildOrientationLayout, portraitFor, type OrientationLayout, type ProgramStateV2 } from "../programPresets";
import {
  autoGridSlots,
  isEligible,
  normalizeProgramState,
  orderParticipants,
  programStateFromRoomMetadata,
  resolveProgram,
  type ResolveParticipant,
} from "../programResolve";

function state(landscapeId: string, over: Partial<ProgramStateV2> = {}): ProgramStateV2 {
  return {
    version: 2,
    landscape: buildOrientationLayout(landscapeId, "landscape")!,
    portrait: buildOrientationLayout(portraitFor(landscapeId), "portrait")!,
    screenShareMode: "auto",
    hostIdentity: "host",
    updatedAt: 1,
    ...over,
  };
}

const cam = (identity: string, joinedAt: number, extra: Partial<ResolveParticipant> = {}): ResolveParticipant => ({
  identity,
  name: identity,
  joinedAt,
  canPublish: true,
  hasCamera: true,
  ...extra,
});

const ids = (r: ReturnType<typeof resolveProgram>) => r.slots.map((s) => (s.identity ? `${s.identity}:${s.track}` : null));

describe("eligibility", () => {
  it("filters audience, invisible, hidden, egress and agents", () => {
    const list: ResolveParticipant[] = [
      cam("host", 1),
      { identity: "viewer", joinedAt: 2, canPublish: false },
      cam("invisible_admin", 3),
      cam("ghost", 4, { metadata: JSON.stringify({ presenceMode: "invisible" }) }),
      cam("hid", 5, { metadata: { hidden: true } }),
      cam("EG_abc", 6),
      cam("bot", 7, { isAgent: true }),
      { identity: "guest_nocam", joinedAt: 8, canPublish: true },
      { identity: "screen_only", joinedAt: 9, canPublish: false, hasScreen: true },
      cam("bad_meta", 10, { metadata: "{not json" }),
    ];
    expect(list.filter(isEligible).map((p) => p.identity)).toEqual([
      "host",
      "guest_nocam",
      "screen_only",
      "bad_meta",
    ]);
  });
});

describe("ordering", () => {
  it("host first, then producer:, then joinedAt asc, identity tiebreak", () => {
    const ordered = orderParticipants(
      [cam("b", 5), cam("a", 5), cam("producer:x", 9), cam("early", 1), cam("host", 99), cam("nojoin", NaN)],
      "host",
    ).map((p) => p.identity);
    expect(ordered).toEqual(["host", "producer:x", "early", "a", "b", "nojoin"]);
  });
});

describe("resolveProgram", () => {
  const people = [cam("g2", 30), cam("host", 50), cam("g1", 20), { identity: "viewer", joinedAt: 1, canPublish: false }];

  it("fills auto slots in program order and leaves extra slots empty", () => {
    const r = resolveProgram({ state: state("three_grid"), participants: people.slice(0, 2), orientation: "landscape" });
    expect(r.presetId).toBe("three_grid");
    expect(ids(r)).toEqual(["host:camera", "g2:camera", null]);
    expect(r.fallbackGrid).toBe(false);
  });

  it("excludes audience and drops overflow cameras", () => {
    const r = resolveProgram({ state: state("side_by_side"), participants: people, orientation: "landscape" });
    expect(ids(r)).toEqual(["host:camera", "g1:camera"]);
    expect(r.eligible).toEqual(["host", "g1", "g2"]);
  });

  it("auto screen override keeps cameras visible, including the sharer's camera", () => {
    const sharing = [cam("host", 50), cam("g1", 20, { hasScreen: true, screenPublishedAt: 100 })];
    const r = resolveProgram({ state: state("side_by_side"), participants: sharing, orientation: "landscape" });
    expect(r.screenOverride).toBe(true);
    expect(r.presetId).toBe("screen_focus");
    expect(ids(r)).toEqual(["g1:screen", "host:camera", "g1:camera", null]);
    expect(r.slots[0].fit).toBe("contain");
    expect(r.slots[1].fit).toBe("cover");

    const p = resolveProgram({ state: state("side_by_side"), participants: sharing, orientation: "portrait" });
    expect(p.presetId).toBe("screenshare_facecam");
    expect(ids(p)).toEqual(["g1:screen", "host:camera"]);
  });

  it("manual mode does not override; a screen slot in the layout still shows the share", () => {
    const sharing = [cam("host", 50), cam("g1", 20, { hasScreen: true })];
    const manual = resolveProgram({
      state: state("side_by_side", { screenShareMode: "manual" }),
      participants: sharing,
      orientation: "landscape",
    });
    expect(manual.screenOverride).toBe(false);
    expect(ids(manual)).toEqual(["host:camera", "g1:camera"]);

    const withSlot = resolveProgram({
      state: state("screen_side", { screenShareMode: "manual" }),
      participants: sharing,
      orientation: "landscape",
    });
    expect(ids(withSlot)).toEqual(["g1:screen", "host:camera"]);
  });

  it("no override when the active layout already has a screen slot; empty screen slot stays empty", () => {
    const r = resolveProgram({ state: state("screen_pip"), participants: [cam("host", 1)], orientation: "landscape" });
    expect(r.screenOverride).toBe(false);
    expect(ids(r)).toEqual([null, "host:camera"]);
  });

  it("orders multiple screen shares by publish time", () => {
    const r = resolveProgram({
      state: state("solo"),
      participants: [
        cam("host", 1, { hasScreen: true, screenPublishedAt: 200 }),
        cam("g1", 2, { hasScreen: true, screenPublishedAt: 100 }),
      ],
      orientation: "landscape",
    });
    expect(r.screens).toEqual(["g1", "host"]);
    expect(r.slots[0].identity).toBe("g1");
    expect(r.slots[0].track).toBe("screen");
  });

  it("explicit participant slots are filled first and not reused by auto slots", () => {
    const landscape: OrientationLayout = {
      presetId: "custom",
      slots: [
        { id: "a", x: 0, y: 0, w: 0.5, h: 1, source: { kind: "auto" } },
        { id: "b", x: 0.5, y: 0, w: 0.5, h: 1, source: { kind: "participant", identity: "g1", track: "camera" }, label: false },
        { id: "c", x: 0, y: 0, w: 0.2, h: 0.2, source: { kind: "participant", identity: "g1", track: "screen" } },
        { id: "d", x: 0, y: 0, w: 0.2, h: 0.2, source: { kind: "participant", identity: "nobody", track: "camera" } },
      ],
    };
    const r = resolveProgram({
      state: { ...state("solo"), landscape },
      participants: [cam("host", 1), cam("g1", 2, { hasScreen: true })],
      orientation: "landscape",
    });
    expect(ids(r)).toEqual(["host:camera", "g1:camera", "g1:screen", null]);
    expect(r.slots[1].label).toBe(false);
    expect(r.slots[0].label).toBe(true);
    expect(r.screenOverride).toBe(false);
  });

  it("falls back to an automatic grid when nothing resolves or there is no state", () => {
    const parts = [cam("host", 1), cam("g1", 2), cam("g2", 3)];
    const none = resolveProgram({ state: null, participants: parts, orientation: "landscape" });
    expect(none.fallbackGrid).toBe(true);
    expect(none.presetId).toBe("auto_grid");
    expect(ids(none)).toEqual(["host:camera", "g1:camera", "g2:camera"]);

    const landscape: OrientationLayout = {
      presetId: "custom",
      slots: [{ id: "x", x: 0, y: 0, w: 1, h: 1, source: { kind: "participant", identity: "gone", track: "camera" } }],
    };
    const r = resolveProgram({ state: { ...state("solo"), landscape }, participants: parts, orientation: "landscape" });
    expect(r.fallbackGrid).toBe(true);
    expect(r.slots).toHaveLength(3);

    expect(resolveProgram({ state: null, participants: [], orientation: "landscape" }).slots).toEqual([]);
  });

  it("no state + screen share uses the override (auto by default)", () => {
    const r = resolveProgram({
      state: null,
      participants: [cam("host", 1, { hasScreen: true })],
      orientation: "landscape",
    });
    expect(r.presetId).toBe("screen_focus");
    expect(ids(r)).toEqual(["host:screen", "host:camera", null, null]);
  });
});

describe("autoGridSlots", () => {
  it("produces in-bounds slots", () => {
    for (const o of ["landscape", "portrait"] as const) {
      for (let n = 1; n <= 9; n++) {
        const slots = autoGridSlots(n, o);
        expect(slots).toHaveLength(n);
        for (const s of slots) {
          expect(s.x + s.w).toBeLessThanOrEqual(1 + 1e-9);
          expect(s.y + s.h).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
    }
  });
});

describe("normalizeProgramState", () => {
  it("accepts v2 and derives a missing portrait", () => {
    const s = normalizeProgramState({ version: 2, landscape: buildOrientationLayout("three_grid", "landscape"), updatedAt: 5 });
    expect(s?.portrait.presetId).toBe("stack_3");
    expect(s?.screenShareMode).toBe("auto");
  });

  it("converts legacy v1 programLayout", () => {
    const s = normalizeProgramState({ programLayout: "floating_guest", programSlots: [], updatedAt: "2026-01-01T00:00:00Z" });
    expect(s?.landscape.presetId).toBe("floating_guest");
    expect(s?.portrait.presetId).toBe("stack_2");
    expect(normalizeProgramState({ programLayout: null })).toBeNull();
    expect(normalizeProgramState(null)).toBeNull();
  });

  it("reads programState from room metadata", () => {
    const meta = JSON.stringify({ other: 1, programState: state("side_by_side", { screenShareMode: "manual" }) });
    const s = programStateFromRoomMetadata(meta);
    expect(s?.landscape.presetId).toBe("side_by_side");
    expect(s?.screenShareMode).toBe("manual");
    expect(programStateFromRoomMetadata("")).toBeNull();
    expect(programStateFromRoomMetadata("{bad")).toBeNull();
  });
});
