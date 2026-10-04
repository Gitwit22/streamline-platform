import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatViewerCount,
  formatViewerSplit,
  formatWatchTime,
  outputDestinationsLabel,
  outputKindLabel,
  outputStatusLabel,
  recordingStatChips,
} from "./streamSummary";

describe("stream summary formatting", () => {
  it("formats durations", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(42)).toBe("42s");
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(75)).toBe("1m 15s");
    expect(formatDuration(3725)).toBe("1h 2m");
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(-1)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
  });

  it("shows a dash when watch time was not measured", () => {
    expect(formatWatchTime(null)).toBe("—");
    expect(formatWatchTime(undefined)).toBe("—");
    expect(formatWatchTime(610)).toBe("10m 10s");
  });

  it("formats viewer counts", () => {
    expect(formatViewerCount(0)).toBe("0");
    expect(formatViewerCount(1234)).toBe("1,234");
    expect(formatViewerCount(15_300)).toBe("15.3K");
    expect(formatViewerCount(20_000)).toBe("20K");
    expect(formatViewerCount(2_500_000)).toBe("2.5M");
    expect(formatViewerCount(undefined)).toBe("—");
    expect(formatViewerSplit({ hls: 21, rtc: 9 })).toBe("21 channel · 9 in room");
    expect(formatViewerSplit(null)).toBe("");
  });

  it("labels outputs and statuses", () => {
    expect(outputStatusLabel("completed")).toEqual({ label: "Completed", tone: "ok" });
    expect(outputStatusLabel("failed")).toEqual({ label: "Failed", tone: "error" });
    expect(outputStatusLabel("live")).toEqual({ label: "Live", tone: "live" });
    expect(outputStatusLabel("stopped_limit").tone).toBe("warn");
    expect(outputKindLabel("hls")).toBe("Streamline Channel (HLS)");
    expect(
      outputDestinationsLabel({
        kind: "multistream",
        destinations: [
          { platform: "youtube", label: "YouTube" },
          { platform: "twitch", label: "Twitch" },
        ],
      })
    ).toBe("YouTube, Twitch");
    expect(outputDestinationsLabel({ kind: "instagram", destinations: [] })).toBe("Instagram (vertical)");
  });

  it("builds recording stat chips only for present values", () => {
    expect(recordingStatChips(null)).toEqual([]);
    expect(recordingStatChips({})).toEqual([]);
    expect(
      recordingStatChips({ peakViewers: 12, viewerCount: 30, streamDurationSec: 5400, avgWatchSeconds: null }).map((c) => c.label)
    ).toEqual(["Peak 12", "30 viewers", "Live 1h 30m"]);
    expect(recordingStatChips({ avgWatchSeconds: 95 }).map((c) => c.label)).toEqual(["Avg 1m 35s"]);
  });
});
