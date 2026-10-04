import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROOM_ACCESS,
  ROOM_ACCESS_OPTIONS,
  isAccountIdentity,
  normalizeRoomAccess,
  roomAccessInviteSummary,
  roomAccessLabel,
} from "./roomAccess";

describe("roomAccess helpers", () => {
  it("defaults to invite only", () => {
    expect(DEFAULT_ROOM_ACCESS).toBe("invite_only");
    expect(ROOM_ACCESS_OPTIONS[0].value).toBe("invite_only");
    expect(normalizeRoomAccess(undefined)).toBe("invite_only");
    expect(normalizeRoomAccess("bogus")).toBe("invite_only");
  });

  it("normalizes server values", () => {
    expect(normalizeRoomAccess("link")).toBe("link");
    expect(normalizeRoomAccess("Anyone With Link")).toBe("link");
    expect(normalizeRoomAccess("PUBLIC")).toBe("public");
    expect(normalizeRoomAccess("invite_only")).toBe("invite_only");
  });

  it("isAccountIdentity rejects anonymous guests and accepts uids", () => {
    expect(isAccountIdentity("invite:abc:1234")).toBe(false);
    expect(isAccountIdentity("guest_1700_ab12")).toBe(false);
    expect(isAccountIdentity("producer:uid:owner")).toBe(false);
    expect(isAccountIdentity("")).toBe(false);
    expect(isAccountIdentity(null)).toBe(false);
    expect(isAccountIdentity("kX9f2LmQ1aZpR7tYvB3cW8nD4eH2")).toBe(true);
  });

  it("labels and summaries", () => {
    expect(roomAccessLabel("invite_only")).toBe("Invite Only");
    expect(roomAccessLabel("link")).toBe("Anyone With Link");
    expect(roomAccessLabel("public")).toBe("Public");
    expect(roomAccessInviteSummary("invite_only")).toMatch(/Invite only/);
    expect(roomAccessInviteSummary("link")).toMatch(/watch/);
  });
});
