import { describe, expect, it } from "vitest";
import { decodeJwtPayload, isJwtExpired, isUsableGuestSession } from "../guestSession";

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fakeJwt(payload: Record<string, unknown>): string {
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.sig`;
}

const NOW = 1_700_000_000_000;

describe("decodeJwtPayload", () => {
  it("decodes a payload", () => {
    expect(decodeJwtPayload(fakeJwt({ roomId: "r1" }))?.roomId).toBe("r1");
  });
  it("returns null for malformed tokens", () => {
    expect(decodeJwtPayload("nope")).toBeNull();
    expect(decodeJwtPayload("a.%%%.c")).toBeNull();
    expect(decodeJwtPayload(null)).toBeNull();
  });
});

describe("isJwtExpired", () => {
  it("is false for a future exp", () => {
    expect(isJwtExpired(fakeJwt({ exp: NOW / 1000 + 3600 }), NOW)).toBe(false);
  });
  it("is true for a past exp or one inside the skew", () => {
    expect(isJwtExpired(fakeJwt({ exp: NOW / 1000 - 1 }), NOW)).toBe(true);
    expect(isJwtExpired(fakeJwt({ exp: NOW / 1000 + 5 }), NOW)).toBe(true);
  });
  it("treats malformed tokens as expired and missing exp as usable", () => {
    expect(isJwtExpired("garbage", NOW)).toBe(true);
    expect(isJwtExpired(fakeJwt({ roomId: "r" }), NOW)).toBe(false);
  });
});

describe("isUsableGuestSession", () => {
  const exp = NOW / 1000 + 3600;
  it("requires the room to match", () => {
    expect(isUsableGuestSession(fakeJwt({ roomId: "r1", exp }), "r1", NOW)).toBe(true);
    expect(isUsableGuestSession(fakeJwt({ roomId: "r2", exp }), "r1", NOW)).toBe(false);
  });
  it("rejects expired sessions so a fresh invite link isn't hidden", () => {
    expect(isUsableGuestSession(fakeJwt({ roomId: "r1", exp: NOW / 1000 - 60 }), "r1", NOW)).toBe(false);
  });
});
