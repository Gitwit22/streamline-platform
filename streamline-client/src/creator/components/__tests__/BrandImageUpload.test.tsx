import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchMock = vi.fn();
vi.mock("../../../lib/api", () => ({
  apiFetchAuth: (...args: unknown[]) => fetchMock(...args),
}));

import { KitVideoFields } from "../KitVideoFields";
import { BrandingFields } from "../HlsBrandingEditor";
import { DEFAULT_KIT_VIDEO } from "../../../lib/programOverlay";
import { EMPTY_BRANDING } from "../../../lib/hlsBranding";
import { validateBrandImageFile } from "../../../lib/brandAssets";

function res(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const UPLOADED = "https://api.example.com/api/public/brand-assets/u1/0123456789abcdef01234567.png";

function png(name = "logo.png", size = 10) {
  return new File([new Uint8Array(size)], name, { type: "image/png" });
}

describe("brand image uploads", () => {
  afterEach(() => {
    cleanup();
    fetchMock.mockReset();
  });

  it("uploads a background image and saves the returned URL into the kit", async () => {
    fetchMock.mockResolvedValue(res(201, { url: UPLOADED, contentType: "image/png", size: 10 }));
    const onChange = vi.fn();
    render(<KitVideoFields video={DEFAULT_KIT_VIDEO} logoUrl="" disabled={false} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Upload background"), { target: { files: [png("bg.png")] } });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_KIT_VIDEO, backgroundImageUrl: UPLOADED }));
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/brand-assets$/);
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("uploads a logo into logoUrl", async () => {
    fetchMock.mockResolvedValue(res(201, { url: UPLOADED }));
    const onChange = vi.fn();
    render(
      <BrandingFields
        draft={EMPTY_BRANDING}
        errors={{}}
        disabled={false}
        logoBroken={false}
        titlePlaceholder=""
        subtitlePlaceholder=""
        onChange={onChange}
      />
    );
    fireEvent.change(screen.getByLabelText("Upload logo"), { target: { files: [png()] } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("logoUrl", UPLOADED));
  });

  it("shows the server error and leaves the field unchanged when the upload is rejected", async () => {
    fetchMock.mockResolvedValue(res(403, { error: "brand_kits_not_in_plan" }));
    const onChange = vi.fn();
    render(<KitVideoFields video={DEFAULT_KIT_VIDEO} logoUrl="" disabled={false} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Upload background"), { target: { files: [png()] } });

    expect((await screen.findByRole("alert")).textContent).toMatch(/not included in your plan/);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rejects unsupported or oversized files before uploading", async () => {
    const onChange = vi.fn();
    render(<KitVideoFields video={DEFAULT_KIT_VIDEO} logoUrl="" disabled={false} onChange={onChange} />);
    const svg = new File(["<svg/>"], "x.svg", { type: "image/svg+xml" });
    fireEvent.change(screen.getByLabelText("Upload background"), { target: { files: [svg] } });

    expect((await screen.findByRole("alert")).textContent).toMatch(/PNG, JPG, GIF or WebP/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(validateBrandImageFile({ type: "image/png", size: 6 * 1024 * 1024 })).toMatch(/5 MB/);
    expect(validateBrandImageFile({ type: "image/webp", size: 100 })).toBeNull();
  });

  it("Remove clears an existing background", () => {
    const onChange = vi.fn();
    const video = { ...DEFAULT_KIT_VIDEO, backgroundImageUrl: UPLOADED };
    render(<KitVideoFields video={video} logoUrl="" disabled={false} onChange={onChange} />);
    expect(screen.getByText("Replace image")).toBeTruthy();
    fireEvent.click(screen.getByText("Remove"));
    expect(onChange).toHaveBeenCalledWith({ ...video, backgroundImageUrl: "" });
  });
});
