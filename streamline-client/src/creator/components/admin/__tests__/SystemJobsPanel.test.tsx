import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchMock = vi.fn();
vi.mock("../../../../lib/api", () => ({
  apiFetchAuth: (...args: unknown[]) => fetchMock(...args),
}));

import { SystemJobsPanel } from "../SystemJobsPanel";
import { formatInterval, formatRelative, highlightText } from "../systemJobsFormat";

const NOW = Date.now();

function res(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const JOBS = {
  nowMs: NOW,
  schedulerRunning: true,
  jobs: [
    {
      name: "recording-enforcement",
      title: "Recording Enforcement",
      intervalMs: 60_000,
      enabled: true,
      highlight: "stopped",
      running: false,
      lastRunAtMs: NOW - 60_000,
      lastStatus: "success",
      lastProcessed: 1,
      lastDetails: { stopped: 1, considered: 3 },
      lastError: null,
      lastDurationMs: 420,
      nextRunAtMs: NOW + 30_000,
      runCount: 10,
      errorCount: 0,
      recentRuns: [],
    },
    {
      name: "media-purge",
      title: "Media Purge",
      intervalMs: 3_600_000,
      enabled: true,
      highlight: "deleted",
      running: false,
      lastRunAtMs: NOW - 600_000,
      lastStatus: "error",
      lastProcessed: 42,
      lastDetails: { deleted: 42 },
      lastError: "retention: boom",
      lastDurationMs: 2500,
      nextRunAtMs: NOW + 3_000_000,
      runCount: 3,
      errorCount: 1,
      recentRuns: [],
    },
  ],
};

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

describe("SystemJobsPanel helpers", () => {
  it("formats relative times and intervals", () => {
    expect(formatRelative(NOW - 120_000, NOW)).toBe("2m ago");
    expect(formatRelative(NOW + 2 * 3_600_000, NOW)).toBe("in 2h");
    expect(formatRelative(null, NOW)).toBe("");
    expect(formatInterval(60_000)).toBe("every 1 min");
    expect(formatInterval(86_400_000)).toBe("every 1 d");
    expect(formatInterval(0)).toBe("manual only");
  });

  it("builds the key-detail summary", () => {
    expect(highlightText({ highlight: "stopped", lastDetails: { stopped: 1 } })).toBe("Stopped: 1");
    expect(highlightText({ highlight: "stopped", lastDetails: null })).toBeNull();
    expect(highlightText({ highlight: null, lastDetails: { stopped: 1 } })).toBeNull();
  });
});

describe("SystemJobsPanel", () => {
  it("renders jobs with status, processed, key detail and error", async () => {
    fetchMock.mockResolvedValue(res(200, JOBS));
    render(<SystemJobsPanel />);
    expect(await screen.findByText(/Recording Enforcement/)).toBeTruthy();
    expect(screen.getByText("Stopped: 1")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("Success")).toBeTruthy();
    // Column header + the media-purge badge.
    expect(screen.getAllByText("Error").length).toBe(2);
    expect(screen.getByText("retention: boom")).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toContain("/api/admin/jobs");
  });

  it("Run now posts to the job endpoint and reports the result", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return res(200, { ok: true, status: "success", processed: 7 });
      return res(200, JOBS);
    });
    const onMessage = vi.fn();
    render(<SystemJobsPanel onMessage={onMessage} />);
    await screen.findByText(/Media Purge/);
    fireEvent.click(screen.getAllByText("Run now")[1]);
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith("Media Purge: done, processed 7"));
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    expect(post?.[0]).toContain("/api/admin/jobs/media-purge/run");
  });
});
