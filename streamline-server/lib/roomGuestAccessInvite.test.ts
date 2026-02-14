import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { extractInviteToken, tryGetLegacyInviteGuest } from "../routes/roomGuestAccess";

function signLegacyInvite(claims: { roomId: string; roomName: string; role: string }, secret: string) {
  return jwt.sign(claims, secret, { expiresIn: "1h" });
}

test("extractInviteToken: prefers header, then body, then query", () => {
  const req1: any = { headers: { "x-invite-token": " hdr " }, body: { inviteToken: "body" }, query: { t: "q" } };
  assert.equal(extractInviteToken(req1), "hdr");

  const req2: any = { headers: {}, body: { inviteToken: " body " }, query: { t: "q" } };
  assert.equal(extractInviteToken(req2), "body");

  const req3: any = { headers: {}, body: {}, query: { inviteToken: " q " } };
  assert.equal(extractInviteToken(req3), "q");

  const req4: any = { headers: {}, body: {}, query: { t: " tparam " } };
  assert.equal(extractInviteToken(req4), "tparam");
});

test("tryGetLegacyInviteGuest: accepts guest/participant roles only and matches roomId", () => {
  const secret = "test-invite-secret";
  process.env.INVITE_TOKEN_SECRET = secret;

  const roomId = "room_123";
  const okToken = signLegacyInvite({ roomId, roomName: "Test Room", role: "guest" }, secret);

  const reqOk: any = { headers: { "x-invite-token": okToken } };
  const guest = tryGetLegacyInviteGuest(reqOk, roomId);
  assert.ok(guest);
  assert.equal(guest.roomId, roomId);
  assert.equal(guest.role, "participant");
  assert.ok(String(guest.inviteId).startsWith("legacy:"));

  const wrongRoomToken = signLegacyInvite({ roomId: "room_other", roomName: "Other", role: "guest" }, secret);
  const reqWrong: any = { headers: { "x-invite-token": wrongRoomToken } };
  assert.equal(tryGetLegacyInviteGuest(reqWrong, roomId), null);

  const cohostToken = signLegacyInvite({ roomId, roomName: "Test Room", role: "cohost" }, secret);
  const reqCohost: any = { headers: { "x-invite-token": cohostToken } };
  assert.equal(tryGetLegacyInviteGuest(reqCohost, roomId), null);

  const moderatorToken = signLegacyInvite({ roomId, roomName: "Test Room", role: "moderator" }, secret);
  const reqMod: any = { headers: { "x-invite-token": moderatorToken } };
  assert.equal(tryGetLegacyInviteGuest(reqMod, roomId), null);

  const participantToken = signLegacyInvite({ roomId, roomName: "Test Room", role: "participant" }, secret);
  const reqParticipant: any = { headers: { "x-invite-token": participantToken } };
  assert.ok(tryGetLegacyInviteGuest(reqParticipant, roomId));
});
