import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchMock = vi.fn();
vi.mock("../../../lib/api", () => ({
  apiFetchAuth: (...args: unknown[]) => fetchMock(...args),
}));

import HlsBrandingEditor from "../HlsBrandingEditor";

function res(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const KIT = { id: "k1", name: "Main show", title: "Kit Title", subtitle: "", logoUrl: "", offlineMessage: "", theme: "light" };

function setup(roomKitId: string | null, putResult = () => res(200, { roomId: "r1", brandKitId: "k1" })) {
  const puts: unknown[] = [];
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    if (method === "GET" && url.endsWith("/api/rooms/r1/hls-config")) {
      return res(200, { roomId: "r1", hlsConfig: { enabled: true, title: "Channel Title" }, brandKitId: roomKitId });
    }
    if (method === "GET" && url.endsWith("/api/brand-kits")) {
      return res(200, { kits: [KIT], defaultKitId: null, canEdit: true, blockedReason: null });
    }
    if (method === "PUT" && url.endsWith("/api/rooms/r1/brand-kit")) {
      puts.push(JSON.parse(String(init?.body)));
      return putResult();
    }
    throw new Error(`unexpected ${method} ${url}`);
  });
  render(<HlsBrandingEditor roomId="r1" embedName="Embed" viewerUrl="" allowed />);
  return puts;
}

describe("HlsBrandingEditor brand kit picker", () => {
  afterEach(() => {
    cleanup();
    fetchMock.mockReset();
  });

  it("previews the channel's own branding when no kit is assigned", async () => {
    setup(null);
    const select = (await screen.findByTestId("channel-brand-kit")) as HTMLSelectElement;
    expect(select.value).toBe("");
    await waitFor(() => expect(screen.getByTestId("preview-title").textContent).toBe("Channel Title"));
  });

  it("assigns a kit to the channel room and previews it", async () => {
    const puts = setup(null);
    const select = await screen.findByTestId("channel-brand-kit");
    await waitFor(() => expect(screen.getByTestId("preview-title").textContent).toBe("Channel Title"));
    fireEvent.change(select, { target: { value: "k1" } });
    await screen.findByText(/Brand kit applied/);
    expect(puts).toEqual([{ brandKitId: "k1" }]);
    expect(screen.getByTestId("preview-title").textContent).toBe("Kit Title");
  });

  it("keeps the previous kit and shows the error when the owner-only check fails", async () => {
    setup(null, () => res(403, { error: "branding_owner_only" }));
    const select = (await screen.findByTestId("channel-brand-kit")) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "k1" } });
    await screen.findByText("Only the room owner can change its branding.");
    expect(select.value).toBe("");
  });
});
