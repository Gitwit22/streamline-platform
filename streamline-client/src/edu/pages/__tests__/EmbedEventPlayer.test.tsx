import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import EmbedEventPlayer from "../EmbedEventPlayer";

vi.mock("../../state/eduMode", () => ({
  setEduLane: () => undefined,
}));

vi.mock("../../api/publicEmbed", () => {
  return {
    authPublicEduEmbedPassword: vi.fn(),
    fetchPublicEduEmbed: vi.fn(async () => ({
      event: { title: "Test Event", status: "live" },
      broadcast: {
        status: "live",
        hlsPlaybackUrl: "https://example.com/playlist.m3u8",
      },
    })),
    fetchPublicEduEmbedMeta: vi.fn(async () => ({
      event: { title: "Test Event", status: "live" },
      broadcast: {
        status: "live",
        hlsPlaybackUrl: "https://example.com/playlist.m3u8",
      },
      embed: { requiresPassword: false },
    })),
  };
});

function flushMicrotasks() {
  return new Promise<void>((resolve) => {
    queueMicrotask(() => resolve());
  });
}

describe("EDU EmbedEventPlayer HLS readiness", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    (globalThis as any).__sl_hls_supported = true;
    (globalThis as any).__sl_hls_destroyedCount = 0;
  });

  it(
    "shows starting placeholder until manifest is ready, then renders the video",
    async () => {
    (globalThis as any).__sl_hls_supported = false;

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });

    // useHlsReadiness polls using global fetch
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = fetchMock;

    const { container } = render(
      <MemoryRouter initialEntries={["/edu/embed/event?embedId=abc&t=tok"]}>
        <EmbedEventPlayer />
      </MemoryRouter>
    );

    // When live but segments aren't ready yet, we show the non-broken standby UI.
    expect(await screen.findByText("Stream will begin soon…")).toBeInTheDocument();
    expect(screen.getByText("Preparing video feed (this can take a few seconds).")).toBeInTheDocument();

    await waitFor(() => {
      const video = container.querySelector("video");
      expect(video).toBeTruthy();
    }, { timeout: 8000 });

    expect(fetchMock).toHaveBeenCalled();
    },
    10000
  );

  it("shows offline placeholder when live-state has no HLS URL", async () => {
    const mod = await import("../../api/publicEmbed");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mod.fetchPublicEduEmbedMeta as any).mockResolvedValueOnce({
      event: { title: "Test Event", status: "live" },
      broadcast: { status: "live", hlsPlaybackUrl: "" },
      embed: { requiresPassword: false },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mod.fetchPublicEduEmbed as any).mockResolvedValueOnce({
      event: { title: "Test Event", status: "live" },
      broadcast: { status: "live", hlsPlaybackUrl: "" },
    });

    render(
      <MemoryRouter initialEntries={["/edu/embed/event?embedId=abc&t=tok"]}>
        <EmbedEventPlayer />
      </MemoryRouter>
    );

    expect(await screen.findByText("Stream is offline")).toBeInTheDocument();
    expect(screen.getByText("When the host goes live, playback will start automatically.")).toBeInTheDocument();
  });
});
