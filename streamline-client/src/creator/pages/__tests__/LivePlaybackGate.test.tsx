import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import Live from "../Live";

async function tick(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
  await Promise.resolve();
}

async function spinUntil(cond: () => boolean, totalMs = 8000, stepMs = 50) {
  const steps = Math.ceil(totalMs / stepMs);
  for (let i = 0; i < steps; i++) {
    if (cond()) return;
    await tick(stepMs);
  }
  throw new Error("spinUntil timeout");
}

function json(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

describe("Live viewer — protected channel playback", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("PPV: 402 shows the ticket gate (no player, no public playlist); redeeming a code unlocks a signed URL", async () => {
    vi.useFakeTimers();
    const savedEmbedId = "embed_ppv";
    const roomId = "room_ppv";
    let entitled = false;
    const calls: string[] = [];

    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = String(typeof input === "string" ? input : input?.url || "");
      const method = String(init?.method || "GET").toUpperCase();
      calls.push(`${method} ${url}`);

      if (url.includes(`/api/saved-embeds/public/${savedEmbedId}`)) {
        return json(200, { savedEmbedId, name: "PPV Channel", activeRoomId: roomId, viewerPath: `/live/${savedEmbedId}` });
      }
      if (url.includes(`/api/public/rooms/${roomId}/hls-config`)) {
        return json(200, { roomId, hlsConfig: { enabled: true, theme: "dark" } });
      }
      if (url.includes(`/api/public/hls/${roomId}`)) {
        // Server withholds the playlist for non-public channels.
        return json(200, { status: "live", playlistUrl: null, paywalled: true, accessMode: "pay_per_view", viewerCount: 3 });
      }
      if (url.includes(`/api/public/channels/${savedEmbedId}/playback`) && method === "POST") {
        if (!entitled) {
          return json(402, {
            ok: false,
            error: "checkout_required",
            checkoutRequired: true,
            mode: "pay_per_view",
            status: "live",
            checkout: { eventId: "ev1", eventName: "Big Show", monetizationMode: "fixed", currency: "usd", fixedAmountCents: 999, pwywMinCents: null },
          });
        }
        return json(200, {
          ok: true,
          mode: "pay_per_view",
          status: "live",
          playbackUrl: `/api/hls/play/${roomId}/live.m3u8?token=signed1`,
          expiresAt: Date.now() + 30 * 60_000,
          protected: true,
        });
      }
      if (url.includes("/api/monetization/redeem") && method === "POST") {
        entitled = true;
        return json(200, { ok: true, entitled: true });
      }
      if (url.includes(`/api/hls/play/${roomId}/live.m3u8`)) {
        return { ok: true, status: 200, json: async () => ({}), text: async () => "#EXTM3U\n" };
      }
      return json(404, { error: "not_found" });
    });
    (globalThis as any).fetch = fetchMock;

    const { container } = render(
      <MemoryRouter initialEntries={[`/live/${savedEmbedId}`]}>
        <Routes>
          <Route path="/live/:savedEmbedId" element={<Live />} />
        </Routes>
      </MemoryRouter>
    );

    await spinUntil(() => screen.queryByTestId("gate-checkout") != null);
    expect(screen.getByText("Big Show")).toBeInTheDocument();
    expect(screen.getByTestId("gate-buy").textContent).toContain("$9.99");
    expect(container.querySelector("video")).toBeNull();

    fireEvent.click(screen.getByText("I have an access code"));
    fireEvent.change(screen.getByLabelText("Access code"), { target: { value: "abcd2345efgh" } });
    fireEvent.click(screen.getByText("Redeem"));

    await spinUntil(() => container.querySelector("video") != null);
    expect(screen.queryByTestId("gate-checkout")).toBeNull();
    // The player only ever received the signed API URL.
    expect(calls.some((c) => c.includes("/api/hls/play/room_ppv/live.m3u8") && c.includes("token=signed1"))).toBe(true);
  }, 30000);

  it("registered: 401 asks the viewer to sign in and come back", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = String(typeof input === "string" ? input : input?.url || "");
      const method = String(init?.method || "GET").toUpperCase();
      if (url.includes("/api/saved-embeds/public/emb_r")) return json(200, { savedEmbedId: "emb_r", name: "Members", activeRoomId: "room_r", viewerPath: "/live/emb_r" });
      if (url.includes("/api/public/hls/room_r")) return json(200, { status: "idle", playlistUrl: null, accessMode: "registered" });
      if (url.includes("/api/public/channels/emb_r/playback") && method === "POST") return json(401, { error: "login_required", loginRequired: true, mode: "registered" });
      return json(404, {});
    });
    (globalThis as any).fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={["/live/emb_r"]}>
        <Routes>
          <Route path="/live/:savedEmbedId" element={<Live />} />
        </Routes>
      </MemoryRouter>
    );
    await spinUntil(() => screen.queryByTestId("gate-login") != null);
    const link = screen.getByText("Sign in").closest("a");
    expect(link?.getAttribute("href")).toBe("/login?next=%2Flive%2Femb_r");
  }, 30000);

  it("private: 403 shows a friendly message", async () => {
    vi.useFakeTimers();
    (globalThis as any).fetch = vi.fn(async (input: any, init?: any) => {
      const url = String(typeof input === "string" ? input : input?.url || "");
      const method = String(init?.method || "GET").toUpperCase();
      if (url.includes("/api/saved-embeds/public/emb_p")) return json(200, { savedEmbedId: "emb_p", name: "Team", activeRoomId: "room_p", viewerPath: "/live/emb_p" });
      if (url.includes("/api/public/hls/room_p")) return json(200, { status: "live", playlistUrl: null, accessMode: "private" });
      if (url.includes("/api/public/channels/emb_p/playback") && method === "POST") return json(403, { error: "private", message: "This stream is private." });
      return json(404, {});
    });
    render(
      <MemoryRouter initialEntries={["/live/emb_p"]}>
        <Routes>
          <Route path="/live/:savedEmbedId" element={<Live />} />
        </Routes>
      </MemoryRouter>
    );
    await spinUntil(() => screen.queryByTestId("gate-forbidden-private") != null);
    expect(screen.getByText("This stream is private.")).toBeInTheDocument();
  }, 30000);
});
