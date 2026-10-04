import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

const apiFetchMock = vi.fn();
vi.mock("../../lib/api", () => ({
  apiFetch: (...args: any[]) => apiFetchMock(...args),
}));

import { HLS_VIEWER_HEARTBEAT_MS, useHlsViewerHeartbeat } from "../useHlsViewerHeartbeat";

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function heartbeatBodies() {
  return apiFetchMock.mock.calls
    .filter((c) => String(c[0]).includes("/api/public/viewers/heartbeat"))
    .map((c) => JSON.parse(String(c[1]?.body || "{}")));
}

describe("useHlsViewerHeartbeat", () => {
  let beacon: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue(okResponse({ ok: true, currentViewers: 3, totalViewers: 7 }));
    beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true, writable: true });
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("pings immediately and then every 20s while active", async () => {
    const { result } = renderHook(() => useHlsViewerHeartbeat("room1", true));
    await act(async () => {
      await flush();
    });
    expect(heartbeatBodies()).toHaveLength(1);
    expect(heartbeatBodies()[0]).toMatchObject({ roomId: "room1", kind: "hls" });
    expect(heartbeatBodies()[0].viewerId).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(result.current).toEqual({ currentViewers: 3, totalViewers: 7 });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HLS_VIEWER_HEARTBEAT_MS - 1);
    });
    expect(heartbeatBodies()).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(heartbeatBodies()).toHaveLength(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HLS_VIEWER_HEARTBEAT_MS * 2);
    });
    expect(heartbeatBodies()).toHaveLength(4);
  });

  it("does nothing while inactive or without a room", async () => {
    renderHook(() => useHlsViewerHeartbeat("room1", false));
    renderHook(() => useHlsViewerHeartbeat("", true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HLS_VIEWER_HEARTBEAT_MS * 3);
    });
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
  });

  it("skips pings while the tab is hidden", async () => {
    renderHook(() => useHlsViewerHeartbeat("room1", true));
    await act(async () => {
      await flush();
    });
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HLS_VIEWER_HEARTBEAT_MS * 3);
    });
    expect(heartbeatBodies()).toHaveLength(1);

    // Becoming visible pings right away.
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(heartbeatBodies()).toHaveLength(2);
  });

  it("sends a leave beacon on unmount and when deactivated", async () => {
    const { rerender, unmount } = renderHook(({ active }) => useHlsViewerHeartbeat("room1", active), {
      initialProps: { active: true },
    });
    await act(async () => {
      await flush();
    });
    rerender({ active: false });
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, blob] = beacon.mock.calls[0] as [string, Blob];
    expect(url).toContain("/api/public/viewers/heartbeat");
    expect(blob.type).toBe("text/plain");
    const sent = JSON.parse(await blob.text());
    expect(sent).toMatchObject({ roomId: "room1", kind: "hls", leave: true });

    rerender({ active: true });
    await act(async () => {
      await flush();
    });
    unmount();
    expect(beacon).toHaveBeenCalledTimes(2);
    // No further pings after unmount.
    const before = heartbeatBodies().length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HLS_VIEWER_HEARTBEAT_MS * 2);
    });
    expect(heartbeatBodies()).toHaveLength(before);
  });

  it("swallows errors and keeps the last counts", async () => {
    const { result } = renderHook(() => useHlsViewerHeartbeat("room1", true));
    await act(async () => {
      await flush();
    });
    expect(result.current?.currentViewers).toBe(3);
    apiFetchMock.mockRejectedValue(new Error("network"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HLS_VIEWER_HEARTBEAT_MS);
    });
    expect(result.current?.currentViewers).toBe(3);
  });
});
