import { describe, expect, it } from "vitest";
import { formatMinutesOfLimit, formatUsageResetDate, parseUsageSummary, usagePercent } from "./usageSummary";

describe("parseUsageSummary", () => {
  it("reads the streaming block (limit includes bonus, breakdown by output type)", () => {
    const m = parseUsageSummary({
      resetDate: "2026-11-01T00:00:00.000Z",
      streaming: {
        usedMinutes: 75,
        includedMinutes: 180,
        bonusMinutes: 60,
        limitMinutes: 240,
        unlimited: false,
        overagesActive: false,
        overageMinutes: 0,
        rtmpOutputMinutes: 60,
        byOutput: { multistream: 50, instagram: 10, hls: 60 },
        destinationMinutes: 300,
      },
      recording: { minutes: 12 },
      storageUsedGB: 1.5,
      storageLimitGB: 10,
    });
    expect(m.streaming.used).toBe(75);
    expect(m.streaming.limit).toBe(240);
    expect(m.streaming.remaining).toBe(165);
    expect(m.streaming.unlimited).toBe(false);
    expect(m.streaming.rtmpMinutes).toBe(60);
    expect(m.streaming.hlsMinutes).toBe(60);
    expect(m.streaming.destinationMinutes).toBe(300);
    expect(m.recordingMinutes).toBe(12);
    expect(m.storage).toEqual({ usedGB: 1.5, limitGB: 10 });
  });

  it("treats null limit as unlimited (no hardcoded fallback)", () => {
    const m = parseUsageSummary({ streaming: { usedMinutes: 5000, limitMinutes: null, unlimited: true } });
    expect(m.streaming.unlimited).toBe(true);
    expect(m.streaming.limit).toBeNull();
    expect(m.streaming.remaining).toBeNull();
    expect(m.streaming.overLimit).toBe(false);
  });

  it("falls back to legacy payloads (0 limit = unlimited)", () => {
    const m = parseUsageSummary({ participantMinutes: 30, plan: { id: "pro", limits: { participantMinutes: 0 } } });
    expect(m.streaming.used).toBe(30);
    expect(m.streaming.unlimited).toBe(true);
    const n = parseUsageSummary({ participantMinutes: 30, plan: { limits: { participantMinutes: 180 } } });
    expect(n.streaming.limit).toBe(180);
  });
});

describe("formatting", () => {
  it("formats used / limit and unlimited", () => {
    expect(formatMinutesOfLimit(42, 180)).toBe("42 / 180 min");
    expect(formatMinutesOfLimit(1234, null)).toBe("1,234 min / Unlimited");
    expect(formatMinutesOfLimit(5, 0)).toBe("5 min / Unlimited");
  });

  it("formats the single UTC reset date", () => {
    expect(formatUsageResetDate("2026-11-01T00:00:00.000Z")).toBe("Resets Nov 1 (UTC)");
    expect(formatUsageResetDate(null)).toBe("Resets on the 1st (UTC)");
  });

  it("computes bar percent (0 when unlimited, capped at 100)", () => {
    expect(usagePercent(90, 180)).toBe(50);
    expect(usagePercent(400, 180)).toBe(100);
    expect(usagePercent(400, null)).toBe(0);
  });
});
