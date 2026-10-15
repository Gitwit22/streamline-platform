import { describe, expect, it } from "vitest";
import {
  DEFAULT_KIT_VIDEO,
  normalizeProgramOverlay,
  overlayFromKit,
  programOverlayFromRoomMetadata,
} from "../programOverlay";

describe("programOverlay", () => {
  it("reads metadata: absent key = unknown, null = removed", () => {
    expect(programOverlayFromRoomMetadata(null)).toEqual({ known: false });
    expect(programOverlayFromRoomMetadata("not json")).toEqual({ known: false });
    expect(programOverlayFromRoomMetadata(JSON.stringify({ programState: {} }))).toEqual({ known: false });
    expect(programOverlayFromRoomMetadata(JSON.stringify({ programOverlay: null }))).toEqual({ known: true, overlay: null });
    const r = programOverlayFromRoomMetadata(
      JSON.stringify({ programOverlay: { v: 1, logo: null, background: { color: "#112233", imageUrl: "" } } })
    );
    expect(r).toEqual({
      known: true,
      overlay: { v: 1, logo: null, background: { color: "#112233", imageUrl: "" }, lowerThird: null, banner: null },
    });
  });

  it("drops unsafe values", () => {
    expect(
      normalizeProgramOverlay({
        v: 1,
        logo: { url: "javascript:alert(1)", position: "top-left", size: 10, opacity: 1 },
        background: { color: "red;x:y", imageUrl: "data:image/png;base64,AA" },
      })
    ).toBeNull();
    const o = normalizeProgramOverlay({ v: 1, logo: { url: "https://x.example/l.png", position: "middle", size: 99, opacity: 0 } });
    expect(o?.logo).toEqual({ url: "https://x.example/l.png", position: "top-right", size: 30, opacity: 0.1 });
  });

  it("builds the same overlay a kit produces", () => {
    expect(overlayFromKit("https://x.example/l.png", DEFAULT_KIT_VIDEO)).toBeNull();
    expect(overlayFromKit("https://x.example/l.png", { ...DEFAULT_KIT_VIDEO, showLogo: true })?.logo?.position).toBe("top-right");
    expect(overlayFromKit("", { ...DEFAULT_KIT_VIDEO, showLogo: true })).toBeNull();
  });

  it("keeps lower third and banner text as plain, length-capped strings with a safe accent", () => {
    const o = normalizeProgramOverlay({
      v: 1,
      lowerThird: { name: "x".repeat(100), title: 5, accent: "red" },
      banner: { text: "Hello", scroll: "yes", accent: "#00aa55" },
    });
    expect(o?.lowerThird).toEqual({ name: "x".repeat(60), title: "", accent: "#dc2626" });
    expect(o?.banner).toEqual({ text: "Hello", scroll: false, accent: "#00aa55" });
  });
});
