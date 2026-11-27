import { describe, expect, it } from "vitest";
import {
  normalizeWaitingRoomList,
  parseWaitingRoomStatus,
  waitingRoomGateFromMint,
  waitingRoomPillText,
} from "./waitingRoom";

describe("waitingRoomGateFromMint", () => {
  it("recognises the waiting and denied answers", () => {
    expect(waitingRoomGateFromMint(409, "waiting_room")).toBe("waiting");
    expect(waitingRoomGateFromMint(403, "waiting_room_denied")).toBe("denied");
  });

  it("leaves other answers alone (room_not_live keeps its own flow)", () => {
    expect(waitingRoomGateFromMint(409, "room_not_live")).toBeNull();
    expect(waitingRoomGateFromMint(409, null)).toBeNull();
    expect(waitingRoomGateFromMint(403, "not_allowed")).toBeNull();
    expect(waitingRoomGateFromMint(403, "waiting_room")).toBeNull();
  });
});

describe("normalizeWaitingRoomList", () => {
  it("keeps valid entries oldest first and names blanks Guest", () => {
    const out = normalizeWaitingRoomList({
      enabled: true,
      entries: [
        { id: "b", displayName: "Bea", waitingSince: 20 },
        { id: "a", displayName: " ", waitingSince: 10 },
        { id: "", displayName: "No id" },
        null,
        "junk",
      ],
    });
    expect(out).toEqual({
      enabled: true,
      entries: [
        { id: "a", displayName: "Guest", waitingSince: 10 },
        { id: "b", displayName: "Bea", waitingSince: 20 },
      ],
    });
  });

  it("treats a bad payload as an empty, disabled list", () => {
    expect(normalizeWaitingRoomList(null)).toEqual({ enabled: false, entries: [] });
    expect(normalizeWaitingRoomList({ enabled: "yes", entries: "x" })).toEqual({ enabled: false, entries: [] });
  });
});

describe("parseWaitingRoomStatus", () => {
  it("reads the count from room-status", () => {
    expect(parseWaitingRoomStatus({ waitingRoom: { enabled: true, count: 3 } })).toEqual({ enabled: true, count: 3 });
  });

  it("is off with no count when an older server doesn't send it", () => {
    expect(parseWaitingRoomStatus({ joinPage: { count: 1 } })).toEqual({ enabled: false, count: 0 });
    expect(parseWaitingRoomStatus({ waitingRoom: { enabled: true, count: -2 } })).toEqual({ enabled: true, count: 0 });
  });
});

describe("waitingRoomPillText", () => {
  it("says how many people are waiting", () => {
    expect(waitingRoomPillText(0)).toBeNull();
    expect(waitingRoomPillText(1)).toBe("1 person waiting to join");
    expect(waitingRoomPillText(4)).toBe("4 people waiting to join");
  });
});
