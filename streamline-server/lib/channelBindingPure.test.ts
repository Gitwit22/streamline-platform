import test from "node:test";
import assert from "node:assert/strict";
import { channelBindingAllowed } from "./channelBindingPure";

// Regression (audit P0-2): any user could bind a room to another user's
// channel id (visible in /live/<id>) and, by starting HLS, make that channel
// play their stream.
test("a room can only be bound to its owner's live channel", () => {
  assert.equal(channelBindingAllowed({ ownerId: "victim" }, "attacker"), false);
  assert.equal(channelBindingAllowed({ ownerId: "u1" }, "u1"), true);
  assert.equal(channelBindingAllowed({ ownerId: "u1", archived: true }, "u1"), false);
  assert.equal(channelBindingAllowed({ ownerId: "u1", isDeleted: true }, "u1"), false);
  assert.equal(channelBindingAllowed({}, ""), false);
  assert.equal(channelBindingAllowed(null, "u1"), false);
});
