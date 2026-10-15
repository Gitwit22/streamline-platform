import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchMock = vi.fn();
vi.mock("../../../../lib/api", () => ({
  apiFetchAuth: (...args: unknown[]) => fetchMock(...args),
}));

import SettingsBrandKits from "../SettingsBrandKits";

function res(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const KIT = {
  id: "k1",
  name: "Main show",
  title: "Friday Live",
  subtitle: "",
  logoUrl: "",
  offlineMessage: "",
  theme: "dark",
  updatedAt: null,
};

function route(handlers: Record<string, (init?: RequestInit) => Response>) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    const path = url.replace(/^.*?\/api\//, "/api/");
    const h = handlers[`${method} ${path}`];
    if (!h) throw new Error(`unexpected ${method} ${path}`);
    return h(init);
  });
}

describe("SettingsBrandKits", () => {
  afterEach(() => {
    cleanup();
    fetchMock.mockReset();
  });

  it("lists kits and marks the default", async () => {
    route({ "GET /api/brand-kits": () => res(200, { kits: [KIT], defaultKitId: "k1", canEdit: true, blockedReason: null }) });
    render(<SettingsBrandKits />);
    const row = await screen.findByTestId("brand-kit-row");
    expect(row.textContent).toContain("Main show");
    expect(row.textContent).toContain("Default");
  });

  it("creates the first kit as the default and sends trimmed fields", async () => {
    let posted: Record<string, unknown> | null = null;
    route({
      "GET /api/brand-kits": () => res(200, { kits: [], defaultKitId: null, canEdit: true, blockedReason: null }),
      "POST /api/brand-kits": (init) => {
        posted = JSON.parse(String(init?.body));
        return res(201, { kit: { ...KIT, name: "Main show" }, defaultKitId: "k1" });
      },
    });
    render(<SettingsBrandKits />);
    fireEvent.click(await screen.findByText("New brand kit"));
    const createBtn = screen.getByText("Create kit") as HTMLButtonElement;
    // Name is required.
    expect(createBtn.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("e.g. Main show"), { target: { value: "  Main show " } });
    fireEvent.change(screen.getByPlaceholderText("Your channel name"), { target: { value: " Friday Live " } });
    fireEvent.click(screen.getByText("Create kit"));
    await screen.findByText("Kit created.");
    expect(posted).toMatchObject({ name: "Main show", title: "Friday Live", theme: "dark", makeDefault: true });
    expect((await screen.findByTestId("brand-kit-row")).textContent).toContain("Default");
  });

  it("shows the server error instead of claiming success", async () => {
    route({
      "GET /api/brand-kits": () => res(200, { kits: [], defaultKitId: null, canEdit: true, blockedReason: null }),
      "POST /api/brand-kits": () => res(409, { error: "brand_kit_limit_reached" }),
    });
    render(<SettingsBrandKits />);
    fireEvent.click(await screen.findByText("New brand kit"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Main show"), { target: { value: "Kit" } });
    fireEvent.click(screen.getByText("Create kit"));
    await screen.findByText("You've reached the maximum number of brand kits.");
    expect(screen.queryByText("Kit created.")).toBeNull();
    expect(screen.queryByTestId("brand-kit-row")).toBeNull();
  });

  it("locks creation when the plan lacks branding", async () => {
    route({ "GET /api/brand-kits": () => res(200, { kits: [KIT], defaultKitId: null, canEdit: false, blockedReason: "plan" }) });
    render(<SettingsBrandKits onUpgrade={() => {}} />);
    await screen.findByText("Brand kits are not included in your plan");
    expect((screen.getByText("New brand kit") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Make default") as HTMLButtonElement).disabled).toBe(true);
    // Cleanup stays available.
    expect((screen.getByText("Delete") as HTMLButtonElement).disabled).toBe(false);
  });

  it("deletes a kit after confirmation and clears the default", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    route({
      "GET /api/brand-kits": () => res(200, { kits: [KIT], defaultKitId: "k1", canEdit: true, blockedReason: null }),
      "DELETE /api/brand-kits/k1": () => res(200, { success: true }),
    });
    render(<SettingsBrandKits />);
    fireEvent.click(await screen.findByText("Delete"));
    await screen.findByText("You don't have any brand kits yet.");
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId("brand-kit-row")).toBeNull());
    confirmSpy.mockRestore();
  });
});
