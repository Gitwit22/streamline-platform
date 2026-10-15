import test from "node:test";
import assert from "node:assert/strict";
import { ROOM_DISPLAY_NAME_MAX, parseDisplayNameInput, roomDisplayName } from "./roomDisplayPure";

test("roomDisplayName prefers the rename, then the original names", () => {
  assert.equal(roomDisplayName({ displayName: " Friday Show ", roomName: "old" }, "r1"), "Friday Show");
  assert.equal(roomDisplayName({ roomName: "Legacy" }, "r1"), "Legacy");
  assert.equal(roomDisplayName({ livekitRoomName: "Alex – Weekly" }, "r1"), "Alex – Weekly");
  assert.equal(roomDisplayName({ displayName: "   " }, "r1"), "r1");
  assert.equal(roomDisplayName(null, "r1"), "r1");
});

test("parseDisplayNameInput: clears, trims, and rejects bad input", () => {
  assert.deepEqual(parseDisplayNameInput(null), { ok: true, value: null });
  assert.deepEqual(parseDisplayNameInput("   "), { ok: true, value: null });
  assert.deepEqual(parseDisplayNameInput("  Friday   Show & Co  "), { ok: true, value: "Friday Show & Co" });
  assert.equal(parseDisplayNameInput(5).ok, false);
  assert.equal(parseDisplayNameInput("<script>").ok, false);
  assert.equal(parseDisplayNameInput("a".repeat(ROOM_DISPLAY_NAME_MAX + 1)).ok, false);
});
