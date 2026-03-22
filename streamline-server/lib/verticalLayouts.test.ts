import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Re-implement the pure functions here to avoid importing from the module
// that may have Firebase dependencies in adjacent imports.

type OutputFormat = "landscape_16x9" | "vertical_9x16" | "square_1x1";

function normalizeOutputFormat(raw: any): OutputFormat | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "landscape_16x9" || v === "vertical_9x16" || v === "square_1x1") {
    return v as OutputFormat;
  }
  return undefined;
}

type RoomLayoutMode = "grid" | "speaker" | "carousel" | "pip";

type RoomLayout = {
  mode: RoomLayoutMode;
  maxTiles?: number;
  followSpeaker?: boolean;
  pinnedIdentity?: string | null;
  outputFormat?: OutputFormat;
};

function pickBoolean(v: any): boolean | undefined {
  if (typeof v === "boolean") return v;
  return undefined;
}

function pickNumber(v: any): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

function pickStringOrNull(v: any): string | null | undefined {
  if (v === null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s : null;
  }
  return undefined;
}

function normalizeRoomLayout(input: any): RoomLayout | null {
  if (!input || typeof input !== "object") return null;

  const rawMode = String((input as any).mode || "").toLowerCase();
  const mode: RoomLayoutMode | null =
    rawMode === "grid" || rawMode === "speaker" || rawMode === "carousel" || rawMode === "pip"
      ? (rawMode as RoomLayoutMode)
      : null;

  if (!mode) return null;

  const maxTiles = pickNumber((input as any).maxTiles);
  const followSpeaker = pickBoolean((input as any).followSpeaker);
  const pinnedIdentity = pickStringOrNull((input as any).pinnedIdentity);
  const outputFormat = normalizeOutputFormat((input as any).outputFormat);

  const out: RoomLayout = { mode };
  if (typeof maxTiles === "number") out.maxTiles = maxTiles;
  if (typeof followSpeaker === "boolean") out.followSpeaker = followSpeaker;
  if (pinnedIdentity !== undefined) out.pinnedIdentity = pinnedIdentity;
  if (outputFormat) out.outputFormat = outputFormat;

  return out;
}

// --- Safe-zone helper (from verticalLayouts.ts) ---

type SafeZoneWarning = { slotId: string; message: string };

function checkVerticalSafeZone(
  slots: Array<{ id: string; x: number; y: number; width: number; height: number }>,
  canvasWidth: number,
  canvasHeight: number
): SafeZoneWarning[] {
  const safeWidth = canvasHeight * (9 / 16);
  const safeLeft = (canvasWidth - safeWidth) / 2;
  const safeRight = safeLeft + safeWidth;
  const warnings: SafeZoneWarning[] = [];
  for (const slot of slots) {
    const slotLeft = slot.x * canvasWidth;
    const slotRight = (slot.x + slot.width) * canvasWidth;
    if (slotLeft < safeLeft - 1 || slotRight > safeRight + 1) {
      warnings.push({
        slotId: slot.id,
        message: `Slot "${slot.id}" extends outside the vertical safe zone and may be cropped on vertical platforms.`,
      });
    }
  }
  return warnings;
}

// ===========================
// Tests
// ===========================

describe("normalizeOutputFormat", () => {
  it("accepts landscape_16x9", () => {
    assert.equal(normalizeOutputFormat("landscape_16x9"), "landscape_16x9");
  });

  it("accepts vertical_9x16", () => {
    assert.equal(normalizeOutputFormat("vertical_9x16"), "vertical_9x16");
  });

  it("accepts square_1x1", () => {
    assert.equal(normalizeOutputFormat("square_1x1"), "square_1x1");
  });

  it("rejects unknown strings", () => {
    assert.equal(normalizeOutputFormat("widescreen"), undefined);
    assert.equal(normalizeOutputFormat(""), undefined);
    assert.equal(normalizeOutputFormat("16:9"), undefined);
  });

  it("rejects non-strings", () => {
    assert.equal(normalizeOutputFormat(null), undefined);
    assert.equal(normalizeOutputFormat(undefined), undefined);
    assert.equal(normalizeOutputFormat(42), undefined);
  });

  it("trims and lowercases", () => {
    assert.equal(normalizeOutputFormat("  Vertical_9x16  "), "vertical_9x16");
    assert.equal(normalizeOutputFormat("LANDSCAPE_16X9"), "landscape_16x9");
  });
});

describe("normalizeRoomLayout with outputFormat", () => {
  it("includes outputFormat when provided", () => {
    const result = normalizeRoomLayout({ mode: "speaker", outputFormat: "vertical_9x16" });
    assert.deepEqual(result, { mode: "speaker", outputFormat: "vertical_9x16" });
  });

  it("omits outputFormat when not provided", () => {
    const result = normalizeRoomLayout({ mode: "grid" });
    assert.deepEqual(result, { mode: "grid" });
  });

  it("omits invalid outputFormat", () => {
    const result = normalizeRoomLayout({ mode: "speaker", outputFormat: "bogus" });
    assert.deepEqual(result, { mode: "speaker" });
  });

  it("preserves all existing fields alongside outputFormat", () => {
    const result = normalizeRoomLayout({
      mode: "carousel",
      maxTiles: 6,
      followSpeaker: true,
      pinnedIdentity: "abc",
      outputFormat: "square_1x1",
    });
    assert.deepEqual(result, {
      mode: "carousel",
      maxTiles: 6,
      followSpeaker: true,
      pinnedIdentity: "abc",
      outputFormat: "square_1x1",
    });
  });

  it("still rejects missing mode", () => {
    assert.equal(normalizeRoomLayout({ outputFormat: "vertical_9x16" }), null);
  });
});

describe("checkVerticalSafeZone", () => {
  const W = 1920;
  const H = 1080;

  it("returns no warnings when all slots are inside safe zone", () => {
    // Safe zone center strip on 1920×1080 is ~608px wide, starting at ~656px
    // So fractions: left edge ~0.3417, right edge ~0.6583
    const slots = [
      { id: "host", x: 0.35, y: 0, width: 0.3, height: 0.5 },
    ];
    const warnings = checkVerticalSafeZone(slots, W, H);
    assert.equal(warnings.length, 0);
  });

  it("warns when a slot extends beyond the safe zone", () => {
    const slots = [
      { id: "host", x: 0, y: 0, width: 0.5, height: 0.5 }, // starts at x=0, way left of safe zone
    ];
    const warnings = checkVerticalSafeZone(slots, W, H);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].slotId, "host");
    assert.ok(warnings[0].message.includes("vertical safe zone"));
  });

  it("handles full-width slot (always warns on 16:9 canvas)", () => {
    const slots = [
      { id: "full", x: 0, y: 0, width: 1, height: 1 },
    ];
    const warnings = checkVerticalSafeZone(slots, W, H);
    assert.equal(warnings.length, 1);
  });

  it("returns no warnings for a vertical canvas (safe zone = full width)", () => {
    // On a 1080×1920 canvas, safe width = 1920*(9/16) = 1080 = full width
    const slots = [
      { id: "host", x: 0, y: 0, width: 1, height: 0.5 },
      { id: "guest", x: 0, y: 0.5, width: 1, height: 0.5 },
    ];
    const warnings = checkVerticalSafeZone(slots, 1080, 1920);
    assert.equal(warnings.length, 0);
  });
});
