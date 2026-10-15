import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OverlayBackground, OverlayLogo } from "../ProgramOverlayLayer";

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
        overlay={{ v: 1, logo: { url: "https://x.example/l.png", position: "bottom-left", size: 20, opacity: 0.5 }, background: null }}
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
    render(<OverlayBackground overlay={{ v: 1, logo: null, background: { color: "#112233", imageUrl: "https://x.example/bg.jpg" } }} />);
    const bg = screen.getByTestId("overlay-background");
    expect(bg.style.background).toContain("rgb(17, 34, 51)");
    expect(bg.querySelector("img")?.getAttribute("src")).toBe("https://x.example/bg.jpg");
  });
});
