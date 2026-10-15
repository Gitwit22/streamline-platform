import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OverlayBackground, OverlayGraphics, OverlayLogo } from "../ProgramOverlayLayer";

describe("ProgramOverlayLayer", () => {
  afterEach(() => cleanup());

  it("renders nothing without an overlay", () => {
    const { container } = render(
      <>
        <OverlayBackground overlay={null} />
        <OverlayLogo overlay={null} shortSidePx={400} />
      </>
    );
    expect(container.innerHTML).toBe("");
  });

  it("places the logo in its corner with size, opacity and a 3% margin", () => {
    render(
      <OverlayLogo
        overlay={{ v: 1, logo: { url: "https://x.example/l.png", position: "bottom-left", size: 20, opacity: 0.5 }, background: null, lowerThird: null, banner: null }}
        shortSidePx={400}
      />
    );
    const img = screen.getByTestId("overlay-logo") as HTMLImageElement;
    expect(img.style.width).toBe("20%");
    expect(img.style.opacity).toBe("0.5");
    expect(img.style.bottom).toBe("12px");
    expect(img.style.left).toBe("12px");
    expect(img.style.top).toBe("");
  });

  it("draws the background color and image", () => {
    render(<OverlayBackground overlay={{ v: 1, logo: null, background: { color: "#112233", imageUrl: "https://x.example/bg.jpg" }, lowerThird: null, banner: null }} />);
    const bg = screen.getByTestId("overlay-background");
    expect(bg.style.background).toContain("rgb(17, 34, 51)");
    expect(bg.querySelector("img")?.getAttribute("src")).toBe("https://x.example/bg.jpg");
  });

  it("draws the lower third above the banner and lifts a bottom logo over the banner", () => {
    const overlay = {
      v: 1 as const,
      logo: { url: "https://x.example/l.png", position: "bottom-right" as const, size: 10, opacity: 1 },
      background: null,
      lowerThird: { name: "Jane Doe", title: "CEO", accent: "#00aa55" },
      banner: { text: "Follow us", scroll: true, accent: "#00aa55" },
    };
    render(
      <>
        <OverlayGraphics overlay={overlay} shortSidePx={400} />
        <OverlayLogo overlay={overlay} shortSidePx={400} />
      </>
    );
    const lt = screen.getByTestId("overlay-lower-third");
    const banner = screen.getByTestId("overlay-banner");
    expect(lt.textContent).toBe("Jane DoeCEO");
    expect(banner.textContent).toBe("Follow us");
    expect(banner.dataset.scroll).toBe("true");
    // label 12px -> banner 28.8px; lower third sits banner + 14.4px up.
    expect(lt.style.bottom).toBe("43px");
    expect((screen.getByTestId("overlay-logo") as HTMLImageElement).style.bottom).toBe("41px");
  });
});
