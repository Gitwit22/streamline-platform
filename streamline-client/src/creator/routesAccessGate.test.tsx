import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, useLocation } from "react-router-dom";

vi.mock("./pages/Join", () => ({ default: () => <div>join page</div> }));
vi.mock("./pages/MonetizationSetup", () => ({ default: () => <div>monetization page</div> }));
vi.mock("./features/editing/AssetLibrary", () => ({ default: () => <div>content page</div> }));

import { creatorRoutes, type CreatorRouteFlags } from "./routes";

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

const denied: CreatorRouteFlags = {
  canContentLibrary: false,
  canMyContentRecordings: false,
  canProjects: false,
  canEditor: false,
  canMyContent: false,
  canMonetization: false,
  myContentTarget: null,
};

function renderAt(path: string, flags: CreatorRouteFlags) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>{creatorRoutes(flags)}</Routes>
      <Where />
    </MemoryRouter>
  );
}

describe("gated creator routes (audit P1-6)", () => {
  afterEach(cleanup);

  it("waits on a deep link while access is loading instead of redirecting", () => {
    for (const path of ["/content", "/settings/monetization"]) {
      const { unmount } = renderAt(path, { ...denied, accessLoading: true });
      expect(screen.getByTestId("where").textContent).toBe(path);
      expect(screen.getByRole("status").textContent).toContain("Loading");
      unmount();
    }
  });

  it("renders the page once access has loaded and allows it", () => {
    renderAt("/settings/monetization", { ...denied, canMonetization: true, accessLoading: false });
    expect(screen.getByText("monetization page")).toBeTruthy();
  });

  it("still redirects once access has loaded and denies it", () => {
    renderAt("/content", { ...denied, accessLoading: false });
    expect(screen.getByTestId("where").textContent).toBe("/join");
    expect(screen.getByText("join page")).toBeTruthy();
  });
});
