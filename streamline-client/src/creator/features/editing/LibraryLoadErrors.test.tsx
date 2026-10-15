import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const listProjects = vi.fn();
const getMediaAssetsStrict = vi.fn();

vi.mock("../../../lib/projectsApi", () => ({
  listProjects: (...a: unknown[]) => listProjects(...a),
  listProjectAssets: vi.fn(async () => []),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
}));
vi.mock("../../../lib/editingApi", () => ({
  editingApi: { getMediaAssetsStrict: (...a: unknown[]) => getMediaAssetsStrict(...a) },
  mediaAssetToRecording: (a: unknown) => a,
}));
vi.mock("../../../hooks/useEffectiveEntitlements", () => ({
  useEffectiveEntitlements: () => ({ effectiveEntitlements: {}, loading: false }),
}));
vi.mock("../../../hooks/useFeatureAccess", () => ({
  useFeatureAccess: () => ({
    access: {
      contentLibrary: { allowed: true },
      myContentRecordings: { allowed: true },
      editor: { allowed: true },
    },
  }),
}));

import ProjectsDashboard from "./ProjectsDashboard";
import AssetLibrary from "./AssetLibrary";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("library pages on API failure (audit P2)", () => {
  it("projects: shows an error with retry, not 'no projects'", async () => {
    listProjects.mockRejectedValueOnce(new Error("HTTP 500"));
    render(<MemoryRouter><ProjectsDashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("couldn't load your projects"));
    listProjects.mockResolvedValueOnce([]);
    screen.getByRole("button", { name: "Try again" }).click();
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("content library: a thrown error ends the spinner with an error", async () => {
    getMediaAssetsStrict.mockRejectedValueOnce(new Error("unauthorized"));
    render(<MemoryRouter><AssetLibrary /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("couldn't load your content"));
  });
});
