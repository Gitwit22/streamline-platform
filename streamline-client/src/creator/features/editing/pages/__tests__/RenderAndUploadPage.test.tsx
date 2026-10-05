import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const api = vi.hoisted(() => ({
  getExportOptions: vi.fn(),
  getMediaAssets: vi.fn(async () => []),
  startExport: vi.fn(),
  waitForExport: vi.fn(),
  cancelExport: vi.fn(),
  saveExportToLibrary: vi.fn(),
}));

vi.mock("../../../../../lib/editingApi", () => ({
  editingApi: api,
  EXPORT_TERMINAL_STATUSES: ["completed", "failed", "canceled"],
}));
vi.mock("../../../../../lib/projectsApi", () => ({
  getProject: vi.fn(async () => ({ id: "p1", name: "My Show" })),
}));

import RenderAndUploadPage from "../RenderAndUploadPage";

const OPTIONS = {
  resolutions: ["720p", "1080p"],
  maxResolution: "1080p",
  formats: ["mp4", "webm", "mov"],
  qualities: ["draft", "standard", "high"],
  fpsOptions: [24, 30, 60],
  exportsUsed: 2,
  exportsLimit: 10,
  priority: true,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/editing/export/p1"]}>
      <Routes>
        <Route path="/editing/export/:projectId" element={<RenderAndUploadPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RenderAndUploadPage export settings", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.values(api).forEach((f) => f.mockReset());
  });
  afterEach(cleanup);

  it("shows plan options and does not start an export until asked", async () => {
    api.getExportOptions.mockResolvedValue(OPTIONS);
    renderPage();
    await screen.findByTestId("export-settings");
    expect(api.startExport).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "4K" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/up to 1080p/)).toBeTruthy();
    expect(screen.getByTestId("export-usage").textContent).toContain("2 / 10");
    expect(screen.getByText(/Priority rendering/)).toBeTruthy();
  });

  it("starts with the chosen settings", async () => {
    api.getExportOptions.mockResolvedValue(OPTIONS);
    api.startExport.mockResolvedValue({ id: "j1", status: "completed", progress: 100, createdAt: "" });
    renderPage();
    await screen.findByTestId("export-settings");
    fireEvent.click(screen.getByRole("button", { name: "720p" }));
    fireEvent.change(screen.getByLabelText(/Quality/), { target: { value: "high" } });
    fireEvent.change(screen.getByLabelText(/Frame rate/), { target: { value: "60" } });
    fireEvent.click(screen.getByTestId("start-export"));
    await waitFor(() => expect(api.startExport).toHaveBeenCalledTimes(1));
    expect(api.startExport).toHaveBeenCalledWith("p1", { resolution: "720p", format: "mp4", quality: "high", fps: 60, watermark: null });
    await screen.findByText("Export Complete");
  });

  it("sends a text watermark and shows the plan-forced mark notice", async () => {
    api.getExportOptions.mockResolvedValue({ ...OPTIONS, watermark: { custom: true, forced: true } });
    api.startExport.mockResolvedValue({ id: "j1", status: "completed", progress: 100, createdAt: "" });
    renderPage();
    await screen.findByTestId("export-settings");
    expect(screen.getByText(/Made with Streamline/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    fireEvent.change(screen.getByLabelText("Watermark text"), { target: { value: "@mychannel" } });
    fireEvent.click(screen.getByTestId("start-export"));
    await waitFor(() => expect(api.startExport).toHaveBeenCalledTimes(1));
    expect(api.startExport.mock.calls[0][1].watermark).toEqual({
      kind: "text", text: "@mychannel", position: "bottom-right", sizePct: 5, opacityPct: 70,
    });
  });

  it("an empty text watermark is not sent; plans without custom watermarks hide the picker", async () => {
    api.getExportOptions.mockResolvedValue(OPTIONS);
    api.startExport.mockResolvedValue({ id: "j1", status: "completed", progress: 100, createdAt: "" });
    renderPage();
    await screen.findByTestId("export-settings");
    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    fireEvent.click(screen.getByTestId("start-export"));
    await waitFor(() => expect(api.startExport).toHaveBeenCalledTimes(1));
    expect(api.startExport.mock.calls[0][1].watermark).toBeNull();
    cleanup();
    localStorage.clear();
    api.getExportOptions.mockResolvedValue({ ...OPTIONS, watermark: { custom: false, forced: false } });
    renderPage();
    await screen.findByTestId("export-settings");
    expect(screen.getByText(/Custom watermarks aren't included/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Text" })).toBeNull();
  });

  it("blocks when the monthly limit is used and shows server refusals on the card", async () => {
    api.getExportOptions.mockResolvedValue({ ...OPTIONS, exportsUsed: 10 });
    renderPage();
    await screen.findByTestId("export-settings");
    expect((screen.getByTestId("start-export") as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    api.getExportOptions.mockResolvedValue(OPTIONS);
    api.startExport.mockRejectedValue(new Error("You've used all 10 exports for this month"));
    renderPage();
    await screen.findByTestId("export-settings");
    fireEvent.click(screen.getByTestId("start-export"));
    expect((await screen.findByRole("alert")).textContent).toContain("used all 10 exports");
    expect(screen.getByTestId("export-settings")).toBeTruthy();
  });
});
