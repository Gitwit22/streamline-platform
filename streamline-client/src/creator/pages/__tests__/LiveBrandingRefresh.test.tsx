import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import Live from "../Live";

async function tick(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
  await Promise.resolve();
}

async function spinUntil(cond: () => boolean, totalMs = 2000, stepMs = 50) {
  for (let i = 0; i < Math.ceil(totalMs / stepMs); i++) {
    if (cond()) return;
    await tick(stepMs);
  }
  throw new Error("spinUntil timeout");
}

// Regression: channel branding edits only reached open viewer pages on reload.
describe("Live viewer branding refresh", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("picks up a new channel title without reloading, and keeps it if a refresh fails", async () => {
    vi.useFakeTimers();
    const savedEmbedId = "embed_abc";
    const roomId = "room_123";
    let title = "Old Title";
    let embedFails = false;
    let embedFetches = 0;

    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => "" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes(`/api/saved-embeds/public/${savedEmbedId}`)) {
        embedFetches += 1;
        if (embedFails) return { ok: false, status: 500, json: async () => ({}), text: async () => "" };
        return ok({ savedEmbedId, name: "Embed", activeRoomId: roomId, branding: { title, subtitle: "", logoUrl: "", offlineMessage: "", theme: "dark" } });
      }
      if (url.includes(`/api/public/rooms/${roomId}/hls-config`)) return ok({ roomId, hlsConfig: { enabled: true } });
      if (url.includes(`/api/public/hls/${roomId}`)) return ok({ status: "idle", playlistUrl: null, viewerCount: 0 });
      return { ok: false, status: 404, json: async () => ({ error: "not_found" }), text: async () => "" };
    });

    render(
      <MemoryRouter initialEntries={[`/live/${savedEmbedId}`]}>
        <Routes>
          <Route path="/live/:savedEmbedId" element={<Live />} />
        </Routes>
      </MemoryRouter>
    );

    await spinUntil(() => screen.queryAllByText("Old Title").length > 0);

    title = "New Title";
    await tick(60_000);
    await spinUntil(() => screen.queryAllByText("New Title").length > 0);
    expect(screen.queryByText("Old Title")).toBeNull();

    embedFails = true;
    const before = embedFetches;
    await tick(60_000);
    await spinUntil(() => embedFetches > before);
    await tick(200);
    expect(screen.getAllByText("New Title").length).toBeGreaterThan(0);
  });
});
