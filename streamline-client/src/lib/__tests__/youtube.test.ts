import { describe, expect, it, vi } from "vitest";
import { fetchYouTubeTitle, parseYouTubeId } from "../youtube";

describe("parseYouTubeId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&t=42s", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://music.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=10", "dQw4w9WgXcQ"],
    ["youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ?si=x", "dQw4w9WgXcQ"],
    ["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["  dQw4w9WgXcQ  ", "dQw4w9WgXcQ"],
  ])("%s", (input, id) => {
    expect(parseYouTubeId(input)).toBe(id);
  });

  it.each([
    "",
    "hello",
    "https://vimeo.com/123456",
    "https://evil.example/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/watch?v=dQw4w9WgXc<",
    "javascript:alert(1)//youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/channel/UC1234567890",
  ])("rejects %s", (input) => {
    expect(parseYouTubeId(input)).toBeNull();
  });
});

describe("fetchYouTubeTitle", () => {
  it("returns the oEmbed title, or null on any failure", async () => {
    const ok = vi.fn<(url: string) => Promise<Response>>(async () => ({ ok: true, json: async () => ({ title: "  My video " }) }) as unknown as Response);
    expect(await fetchYouTubeTitle("dQw4w9WgXcQ", ok as unknown as typeof fetch)).toBe("My video");
    expect(String(ok.mock.calls[0][0])).toContain("youtube.com/oembed");
    const bad = vi.fn(async () => ({ ok: false }) as unknown as Response);
    expect(await fetchYouTubeTitle("dQw4w9WgXcQ", bad)).toBeNull();
    const boom = vi.fn(async () => {
      throw new Error("CORS");
    });
    expect(await fetchYouTubeTitle("dQw4w9WgXcQ", boom as unknown as typeof fetch)).toBeNull();
    expect(await fetchYouTubeTitle("bad", ok as unknown as typeof fetch)).toBeNull();
  });
});
