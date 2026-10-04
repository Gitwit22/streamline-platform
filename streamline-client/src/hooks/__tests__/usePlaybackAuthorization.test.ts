import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePlaybackAuthorization, type PlaybackFetcher } from "../usePlaybackAuthorization";

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("usePlaybackAuthorization (playback state machine)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("inactive (public channel) → idle, no requests", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<PlaybackFetcher>();
    const { result } = renderHook(() =>
      usePlaybackAuthorization({ target: { kind: "channel", id: "e1" }, active: false, live: true, fetcher })
    );
    await flush();
    expect(result.current.gate.kind).toBe("idle");
    expect(result.current.url).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("402 → checkout; after purchase the next refresh grants a signed URL", async () => {
    vi.useFakeTimers();
    let paid = false;
    const fetcher = vi.fn<PlaybackFetcher>(async (path) => {
      expect(path).toBe("/api/public/channels/e1/playback");
      if (!paid) {
        return {
          status: 402,
          body: { error: "checkout_required", checkout: { eventId: "ev1", eventName: "Show", monetizationMode: "fixed", currency: "usd", fixedAmountCents: 500, pwywMinCents: null } },
        };
      }
      return { status: 200, body: { mode: "pay_per_view", playbackUrl: "/api/hls/play/r1/live.m3u8?token=t1", expiresAt: Date.now() + 30 * 60_000, protected: true } };
    });
    const { result } = renderHook(() =>
      usePlaybackAuthorization({ target: { kind: "channel", id: "e1" }, active: true, live: true, fetcher })
    );
    await flush();
    expect(result.current.gate.kind).toBe("checkout");
    expect(result.current.url).toBeNull();

    paid = true;
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.gate.kind).toBe("granted");
    expect(result.current.url).toMatch(/\/api\/hls\/play\/r1\/live\.m3u8\?token=t1$/);
    expect(result.current.tokenRef.current).toBe("t1");
  });

  it("renews before expiry: hls.js keeps the attached URL, token ref is updated", async () => {
    vi.useFakeTimers();
    let n = 0;
    const fetcher = vi.fn<PlaybackFetcher>(async () => {
      n += 1;
      return { status: 200, body: { mode: "registered", playbackUrl: `/api/hls/play/r1/live.m3u8?token=t${n}`, expiresAt: Date.now() + 60_000, protected: true } };
    });
    const { result } = renderHook(() =>
      usePlaybackAuthorization({ target: { kind: "room", id: "r1" }, active: true, live: true, fetcher })
    );
    await flush();
    const firstUrl = result.current.url;
    expect(result.current.tokenRef.current).toBe("t1");

    await flush(41_000); // 2/3 of 60s
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.tokenRef.current).toBe("t2");
    expect(result.current.url).toBe(firstUrl);
  });

  it("native HLS takes the renewed URL", async () => {
    vi.useFakeTimers();
    let n = 0;
    const fetcher: PlaybackFetcher = async () => {
      n += 1;
      return { status: 200, body: { mode: "private", playbackUrl: `/api/hls/play/r1/live.m3u8?token=t${n}`, expiresAt: Date.now() + 60_000, protected: true } };
    };
    const { result } = renderHook(() =>
      usePlaybackAuthorization({ target: { kind: "room", id: "r1" }, active: true, live: true, nativeHls: true, fetcher })
    );
    await flush();
    await flush(41_000);
    expect(result.current.url).toMatch(/token=t2$/);
  });

  it("revocation on renewal (refund → 402) drops the URL", async () => {
    vi.useFakeTimers();
    let revoked = false;
    const fetcher: PlaybackFetcher = async () =>
      revoked
        ? { status: 402, body: { error: "checkout_required" } }
        : { status: 200, body: { mode: "pay_per_view", playbackUrl: "/api/hls/play/r1/live.m3u8?token=a", expiresAt: Date.now() + 60_000 } };
    const { result } = renderHook(() =>
      usePlaybackAuthorization({ target: { kind: "room", id: "r1" }, active: true, live: true, fetcher })
    );
    await flush();
    expect(result.current.url).not.toBeNull();
    revoked = true;
    await flush(41_000);
    expect(result.current.gate.kind).toBe("checkout");
    expect(result.current.url).toBeNull();
    expect(result.current.tokenRef.current).toBeNull();
  });

  it("401 → login; 403 → forbidden; offline → waiting_live then granted when live", async () => {
    vi.useFakeTimers();
    let live = false;
    const fetcher: PlaybackFetcher = async () =>
      live
        ? { status: 200, body: { mode: "registered", playbackUrl: "/api/hls/play/r1/live.m3u8?token=z", expiresAt: Date.now() + 600_000 } }
        : { status: 200, body: { mode: "registered", playbackUrl: null } };
    const { result, rerender } = renderHook((p: { live: boolean }) =>
      usePlaybackAuthorization({ target: { kind: "room", id: "r1" }, active: true, live: p.live, fetcher }),
      { initialProps: { live: false } }
    );
    await flush();
    expect(result.current.gate.kind).toBe("waiting_live");
    live = true;
    rerender({ live: true });
    await flush();
    expect(result.current.gate.kind).toBe("granted");
    expect(result.current.url).not.toBeNull();

    const login = renderHook(() =>
      usePlaybackAuthorization({ target: { kind: "room", id: "r2" }, active: true, live: true, fetcher: async () => ({ status: 401, body: {} }) })
    );
    const priv = renderHook(() =>
      usePlaybackAuthorization({ target: { kind: "room", id: "r3" }, active: true, live: true, fetcher: async () => ({ status: 403, body: { error: "private" } }) })
    );
    await flush();
    expect(login.result.current.gate.kind).toBe("login");
    expect(priv.result.current.gate).toMatchObject({ kind: "forbidden", reason: "private" });
  });

  it("transient failures retry after 10s", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetcher: PlaybackFetcher = async () => {
      calls += 1;
      if (calls === 1) throw new Error("network");
      return { status: 200, body: { mode: "public", playbackUrl: "https://cdn/x.m3u8", expiresAt: null } };
    };
    const { result } = renderHook(() =>
      usePlaybackAuthorization({ target: { kind: "room", id: "r1" }, active: true, live: true, fetcher })
    );
    await flush();
    expect(result.current.gate.kind).toBe("unavailable");
    await flush(10_000);
    expect(result.current.gate.kind).toBe("granted");
    expect(result.current.url).toBe("https://cdn/x.m3u8");
  });
});
