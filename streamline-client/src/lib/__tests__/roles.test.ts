import { describe, expect, it } from "vitest";
import {
  extractPresenceMetadata,
  isParticipantHidden,
  isNonNormalPresence,
  presenceModeLabel,
  normalizePresenceMode,
} from "../roles";

describe("normalizePresenceMode", () => {
  it("maps 'silent' to 'invisible'", () => {
    expect(normalizePresenceMode("silent")).toBe("invisible");
  });

  it("passes through 'normal' and 'invisible'", () => {
    expect(normalizePresenceMode("normal")).toBe("normal");
    expect(normalizePresenceMode("invisible")).toBe("invisible");
  });

  it("defaults unknown values to 'normal'", () => {
    expect(normalizePresenceMode("")).toBe("normal");
    expect(normalizePresenceMode(null)).toBe("normal");
    expect(normalizePresenceMode(undefined)).toBe("normal");
  });
});

describe("extractPresenceMetadata", () => {
  it("parses JSON string metadata", () => {
    const p = { metadata: JSON.stringify({ presenceMode: "invisible", isVisibleInRoster: false }) };
    const meta = extractPresenceMetadata(p);
    expect(meta).not.toBeNull();
    expect(meta?.presenceMode).toBe("invisible");
    expect(meta?.isVisibleInRoster).toBe(false);
  });

  it("handles object metadata", () => {
    const p = { metadata: { presenceMode: "invisible", isVisibleInRoster: false } as any };
    const meta = extractPresenceMetadata(p);
    expect(meta?.presenceMode).toBe("invisible");
  });

  it("returns null for missing metadata", () => {
    expect(extractPresenceMetadata(null)).toBeNull();
    expect(extractPresenceMetadata({})).toBeNull();
    expect(extractPresenceMetadata({ metadata: "" })).toBeNull();
  });
});

describe("isParticipantHidden", () => {
  it("hides invisible participants", () => {
    const p = { metadata: JSON.stringify({ presenceMode: "invisible", isVisibleInRoster: false }) };
    expect(isParticipantHidden(p)).toBe(true);
  });

  it("shows normal participants", () => {
    const p = { metadata: JSON.stringify({ presenceMode: "normal", isVisibleInRoster: true }) };
    expect(isParticipantHidden(p)).toBe(false);
  });

  it("returns false for no metadata", () => {
    expect(isParticipantHidden({})).toBe(false);
    expect(isParticipantHidden(null)).toBe(false);
  });
});

describe("isNonNormalPresence", () => {
  it("detects invisible mode", () => {
    const p = { metadata: JSON.stringify({ presenceMode: "invisible" }) };
    expect(isNonNormalPresence(p)).toBe(true);
  });

  it("returns false for normal mode", () => {
    const p = { metadata: JSON.stringify({ presenceMode: "normal" }) };
    expect(isNonNormalPresence(p)).toBe(false);
  });
});

describe("presenceModeLabel", () => {
  it("returns human-readable labels", () => {
    expect(presenceModeLabel("normal")).toBe("Normal");
    expect(presenceModeLabel("invisible")).toBe("Invisible");
  });

  it("maps legacy 'silent' to Invisible label", () => {
    expect(presenceModeLabel("silent")).toBe("Invisible");
  });
});
