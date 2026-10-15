import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { JoinGateLayout } from "../RoomJoinGate";
import { normalizeJoinPageBranding, normalizePublicRoomInfo } from "../../../lib/roomJoin";

describe("join page branding", () => {
  afterEach(() => cleanup());

  it("shows the kit logo and channel title above the room name", () => {
    render(
      <JoinGateLayout roomName="Friday Show" branding={{ title: "My Channel", logoUrl: "https://x.example/l.png" }}>
        <div />
      </JoinGateLayout>
    );
    expect(screen.getByTestId("join-gate-logo").getAttribute("src")).toBe("https://x.example/l.png");
    expect(screen.getByTestId("join-gate-channel").textContent).toBe("My Channel");
    expect(screen.getByTestId("join-gate-header").textContent).toContain("Friday Show");
  });

  it("renders unbranded without a kit", () => {
    render(
      <JoinGateLayout roomName="Room">
        <div />
      </JoinGateLayout>
    );
    expect(screen.queryByTestId("join-gate-logo")).toBeNull();
    expect(screen.queryByTestId("join-gate-channel")).toBeNull();
  });

  it("parses displayName and drops unsafe logos", () => {
    const info = normalizePublicRoomInfo(200, {
      roomName: "abc123",
      displayName: "Friday Show",
      roomStatus: "live",
      branding: { title: "My Channel", logoUrl: "javascript:alert(1)" },
    });
    expect(info.displayName).toBe("Friday Show");
    expect(info.roomName).toBe("abc123");
    expect(info.branding).toEqual({ title: "My Channel", logoUrl: null });
    expect(normalizeJoinPageBranding({ title: "", logoUrl: "" })).toBeNull();
    // Older servers: no displayName / branding.
    const old = normalizePublicRoomInfo(200, { roomName: "abc123", status: "idle" });
    expect(old.displayName).toBeNull();
    expect(old.branding).toBeNull();
  });
});
