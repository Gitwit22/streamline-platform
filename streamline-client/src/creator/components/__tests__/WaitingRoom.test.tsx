import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  apiGetWaitingRoom: vi.fn(),
  apiDecideWaiting: vi.fn(),
  apiAdmitAllWaiting: vi.fn(),
  apiUpdateRoomPolicy: vi.fn(),
}));
vi.mock("../../../lib/api", () => api);

import WaitingRoomPanel from "../WaitingRoomPanel";
import { WaitingForAdmissionCard } from "../RoomJoinGate";

afterEach(cleanup);

describe("WaitingForAdmissionCard", () => {
  it("tells the guest they're waiting to be let in, with a way out", () => {
    const onLeave = vi.fn();
    render(<WaitingForAdmissionCard elapsedMs={65_000} onLeave={onLeave} />);
    expect(screen.getByTestId("join-gate-waiting-room")).toHaveTextContent("You're in the waiting room");
    fireEvent.click(screen.getByTestId("join-gate-waiting-room-leave"));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});

describe("WaitingRoomPanel", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.apiGetWaitingRoom.mockResolvedValue({
      ok: true,
      enabled: true,
      entries: [
        { id: "id-bea", displayName: "Bea", waitingSince: 2 },
        { id: "id-al", displayName: "Al", waitingSince: 1 },
      ],
    });
    api.apiDecideWaiting.mockResolvedValue({ ok: true });
    api.apiAdmitAllWaiting.mockResolvedValue({ ok: true, admitted: 2 });
  });

  it("lists waiting people oldest first", async () => {
    render(<WaitingRoomPanel roomId="room1" roomAccessToken="rat" />);
    const rows = await screen.findAllByTestId("waiting-room-entry");
    expect(rows.map((r) => r.textContent)).toEqual(["AlAdmitDeny", "BeaAdmitDeny"]);
    expect(screen.getByTestId("waiting-room-toggle")).toHaveTextContent("Waiting Room On");
    expect(api.apiGetWaitingRoom).toHaveBeenCalledWith("room1", "rat");
  });

  it("admits and denies one person through the server", async () => {
    render(<WaitingRoomPanel roomId="room1" roomAccessToken="rat" />);
    fireEvent.click(await screen.findByLabelText("Admit Al"));
    await waitFor(() => expect(api.apiDecideWaiting).toHaveBeenCalledWith("room1", "rat", "id-al", "admit"));
    await waitFor(() => expect(screen.queryByLabelText("Admit Al")).toBeNull());

    fireEvent.click(screen.getByLabelText("Deny Bea"));
    await waitFor(() => expect(api.apiDecideWaiting).toHaveBeenCalledWith("room1", "rat", "id-bea", "deny"));
  });

  it("admits everyone at once", async () => {
    render(<WaitingRoomPanel roomId="room1" roomAccessToken="rat" />);
    fireEvent.click(await screen.findByTestId("waiting-room-admit-all"));
    await waitFor(() => expect(api.apiAdmitAllWaiting).toHaveBeenCalledWith("room1", "rat"));
    await waitFor(() => expect(screen.queryByTestId("waiting-room-list")).toBeNull());
  });

  it("turns the waiting room off through the room policy and shows what the server saved", async () => {
    api.apiUpdateRoomPolicy.mockResolvedValue({ ok: true, waitingRoomEnabled: false });
    render(<WaitingRoomPanel roomId="room1" roomAccessToken="rat" />);
    const toggle = await screen.findByTestId("waiting-room-toggle");
    await waitFor(() => expect(toggle).toHaveTextContent("Waiting Room On"));
    fireEvent.click(toggle);
    await waitFor(() => expect(api.apiUpdateRoomPolicy).toHaveBeenCalledWith("room1", "rat", { waitingRoomEnabled: false }));
    await waitFor(() => expect(toggle).toHaveTextContent("Waiting Room Off"));
  });

  it("says so when letting someone in fails, and keeps them on the list", async () => {
    api.apiDecideWaiting.mockRejectedValue(new Error("HTTP 500"));
    render(<WaitingRoomPanel roomId="room1" roomAccessToken="rat" />);
    fireEvent.click(await screen.findByLabelText("Admit Al"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't let them in");
    expect(screen.getByLabelText("Admit Al")).toBeInTheDocument();
  });
});
