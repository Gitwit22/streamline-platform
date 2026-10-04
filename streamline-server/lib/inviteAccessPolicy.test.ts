import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import {
  extractInviteToken,
  tryGetLegacyInviteGuest,
  getInviteClaimsForRoom,
  inviteClaimRoleToGuestRole,
  roomAccessRoleToShareRole,
  tryGetRoomAccessShareGuest,
  normalizeJoinNonce,
  joinNowIdentity,
} from "../routes/roomGuestAccess";
import {
  signGuestSession,
  parseGuestSessionToken,
  selectGuestSession,
  tryGetGuestSession,
} from "../middleware/guestSession";
import { verifyInviteToken, inviteTokenSignOptions, getInviteTokenSecret } from "../middleware/requireAuth";
import {
  acceptanceDocId,
  normalizeAcceptanceRole,
  mergeAcceptanceRole,
  parseAcceptance,
  isFirestoreInviteId,
  isInviteShapedClaims,
  jwtInviteAcceptanceId,
} from "./inviteAcceptance";
import { inviteGrantsCohostForRoom } from "./rolePermissions";

const INVITE_SECRET = "test-invite-secret";
const ROOM_ACCESS_SECRET = "test-room-access-secret";
const GUEST_SECRET = "test-guest-session-secret";
const ROOM = "room_abc";

function setSecrets() {
  process.env.INVITE_TOKEN_SECRET = INVITE_SECRET;
  process.env.ROOM_ACCESS_TOKEN_SECRET = ROOM_ACCESS_SECRET;
  process.env.GUEST_SESSION_SECRET = GUEST_SECRET;
  delete process.env.INVITE_TOKEN_ISS;
  delete process.env.INVITE_TOKEN_AUD;
  delete process.env.INVITE_TOKEN_REQUIRE_ISS_AUD;
}

function roomAccessToken(role: string, roomId = ROOM, secret = ROOM_ACCESS_SECRET) {
  return jwt.sign(
    { roomId, roomName: "R", livekitRoomName: roomId, role, permissions: {}, identity: "uid_1" },
    secret,
    { expiresIn: "12h" },
  );
}

function inviteToken(role: string, roomId = ROOM, opts: jwt.SignOptions = { expiresIn: "1h" }) {
  return jwt.sign({ roomId, roomName: "R", role, createdByUid: "owner_1" }, INVITE_SECRET, opts);
}

// ---------------------------------------------------------------------------
// Publish-bypass: room access tokens are never invites
// ---------------------------------------------------------------------------

test("extractInviteToken ignores x-room-access-token", () => {
  const req: any = { headers: { "x-room-access-token": "rat" }, body: {}, query: {} };
  assert.equal(extractInviteToken(req), null);
});

test("a viewer room access token is not invite evidence", () => {
  setSecrets();
  const rat = roomAccessToken("viewer");
  const viaHeader: any = { headers: { "x-room-access-token": rat }, body: {}, query: {} };
  const viaInviteHeader: any = { headers: { "x-invite-token": rat }, body: {}, query: {} };
  assert.equal(tryGetLegacyInviteGuest(viaHeader, ROOM), null);
  assert.equal(tryGetLegacyInviteGuest(viaInviteHeader, ROOM), null);
  assert.equal(getInviteClaimsForRoom(viaHeader, ROOM), null);
  assert.equal(getInviteClaimsForRoom(viaInviteHeader, ROOM), null);
});

test("shared JWT_SECRET fallback: room access token still not accepted as an invite", () => {
  setSecrets();
  // Same secret for both token kinds, as when only JWT_SECRET is configured.
  const rat = roomAccessToken("viewer", ROOM, INVITE_SECRET);
  const req: any = { headers: { "x-invite-token": rat }, body: {}, query: {} };
  assert.equal(getInviteClaimsForRoom(req, ROOM), null);
  assert.equal(tryGetLegacyInviteGuest(req, ROOM), null);
});

test("invite JWT for the room is accepted, including cohost (for authed checks)", () => {
  setSecrets();
  const req: any = { headers: { "x-invite-token": inviteToken("cohost") }, body: {}, query: {} };
  const claims = getInviteClaimsForRoom(req, ROOM);
  assert.ok(claims);
  assert.equal(claims!.role, "cohost");
  assert.equal(claims!.createdByUid, "owner_1");
  // ...but cohost never becomes an anonymous guest
  assert.equal(tryGetLegacyInviteGuest(req, ROOM), null);
  // host invites never count
  const hostReq: any = { headers: { "x-invite-token": inviteToken("host") }, body: {}, query: {} };
  assert.equal(getInviteClaimsForRoom(hostReq, ROOM), null);
  // other room
  const otherReq: any = { headers: { "x-invite-token": inviteToken("guest", "room_other") }, body: {}, query: {} };
  assert.equal(getInviteClaimsForRoom(otherReq, ROOM), null);
});

test("inviteClaimRoleToGuestRole maps legacy invite roles and rejects elevated ones", () => {
  assert.equal(inviteClaimRoleToGuestRole("guest"), "participant");
  assert.equal(inviteClaimRoleToGuestRole(" Participant "), "participant");
  assert.equal(inviteClaimRoleToGuestRole("viewer"), "guest");
  assert.equal(inviteClaimRoleToGuestRole("cohost"), null);
  assert.equal(inviteClaimRoleToGuestRole("moderator"), null);
  assert.equal(inviteClaimRoleToGuestRole("host"), null);
  assert.equal(inviteClaimRoleToGuestRole("admin"), null);
  assert.equal(inviteClaimRoleToGuestRole(undefined), null);
});

test("roomAccessRoleToShareRole never elevates", () => {
  assert.equal(roomAccessRoleToShareRole("viewer"), "viewer");
  assert.equal(roomAccessRoleToShareRole("guest"), "guest");
  assert.equal(roomAccessRoleToShareRole("participant"), "guest");
  assert.equal(roomAccessRoleToShareRole("cohost"), null);
  assert.equal(roomAccessRoleToShareRole("host"), null);
  assert.equal(roomAccessRoleToShareRole(""), null);
});

test("tryGetRoomAccessShareGuest keeps viewer share links subscribe-only", () => {
  setSecrets();
  const viewer: any = { headers: { "x-invite-token": roomAccessToken("viewer") }, body: {}, query: {} };
  assert.equal(tryGetRoomAccessShareGuest(viewer, ROOM)?.role, "viewer");
  const participant: any = { headers: { "x-room-access-token": roomAccessToken("participant") }, body: {}, query: {} };
  assert.equal(tryGetRoomAccessShareGuest(participant, ROOM)?.role, "guest");
  const host: any = { headers: { "x-room-access-token": roomAccessToken("host") }, body: {}, query: {} };
  assert.equal(tryGetRoomAccessShareGuest(host, ROOM), null);
  const other: any = { headers: { "x-room-access-token": roomAccessToken("viewer", "room_other") }, body: {}, query: {} };
  assert.equal(tryGetRoomAccessShareGuest(other, ROOM), null);
});

// ---------------------------------------------------------------------------
// Stable identities
// ---------------------------------------------------------------------------

test("normalizeJoinNonce accepts only url-safe 16..128 char strings", () => {
  assert.equal(normalizeJoinNonce("abcdefghijklmnop"), "abcdefghijklmnop");
  assert.equal(normalizeJoinNonce("short"), null);
  assert.equal(normalizeJoinNonce("has spaces in it here"), null);
  assert.equal(normalizeJoinNonce(undefined), null);
  assert.equal(normalizeJoinNonce("x".repeat(129)), null);
});

test("joinNowIdentity is stable per nonce and distinct across nonces", () => {
  const a1 = joinNowIdentity("inv1", "nonce-aaaaaaaaaaaaaaaa");
  const a2 = joinNowIdentity("inv1", "nonce-aaaaaaaaaaaaaaaa");
  const b = joinNowIdentity("inv1", "nonce-bbbbbbbbbbbbbbbb");
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
  assert.ok(a1.startsWith("invite:inv1:"));
  // Without a nonce, never reuse an identity.
  assert.notEqual(joinNowIdentity("inv1", null), joinNowIdentity("inv1", null));
});

test("guest session carries identity through sign/parse", () => {
  setSecrets();
  const t = signGuestSession({ inviteId: "inv1", roomId: ROOM, role: "guest", identity: "invite:inv1:abc" }, "1h");
  const parsed = parseGuestSessionToken(t);
  assert.equal(parsed?.identity, "invite:inv1:abc");
  const noId = parseGuestSessionToken(signGuestSession({ inviteId: "inv1", roomId: ROOM, role: "guest" }, "1h"));
  assert.equal(noId?.identity, undefined);
});

// ---------------------------------------------------------------------------
// Guest session selection: header vs cookie
// ---------------------------------------------------------------------------

test("selectGuestSession prefers the first candidate and the requested room", () => {
  const a = { inviteId: "a", roomId: "room_a", role: "guest" as const };
  const b = { inviteId: "b", roomId: "room_b", role: "guest" as const };
  assert.equal(selectGuestSession([a, b])?.inviteId, "a");
  assert.equal(selectGuestSession([a, b], "room_b")?.inviteId, "b");
  assert.equal(selectGuestSession([a, b], "room_c")?.inviteId, "a");
  assert.equal(selectGuestSession([null, b])?.inviteId, "b");
  assert.equal(selectGuestSession([]), null);
});

test("tryGetGuestSession prefers the header over the cookie, and the room match when they differ", () => {
  setSecrets();
  const forRoom = signGuestSession({ inviteId: "hdr", roomId: ROOM, role: "guest" }, "1h");
  const otherRoom = signGuestSession({ inviteId: "ck", roomId: "room_other", role: "guest" }, "1h");

  const both: any = { headers: { "x-guest-session": forRoom }, cookies: { sl_guest: otherRoom }, body: {}, query: {} };
  assert.equal(tryGetGuestSession(both)?.inviteId, "hdr");
  assert.equal(tryGetGuestSession(both, ROOM)?.inviteId, "hdr");

  // Header for another room, cookie for this room: room match wins.
  const swapped: any = { headers: { "x-guest-session": otherRoom }, cookies: { sl_guest: forRoom }, body: {}, query: {} };
  assert.equal(tryGetGuestSession(swapped)?.inviteId, "ck");
  assert.equal(tryGetGuestSession(swapped, ROOM)?.inviteId, "hdr");

  // Expired header falls back to a valid cookie.
  const expired = jwt.sign({ inviteId: "old", roomId: ROOM, role: "guest", exp: Math.floor(Date.now() / 1000) - 10 }, GUEST_SECRET);
  const exp: any = { headers: { "x-guest-session": expired }, cookies: { sl_guest: forRoom }, body: {}, query: {} };
  assert.equal(tryGetGuestSession(exp, ROOM)?.inviteId, "hdr");
});

// ---------------------------------------------------------------------------
// Invite secret / iss / aud
// ---------------------------------------------------------------------------

test("invite secret is trimmed for both signing and verifying", () => {
  setSecrets();
  process.env.INVITE_TOKEN_SECRET = `  ${INVITE_SECRET}  `;
  assert.equal(getInviteTokenSecret(), INVITE_SECRET);
  const t = jwt.sign({ roomId: ROOM, role: "guest" }, getInviteTokenSecret(), inviteTokenSignOptions("1h"));
  assert.equal((verifyInviteToken(t) as any).roomId, ROOM);
  setSecrets();
});

test("iss/aud: set when signing, and legacy tokens without them still verify", () => {
  setSecrets();
  process.env.INVITE_TOKEN_ISS = "streamline";
  process.env.INVITE_TOKEN_AUD = "invites";
  try {
    const fresh = jwt.sign({ roomId: ROOM, role: "guest" }, getInviteTokenSecret(), inviteTokenSignOptions("1h"));
    const decoded = jwt.decode(fresh) as any;
    assert.equal(decoded.iss, "streamline");
    assert.equal(decoded.aud, "invites");
    assert.ok(verifyInviteToken(fresh));

    const legacy = inviteToken("guest");
    assert.ok(verifyInviteToken(legacy));

    const wrongIss = inviteToken("guest", ROOM, { expiresIn: "1h", issuer: "evil" });
    assert.throws(() => verifyInviteToken(wrongIss));

    process.env.INVITE_TOKEN_REQUIRE_ISS_AUD = "1";
    assert.throws(() => verifyInviteToken(legacy));
    assert.ok(verifyInviteToken(fresh));
  } finally {
    setSecrets();
  }
});

// ---------------------------------------------------------------------------
// Acceptances
// ---------------------------------------------------------------------------

test("acceptance helpers", () => {
  assert.equal(acceptanceDocId("r1", "u1"), "r1_u1");
  assert.equal(normalizeAcceptanceRole("cohost"), "cohost");
  assert.equal(normalizeAcceptanceRole("moderator"), "cohost");
  assert.equal(normalizeAcceptanceRole("guest"), "participant");
  assert.equal(normalizeAcceptanceRole("host"), null);
  assert.equal(mergeAcceptanceRole("cohost", "participant"), "cohost");
  assert.equal(mergeAcceptanceRole("participant", "cohost"), "cohost");
  assert.equal(mergeAcceptanceRole(undefined, "participant"), "participant");

  const now = 1_000_000;
  const base = { roomId: "r1", uid: "u1", inviteId: "inv1", role: "participant" };
  assert.equal(parseAcceptance(base, "r1", "u1", now)?.role, "participant");
  assert.equal(parseAcceptance(base, "r2", "u1", now), null);
  assert.equal(parseAcceptance(base, "r1", "u2", now), null);
  assert.equal(parseAcceptance({ ...base, expiresAtMs: now - 1 }, "r1", "u1", now), null);
  assert.ok(parseAcceptance({ ...base, expiresAtMs: now + 1 }, "r1", "u1", now));
  assert.equal(parseAcceptance({ ...base, revokedAt: new Date() }, "r1", "u1", now), null);
  assert.equal(parseAcceptance({ ...base, role: "host" }, "r1", "u1", now), null);

  assert.equal(isFirestoreInviteId("abc123"), true);
  assert.equal(isFirestoreInviteId("jwt:abc"), false);
  assert.equal(isFirestoreInviteId("legacy:abc"), false);
  assert.equal(isFirestoreInviteId("direct:r:i"), false);
  assert.equal(isFirestoreInviteId(""), false);

  assert.ok(jwtInviteAcceptanceId("tok").startsWith("jwt:"));
  assert.equal(jwtInviteAcceptanceId("tok"), jwtInviteAcceptanceId("tok"));
});

test("isInviteShapedClaims rejects room access tokens and guest sessions", () => {
  assert.equal(isInviteShapedClaims({ roomId: "r", role: "guest", roomName: "R" }), true);
  assert.equal(isInviteShapedClaims({ roomId: "r", role: "viewer", livekitRoomName: "r", permissions: {} }), false);
  assert.equal(isInviteShapedClaims({ roomId: "r", role: "guest", inviteId: "i" }), false);
  assert.equal(isInviteShapedClaims(null), false);
});

test("inviteGrantsCohostForRoom requires a cohost invite for this room id", () => {
  assert.equal(inviteGrantsCohostForRoom({ roomId: ROOM, role: "cohost" }, ROOM), true);
  assert.equal(inviteGrantsCohostForRoom({ roomId: ROOM, role: "moderator" }, ROOM), true);
  assert.equal(inviteGrantsCohostForRoom({ roomId: ROOM, role: "guest" }, ROOM), false);
  assert.equal(inviteGrantsCohostForRoom({ roomId: "room_other", role: "cohost" }, ROOM), false);
  assert.equal(inviteGrantsCohostForRoom({ roomName: "R", role: "cohost" }, ROOM), false);
  assert.equal(inviteGrantsCohostForRoom({ roomId: ROOM, role: "cohost", livekitRoomName: ROOM } as any, ROOM), false);
  assert.equal(inviteGrantsCohostForRoom(undefined, ROOM), false);
});
