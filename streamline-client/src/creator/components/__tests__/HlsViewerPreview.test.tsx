import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HlsViewerPreview } from "../HlsBrandingEditor";
import { brandingFromConfig } from "../../../lib/hlsBranding";

describe("HlsViewerPreview", () => {
  afterEach(() => cleanup());

  it("renders the branding the public viewer will show", () => {
    render(
      <HlsViewerPreview
        branding={brandingFromConfig({ title: "My Channel", offlineMessage: "Live every Friday", theme: "light" })}
        embedName="Embed name"
      />
    );
    expect(screen.getByTestId("preview-title").textContent).toBe("My Channel");
    expect(screen.getByTestId("preview-offline").textContent).toBe("Live every Friday");
    expect(screen.getByTestId("hls-viewer-preview").getAttribute("data-theme")).toBe("light");
  });

  it("falls back to the embed name and dark theme", () => {
    render(<HlsViewerPreview branding={brandingFromConfig(null)} embedName="Weekly Show" />);
    expect(screen.getByTestId("preview-title").textContent).toBe("Weekly Show");
    expect(screen.getByTestId("hls-viewer-preview").getAttribute("data-theme")).toBe("dark");
  });
});
