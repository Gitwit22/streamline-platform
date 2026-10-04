import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ROOM_ACCESS,
  accessFromCreateBody,
  allowsLinkViewers,
  decideDirectGuestJoin,
  decideTokenAccess,
  derivePolicyFields,
  directJoinAllowed,
  isDiscoverable,
  isInviteSessionId,
  normalizeRoomAccessMode,
  resolveRoomAccessMode,
  type RoomAccessMode,
  type TokenCaller,
} from "./roomAccessPolicy";

const MODES: RoomAccessMode[] = ["invite_only", "link", "public"];

const CALLERS: Record<string, TokenCaller> = {
  owner: { isHostLike: true, isCohost: false, hasInvite: false },
  producer: { isHostLike: true, isCohost: false, hasInvite: false },
  cohost: { isHostLike: false, isCohost: true, hasInvite: false },
  invitedUser: { isHostLike: false, isCohost: false, hasInvite: true },
  invitedGuestSession: { isHostLike: false, isCohost: false, hasInvite: true },
  stagePromoted: { isHostLike: false, isCohost: false, hasInvite: true },
  uninvitedUser: { isHostLike: false, isCohost: false, hasInvite: false },
  directLinkGuest: { isHostLike: false, isCohost: false, hasInvite: false },
  shareLinkHolder: { isHostLike: false, isCohost: false, hasInvite: false },
};

// Expected /token outcome per caller and access mode: max role, or "deny".
const EXPECTED_TOKEN: Record<string, Record<RoomAccessMode, string>> = {
  owner: { invite_only: "host", link: "host", public: "host" },
  producer: { invite_only: "host", link: "host", public: "host" },
  cohost: { invite_only: "cohost", link: "cohost", public: "cohost" },
  invitedUser: { invite_only: "participant", link: "participant", public: "participant" },
  invitedGuestSession: { invite_only: "participant", link: "participant", public: "participant" },
  stagePromoted: { invite_only: "participant", link: "participant", public: "participant" },
  uninvitedUser: { invite_only: "deny", link: "viewer", public: "viewer" },
  directLinkGuest: { invite_only: "deny", link: "viewer", public: "viewer" },
  shareLinkHolder: { invite_only: "deny", link: "viewer", public: "viewer" },
};

test("access mode normalization and default", () => {
  assert.equal(DEFAULT_ROOM_ACCESS, "invite_only");
  assert.equal(normalizeRoomAccessMode("invite_only"), "invite_only");
  assert.equal(normalizeRoomAccessMode("Invite Only"), "invite_only");
  assert.equal(normalizeRoomAccessMode("invite-only"), "invite_only");
  assert.equal(normalizeRoomAccessMode("anyone_with_link"), "link");
  assert.equal(normalizeRoomAccessMode("LINK"), "link");
  assert.equal(normalizeRoomAccessMode("public"), "public");
  assert.equal(normalizeRoomAccessMode("everyone"), null);
  assert.equal(normalizeRoomAccessMode(undefined), null);
});

test("existing rooms without `access` are invite_only (legacy visibility ignored)", () => {
  assert.equal(resolveRoomAccessMode({}), "invite_only");
  assert.equal(resolveRoomAccessMode(null), "invite_only");
  assert.equal(resolveRoomAccessMode({ visibility: "unlisted", requiresAuth: false }), "invite_only");
  assert.equal(resolveRoomAccessMode({ visibility: "public", allowGuests: true }), "invite_only");
  assert.equal(resolveRoomAccessMode({ access: "bogus" }), "invite_only");
  assert.equal(resolveRoomAccessMode({ access: "link" }), "link");
  assert.equal(resolveRoomAccessMode({ access: "public" }), "public");
});

test("create body: access wins, legacy visibility mapped, default invite_only", () => {
  assert.equal(accessFromCreateBody({}), "invite_only");
  assert.equal(accessFromCreateBody(undefined), "invite_only");
  assert.equal(accessFromCreateBody({ access: "link" }), "link");
  assert.equal(accessFromCreateBody({ access: "public", visibility: "private" }), "public");
  assert.equal(accessFromCreateBody({ visibility: "public" }), "public");
  assert.equal(accessFromCreateBody({ visibility: "unlisted" }), "link");
  assert.equal(accessFromCreateBody({ visibility: "private" }), "invite_only");
});

test("legacy fields are derived from access consistently", () => {
  assert.deepEqual(derivePolicyFields("invite_only"), { access: "invite_only", visibility: "private", requiresAuth: true });
  assert.deepEqual(derivePolicyFields("link"), { access: "link", visibility: "unlisted", requiresAuth: false });
  assert.deepEqual(derivePolicyFields("public"), { access: "public", visibility: "public", requiresAuth: false });
  assert.equal(isDiscoverable("public"), true);
  assert.equal(isDiscoverable("link"), false);
  assert.equal(isDiscoverable("invite_only"), false);
  assert.equal(allowsLinkViewers("invite_only"), false);
  assert.equal(allowsLinkViewers("link"), true);
  assert.equal(allowsLinkViewers("public"), true);
});

test("/token: every access mode x caller type", () => {
  for (const [name, caller] of Object.entries(CALLERS)) {
    for (const mode of MODES) {
      const d = decideTokenAccess(mode, caller);
      const expected = EXPECTED_TOKEN[name][mode];
      if (expected === "deny") {
        assert.equal(d.allow, false, `${name} in ${mode} should be refused`);
        assert.equal(d.status, 403);
        assert.equal(d.error, "not_allowed");
      } else {
        assert.equal(d.allow, true, `${name} in ${mode} should be allowed`);
        assert.equal(d.maxRole, expected, `${name} in ${mode}`);
      }
    }
  }
});

test("/join-guest (direct link join): refused in invite_only, viewer in link/public", () => {
  assert.deepEqual(decideDirectGuestJoin("invite_only", {}), { allow: false, status: 403, error: "not_allowed" });
  assert.deepEqual(decideDirectGuestJoin("invite_only", { allowGuests: true }), { allow: false, status: 403, error: "not_allowed" });
  assert.deepEqual(decideDirectGuestJoin("link", {}), { allow: true, role: "viewer" });
  assert.deepEqual(decideDirectGuestJoin("public", { allowGuests: true }), { allow: true, role: "viewer" });
  // Explicit host override still disables anonymous guests.
  assert.deepEqual(decideDirectGuestJoin("link", { allowGuests: false }), { allow: false, status: 403, error: "guests_not_allowed" });
  assert.deepEqual(decideDirectGuestJoin("public", { allowGuests: false }), { allow: false, status: 403, error: "guests_not_allowed" });
});

test("guest sessions from direct link joins / share links are not invite evidence", () => {
  assert.equal(isInviteSessionId("AbCdEf123"), true); // Firestore roomInvites id
  assert.equal(isInviteSessionId("legacy:abc"), true); // invite JWT promoted to a session
  assert.equal(isInviteSessionId("jwt:abc"), true);
  assert.equal(isInviteSessionId("direct:room1:guest_1"), false);
  assert.equal(isInviteSessionId("share:xyz"), false);
  assert.equal(isInviteSessionId(""), false);
});

test("/info guestJoinAllowed: only live link/public rooms that allow guests", () => {
  for (const mode of MODES) {
    for (const live of [true, false]) {
      for (const allowGuests of [undefined, true, false]) {
        const room = allowGuests === undefined ? {} : { allowGuests };
        const expected = live && mode !== "invite_only" && allowGuests !== false;
        assert.equal(directJoinAllowed(mode, room, live), expected, `${mode} live=${live} allowGuests=${allowGuests}`);
      }
    }
  }
});
