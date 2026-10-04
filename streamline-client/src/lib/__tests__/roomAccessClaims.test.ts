import { describe, expect, it } from "vitest";
import {
  decodeRoomAccessToken,
  getRoomAccessPermissions,
  isEphemeralGuestIdentity,
  normalizeRoomRole,
} from "../roomAccessClaims";

function fakeJwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc(payload)}.sig`;
}

describe("roomAccessClaims", () => {
  it("decodes the payload of a room access token", () => {
    const t = fakeJwt({ roomId: "r1", role: "cohost", identity: "u1", permissions: { canInvite: true } });
    expect(decodeRoomAccessToken(t)).toMatchObject({ roomId: "r1", role: "cohost", identity: "u1" });
  });

  it("returns null for garbage", () => {
    expect(decodeRoomAccessToken(null)).toBeNull();
    expect(decodeRoomAccessToken("nope")).toBeNull();
    expect(decodeRoomAccessToken("a.!!!.c")).toBeNull();
  });

  it("extracts boolean permissions only", () => {
    const t = fakeJwt({ permissions: { canInvite: true, canStream: false, junk: "x" } });
    expect(getRoomAccessPermissions(t)).toEqual({ canInvite: true, canStream: false });
    expect(getRoomAccessPermissions(fakeJwt({ role: "guest" }))).toBeNull();
  });

  it("normalizes roles defensively", () => {
    expect(normalizeRoomRole("viewer")).toBe("viewer");
    expect(normalizeRoomRole("Guest")).toBe("guest");
    expect(normalizeRoomRole("co-host")).toBe("cohost");
    expect(normalizeRoomRole("moderator")).toBe("participant");
    expect(normalizeRoomRole("something-new")).toBeNull();
    expect(normalizeRoomRole(undefined)).toBeNull();
  });

  it("detects ephemeral invite identities", () => {
    expect(isEphemeralGuestIdentity("invite:abc123:9f8e7d")).toBe(true);
    expect(isEphemeralGuestIdentity("uid123")).toBe(false);
    expect(isEphemeralGuestIdentity("producer:a:b")).toBe(false);
    expect(isEphemeralGuestIdentity(null)).toBe(false);
  });
});
