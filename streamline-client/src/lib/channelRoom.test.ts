import { describe, expect, it } from "vitest";
import { channelPlayRoomId, shouldSwitchChannelRoom } from "./channelRoom";

describe("channelPlayRoomId", () => {
  it("prefers the live room, else the home room", () => {
    expect(channelPlayRoomId({ activeRoomId: "live1", homeRoomId: "home" })).toBe("live1");
    expect(channelPlayRoomId({ activeRoomId: null, homeRoomId: "home" })).toBe("home");
    expect(channelPlayRoomId({ activeRoomId: null })).toBe("");
    expect(channelPlayRoomId(null)).toBe("");
  });
});

describe("shouldSwitchChannelRoom", () => {
  it("follows the channel only while not playing", () => {
    expect(shouldSwitchChannelRoom("", "r1", false)).toBe(true);
    expect(shouldSwitchChannelRoom("home", "r2", false)).toBe(true);
    expect(shouldSwitchChannelRoom("r1", "r2", true)).toBe(false);
    expect(shouldSwitchChannelRoom("r1", "r1", false)).toBe(false);
    expect(shouldSwitchChannelRoom("r1", "", false)).toBe(false);
  });
});
