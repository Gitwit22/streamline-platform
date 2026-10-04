import { beforeEach, describe, expect, it } from "vitest";
import {
  classifyDisconnect,
  formatElapsed,
  hasRoomPermission,
  isAccessDeniedCode,
  joinPagePillText,
  nextMintRetryDelayMs,
  normalizePublicRoomInfo,
  parseJoinPagePresence,
  presenceDowngradeNotice,
  readShareToken,
  resolveRoomPermissions,
  storeShareToken,
} from "../roomJoin";

const b64 = (o: unknown) =>
  btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rat = (payload: unknown) => `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;

describe("resolveRoomPermissions", () => {
  it("uses the response permissions when present", () => {
    const p = resolveRoomPermissions({ canStream: true, canRecord: true, canModerate: false }, null);
    expect(p?.canStream).toBe(true);
    expect(p?.canRecord).toBe(true);
    expect(p?.canLayout).toBe(false);
  });

  it("falls back to the roomAccessToken claims when the field is missing", () => {
    const token = rat({ role: "cohost", permissions: { canStream: true, canModerate: true } });
    const p = resolveRoomPermissions(undefined, token);
    expect(p?.canStream).toBe(true);
    expect(p?.canModerate).toBe(true);
    // Legacy payloads: mute/remove follow canModerate.
    expect(p?.canMuteGuests).toBe(true);
    expect(p?.canRemoveGuests).toBe(true);
  });

  it("keeps explicit mute/remove flags", () => {
    const p = resolveRoomPermissions({ canModerate: true, canMuteGuests: false, canRemoveGuests: true }, null);
    expect(p?.canMuteGuests).toBe(false);
    expect(p?.canRemoveGuests).toBe(true);
  });

  it("returns null with no source", () => {
    expect(resolveRoomPermissions(null, null)).toBeNull();
    expect(resolveRoomPermissions(undefined, "not-a-jwt")).toBeNull();
  });
});

describe("hasRoomPermission", () => {
  it("lets co-hosts record/stream from permissions or RAT claims", () => {
    expect(hasRoomPermission("canRecord", { isHost: false, roomPermissions: null, ratPermissions: { canRecord: true } })).toBe(true);
    expect(
      hasRoomPermission("canStream", { isHost: false, roomPermissions: { canStream: true }, ratPermissions: null }),
    ).toBe(true);
    expect(hasRoomPermission("canStream", { isHost: false })).toBe(false);
  });
  it("host always, nobody while re-auth is needed", () => {
    expect(hasRoomPermission("canLayout", { isHost: true })).toBe(true);
    expect(hasRoomPermission("canLayout", { isHost: true, needsReauth: true })).toBe(false);
  });
});

describe("normalizePublicRoomInfo", () => {
  it("maps 404 to not_found", () => {
    expect(normalizePublicRoomInfo(404, null).status).toBe("not_found");
  });
  it("prefers roomStatus and falls back to status", () => {
    expect(normalizePublicRoomInfo(200, { roomStatus: "ended", status: "idle" }).status).toBe("ended");
    expect(normalizePublicRoomInfo(200, { status: "live", roomName: " R ", hostName: "H" })).toMatchObject({
      status: "live",
      roomName: "R",
      hostName: "H",
      allowGuests: true,
    });
    expect(normalizePublicRoomInfo(200, {}).status).toBe("unknown");
  });
});

describe("classifyDisconnect", () => {
  it("only an explicit leave is a leave", () => {
    expect(classifyDisconnect(1, true)).toBe("explicit");
    expect(classifyDisconnect(undefined, true)).toBe("explicit");
  });
  it("treats unknown / failed connect / network drop as an error", () => {
    expect(classifyDisconnect(undefined, false)).toBe("error");
    expect(classifyDisconnect(0, false)).toBe("error");
    expect(classifyDisconnect(3, false)).toBe("error");
  });
  it("recognizes client, removed, room deleted and duplicate", () => {
    expect(classifyDisconnect(1, false)).toBe("client");
    expect(classifyDisconnect(4, false)).toBe("removed");
    expect(classifyDisconnect(5, false)).toBe("ended");
    expect(classifyDisconnect(2, false)).toBe("duplicate");
  });
});

describe("join page presence", () => {
  it("parses joinPage and tolerates missing fields", () => {
    expect(parseJoinPagePresence({ joinPage: { count: 2, names: ["Ann", "", "Bob"], lastSeenAt: 5 } })).toEqual({
      count: 2,
      names: ["Ann", "Bob"],
      lastSeenAt: 5,
    });
    expect(parseJoinPagePresence({ joinPage: { names: ["Ann"] } })?.count).toBe(1);
    expect(parseJoinPagePresence({})).toBeNull();
    expect(parseJoinPagePresence({ hasJoinPageView: true, hasEnteredRoom: false })?.count).toBe(1);
  });
  it("builds pill text and hides at 0", () => {
    expect(joinPagePillText(null)).toBe("");
    expect(joinPagePillText({ count: 0, names: [], lastSeenAt: null })).toBe("");
    expect(joinPagePillText({ count: 1, names: ["Ann"], lastSeenAt: null })).toBe("Ann is viewing the join page");
    expect(joinPagePillText({ count: 3, names: ["Ann", "Bob", "Cy"], lastSeenAt: null })).toBe(
      "Ann, Bob +1 viewing the join page",
    );
    expect(joinPagePillText({ count: 1, names: [], lastSeenAt: null })).toBe("Guest is viewing the join page");
    expect(joinPagePillText({ count: 4, names: [], lastSeenAt: null })).toBe("4 guests are viewing the join page");
  });
});

describe("misc helpers", () => {
  beforeEach(() => sessionStorage.clear());

  it("backoff grows and caps", () => {
    expect(nextMintRetryDelayMs(0)).toBe(4000);
    expect(nextMintRetryDelayMs(1)).toBe(8000);
    expect(nextMintRetryDelayMs(10)).toBe(30000);
  });
  it("formats elapsed time", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(65_000)).toBe("1:05");
    expect(formatElapsed(3_725_000)).toBe("1:02:05");
  });
  it("stores share tokens per room", () => {
    expect(readShareToken("r1")).toBeNull();
    storeShareToken("r1", "tok");
    expect(readShareToken("r1")).toBe("tok");
    expect(readShareToken("r2")).toBeNull();
  });
  it("classifies 403 codes", () => {
    expect(isAccessDeniedCode("not_allowed")).toBe(true);
    expect(isAccessDeniedCode(null)).toBe(true);
    expect(isAccessDeniedCode("login_required")).toBe(false);
  });
  it("notices invisible downgrades only", () => {
    expect(presenceDowngradeNotice("invisible", "normal")).toMatch(/Invisible/);
    expect(presenceDowngradeNotice("invisible", "invisible")).toBeNull();
    expect(presenceDowngradeNotice("normal", "normal")).toBeNull();
    expect(presenceDowngradeNotice("invisible", undefined)).toBeNull();
  });
});
