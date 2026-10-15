import test from "node:test";
import assert from "node:assert/strict";
import { newRoomNaming } from "./roomNamingPure";

// Regression (audit P0-1): a typed room label became the LiveKit room name,
// so two hosts using the same label shared one LiveKit room (and anyone who
// knew a live room's name could create a room granting host rights in it).
test("new rooms use the server roomId as the LiveKit room name; the label is display-only", () => {
  const a = newRoomNaming("roomA123", "Morning Show");
  const b = newRoomNaming("roomB456", "Morning Show");
  assert.equal(a.livekitRoomName, "roomA123");
  assert.equal(b.livekitRoomName, "roomB456");
  assert.notEqual(a.livekitRoomName, b.livekitRoomName);
  assert.equal(a.displayName, "Morning Show");
  assert.deepEqual(newRoomNaming("r1", "   "), { livekitRoomName: "r1", displayName: undefined });
  assert.deepEqual(newRoomNaming("r1", undefined), { livekitRoomName: "r1", displayName: undefined });
});
