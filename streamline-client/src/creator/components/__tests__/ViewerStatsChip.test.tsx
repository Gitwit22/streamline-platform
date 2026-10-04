import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

const fetchMock = vi.fn();
vi.mock("../../../lib/api", () => ({
  apiFetchOptionalAuth: (...args: any[]) => fetchMock(...args),
}));

import ViewerStatsChip, { parseRoomViewerStats, viewerStatsTooltip } from "../ViewerStatsChip";

const LIVE = {
  sessionId: "s1",
  startedAt: 1,
  live: true,
  current: { total: 5, hls: 3, rtcAudience: 2, onStage: 1 },
  totalUnique: { total: 12, hls: 9, rtc: 3 },
  peak: 6,
};

function res(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("ViewerStatsChip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows current and total, with a breakdown tooltip, and polls every 10s", async () => {
    fetchMock.mockResolvedValue(res(200, LIVE));
    render(<ViewerStatsChip roomId="room1" roomAccessToken="rat" />);
    await act(flush);
    const chip = screen.getByTestId("viewer-stats-chip");
    expect(chip.textContent).toContain("5 watching · 12 total");
    expect(chip.getAttribute("title")).toContain("HLS 3");
    expect(chip.getAttribute("title")).toContain("Peak: 6");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/rooms/room1/viewers");
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ "x-room-access-token": "rat" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("is hidden when not live and stops on 403", async () => {
    fetchMock.mockResolvedValueOnce(res(200, { ...LIVE, live: false }));
    const { unmount } = render(<ViewerStatsChip roomId="room1" roomAccessToken={null} />);
    await act(flush);
    expect(screen.queryByTestId("viewer-stats-chip")).toBeNull();
    unmount();

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(res(403, {}));
    render(<ViewerStatsChip roomId="room1" roomAccessToken={null} />);
    await act(flush);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("viewer-stats-chip")).toBeNull();
  });

  it("parses defensively", () => {
    expect(parseRoomViewerStats(null)).toBeNull();
    const p = parseRoomViewerStats({ live: true, current: { total: -3 } })!;
    expect(p.current.total).toBe(0);
    expect(viewerStatsTooltip(p)).toContain("On stage: 0");
  });
});
