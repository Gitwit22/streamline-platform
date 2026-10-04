import { describe, expect, it } from "vitest";
import { buildGuestPresenceBody } from "../telemetry";

describe("buildGuestPresenceBody", () => {
  it("includes stage, roomId and legacy event; drops empty fields", () => {
    const body = buildGuestPresenceBody({ roomId: "r1", stage: "join_page", displayName: "  Ann ", identity: null });
    expect(body).toMatchObject({ roomId: "r1", stage: "join_page", event: "guest_join_page", displayName: "Ann" });
    expect(body).not.toHaveProperty("identity");
    expect(body).not.toHaveProperty("guestSessionToken");
    expect(typeof body.ts).toBe("number");
  });

  it("passes identity and guest session when known", () => {
    const body = buildGuestPresenceBody({ roomId: "r1", stage: "left", identity: "g1", guestSessionToken: "gst" });
    expect(body).toMatchObject({ stage: "left", identity: "g1", guestSessionToken: "gst" });
  });
});
