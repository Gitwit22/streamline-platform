import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import Live from "../Live";

type FetchResponse = {
  ok: boolean;
  status?: number;
  json?: () => Promise<any>;
  text?: () => Promise<string>;
};

async function tick(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
  await Promise.resolve();
}

async function spinUntil(cond: () => boolean, totalMs = 2000, stepMs = 50) {
  const steps = Math.ceil(totalMs / stepMs);
  for (let i = 0; i < steps; i++) {
    if (cond()) return;
    await tick(stepMs);
  }
  throw new Error("spinUntil timeout");
}

describe("Live viewer stop cascade", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    (globalThis as any).__sl_hls_supported = true;
    (globalThis as any).__sl_hls_destroyedCount = 0;
  });

  it(
    "host starts, viewer watches, host stops -> viewer ends + player destroyed",
    async () => {
      vi.useFakeTimers();

      (globalThis as any).__sl_hls_supported = true;
      (globalThis as any).__sl_hls_destroyedCount = 0;

      const savedEmbedId = "embed_abc";
      const roomId = "room_123";
      const playlistUrl = "https://example.com/hls/room_123/live.m3u8";

      // In-memory fake server state.
      let isLive = false;

      const fetchMock = vi.fn(async (input: any, init?: any): Promise<FetchResponse> => {
        const url = String(typeof input === "string" ? input : input?.url || "");
        const method = String(init?.method || "GET").toUpperCase();

        // Viewer tests must never call private (auth) HLS endpoints.
        // If this ever triggers, it means viewer code started bleeding into host-only paths.
        if (url.includes("/api/hls/start/") || url.includes("/api/hls/stop/") || url.includes("/api/hls/status/")) {
          throw new Error(`[viewer-test] unexpected private HLS call: ${method} ${url}`);
        }

        // Resolve savedEmbedId -> activeRoomId
        if (url.includes(`/api/saved-embeds/public/${encodeURIComponent(savedEmbedId)}`) && method === "GET") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              savedEmbedId,
              name: "Test Embed",
              activeRoomId: roomId,
              viewerPath: `/live/${savedEmbedId}`,
            }),
            text: async () => "",
          };
        }

        // Public viewer config
        if (url.includes(`/api/public/rooms/${encodeURIComponent(roomId)}/hls-config`) && method === "GET") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              roomId,
              hlsConfig: {
                enabled: true,
                theme: "dark",
                offlineMessage: "This stream is offline.",
              },
            }),
            text: async () => "",
          };
        }

        // Viewer poll endpoint
        if (url.includes(`/api/public/hls/${encodeURIComponent(roomId)}`) && method === "GET") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: isLive ? "live" : "idle",
              playlistUrl: isLive ? playlistUrl : null,
              viewerCount: 1,
            }),
            text: async () => "",
          };
        }

        // Manifest readiness probe (useHlsReadiness)
        if (url.startsWith(playlistUrl) && method === "GET") {
          return {
            ok: true,
            status: 200,
            json: async () => ({}),
            text: async () => "#EXTM3U\n",
          };
        }

        return {
          ok: false,
          status: 404,
          json: async () => ({ error: "not_found" }),
          text: async () => "not_found",
        };
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).fetch = fetchMock;

      const { container } = render(
        <MemoryRouter initialEntries={[`/live/${savedEmbedId}`]}>
          <Routes>
            <Route path="/live/:savedEmbedId" element={<Live />} />
          </Routes>
        </MemoryRouter>
      );

      await tick(0);

      // Initial state: offline (not live yet)
      await spinUntil(() => screen.queryByText("Starting soon") != null);

      // Host starts the stream
      isLive = true;
      await tick(0);

      // Let viewer poll + readiness probe complete.
      await tick(3500);

      await spinUntil(() => screen.queryByText("Watching live") != null);

      await spinUntil(() => container.querySelector("video") != null);

      // Host stops
      isLive = false;
      await tick(0);

      // Next poll should observe offline + ended.
      await tick(3500);

      await spinUntil(() => screen.queryByText("Stream ended.") != null);

      // Player teardown: hls.js destroyed, and <video> src cleared.
      await spinUntil(() => Number((globalThis as any).__sl_hls_destroyedCount || 0) >= 1);

      await spinUntil(() => container.querySelector("video") == null);

      expect(screen.queryByText("Stream ended.")).toBeInTheDocument();
      expect(Number((globalThis as any).__sl_hls_destroyedCount || 0)).toBeGreaterThanOrEqual(1);

      // Sanity: we exercised viewer poll endpoint.
      expect(fetchMock).toHaveBeenCalled();
    },
    30000
  );
});
