import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const fetchMock = vi.fn();
vi.mock("../../../lib/api", () => ({
  apiFetchAuth: (...args: unknown[]) => fetchMock(...args),
}));

import GraphicsPanel from "../GraphicsPanel";

function res(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const LT = { id: "lt1", name: "Jane Doe", title: "CEO" };

function setup(initial: object, put: (body: Record<string, unknown>) => Response) {
  const puts: Record<string, unknown>[] = [];
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    expect(url).toContain("/api/rooms/r1/graphics");
    expect((init?.headers as Record<string, string>)["x-room-access-token"]).toBe("tok");
    if ((init?.method || "GET") === "GET") return res(200, initial);
    const body = JSON.parse(String(init?.body));
    puts.push(body);
    return put(body);
  });
  render(<GraphicsPanel open onClose={() => {}} roomId="r1" roomAccessToken="tok" />);
  return puts;
}

describe("GraphicsPanel", () => {
  afterEach(() => {
    cleanup();
    fetchMock.mockReset();
  });

  it("adds a lower third and shows it live", async () => {
    let rev = 0;
    const puts = setup({ graphics: { lowerThirds: [], banners: [] }, rev: 0 }, (body) => {
      rev += 1;
      return res(200, { graphics: body, rev });
    });
    fireEvent.change(await screen.findByLabelText("Lower third name"), { target: { value: " Jane Doe " } });
    fireEvent.change(screen.getByLabelText("Lower third title"), { target: { value: "CEO" } });
    fireEvent.click(screen.getByText("Add lower third"));
    const row = await screen.findByTestId("lower-third-row");
    expect(row.textContent).toContain("Jane Doe");
    expect(puts[0]).toMatchObject({ rev: 0, lowerThirds: [{ name: "Jane Doe", title: "CEO" }], activeLowerThirdId: null });

    fireEvent.click(screen.getByText("Show"));
    await screen.findByText("Hide");
    expect(puts[1]).toMatchObject({ rev: 1, activeLowerThirdId: (puts[0].lowerThirds as { id: string }[])[0].id });
  });

  it("adopts the server state on a conflict and says so", async () => {
    setup({ graphics: { lowerThirds: [LT], banners: [] }, rev: 4 }, () =>
      res(409, {
        error: "graphics_conflict",
        graphics: { lowerThirds: [LT, { id: "lt2", name: "Sam", title: "" }], banners: [], activeLowerThirdId: "lt2" },
        rev: 5,
      })
    );
    fireEvent.click(await screen.findByText("Show"));
    await screen.findByText(/Someone else changed the graphics/);
    const rows = screen.getAllByTestId("lower-third-row");
    expect(rows).toHaveLength(2);
    expect(rows[1].textContent).toContain("Hide");
  });

  it("does not show a change the plan rejected", async () => {
    setup({ graphics: { lowerThirds: [LT], banners: [] }, rev: 1 }, () => res(403, { error: "room_branding_not_in_plan" }));
    fireEvent.click(await screen.findByText("Show"));
    await screen.findByText(/not included in the room owner's plan/);
    expect(screen.getByText("Show")).toBeTruthy();
    expect(screen.queryByText("Hide")).toBeNull();
  });

  it("adds a scrolling banner", async () => {
    const puts = setup({ graphics: { lowerThirds: [], banners: [] }, rev: 0 }, (body) => res(200, { graphics: body, rev: 1 }));
    fireEvent.change(await screen.findByLabelText("Banner text"), { target: { value: "Follow us" } });
    fireEvent.click(screen.getByLabelText("Scroll across the screen"));
    fireEvent.click(screen.getByText("Add banner"));
    expect((await screen.findByTestId("banner-row")).textContent).toContain("Scrolling");
    expect(puts[0]).toMatchObject({ banners: [{ text: "Follow us", scroll: true }] });
  });
});
