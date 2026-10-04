import test from "node:test";
import assert from "node:assert/strict";
import {
  accessHasPerm,
  actorMay,
  canAssignRolePreset,
  isProtectedRoomIdentity,
  mergeCohostControlScopes,
  missingPermForControlsPatch,
  moderationActorRole,
} from "./roomModerationPolicy";

test("moderationActorRole maps roles", () => {
  assert.equal(moderationActorRole("host"), "host");
  assert.equal(moderationActorRole("COHOST"), "cohost");
  assert.equal(moderationActorRole("participant"), "other");
  assert.equal(moderationActorRole(undefined), "other");
});

test("accessHasPerm falls back to canModerate for mute/remove on legacy tokens", () => {
  assert.equal(accessHasPerm({ canModerate: true }, "canMuteGuests"), true);
  assert.equal(accessHasPerm({ canModerate: true, canMuteGuests: false }, "canMuteGuests"), false);
  assert.equal(accessHasPerm({ canModerate: true }, "canLayout"), false);
  assert.equal(accessHasPerm(undefined, "canLayout"), false);
});

test("actorMay: host always, cohost by permission, others never", () => {
  assert.equal(actorMay("host", {}, "canModerate"), true);
  assert.equal(actorMay("cohost", { canLayout: true }, "canLayout"), true);
  assert.equal(actorMay("cohost", { canLayout: false }, "canLayout"), false);
  assert.equal(actorMay("participant", { canLayout: true }, "canLayout"), false);
});

test("isProtectedRoomIdentity covers owner, producers and extras", () => {
  assert.equal(isProtectedRoomIdentity("owner1", "owner1"), true);
  assert.equal(isProtectedRoomIdentity("producer:u:owner1", "owner1"), true);
  assert.equal(isProtectedRoomIdentity("me", "owner1", ["me"]), true);
  assert.equal(isProtectedRoomIdentity("guest", "owner1", [null, undefined]), false);
  assert.equal(isProtectedRoomIdentity("", "owner1"), true);
});

test("missingPermForControlsPatch gates cohost keys", () => {
  assert.equal(missingPermForControlsPatch("host", {}, ["canMuteGuests", "screenShareLayout"]), null);
  assert.equal(missingPermForControlsPatch("cohost", { canLayout: true }, ["screenShareLayout", "outputFormat"]), null);
  assert.equal(missingPermForControlsPatch("cohost", { canLayout: false }, ["screenShareLayout"]), "canLayout");
  assert.equal(missingPermForControlsPatch("cohost", { canMuteGuests: true }, ["forcedMute"]), null);
  assert.equal(missingPermForControlsPatch("cohost", { canModerate: true }, ["canPublishVideo"]), null);
  // Capability scopes and unknown keys are host-only.
  assert.equal(missingPermForControlsPatch("cohost", { canModerate: true }, ["canRemoveGuests"]), "host");
  assert.equal(missingPermForControlsPatch("cohost", { canModerate: true }, ["somethingNew"]), "host");
  assert.equal(missingPermForControlsPatch("participant", { canLayout: true }, ["screenShareLayout"]), "canLayout");
});

test("canAssignRolePreset: cohosts cannot hand out cohost", () => {
  assert.equal(canAssignRolePreset("host", "cohost"), true);
  assert.equal(canAssignRolePreset("cohost", "participant"), true);
  assert.equal(canAssignRolePreset("cohost", "cohost"), false);
  assert.equal(canAssignRolePreset("participant", "participant"), false);
});

test("mergeCohostControlScopes folds host-granted scopes without widening streaming", () => {
  const base = {
    canStream: false,
    canRecord: false,
    canDestinations: false,
    canModerate: false,
    canLayout: true,
    canScreenShare: true,
    canInvite: true,
    canAnalytics: false,
    canMuteGuests: false,
    canRemoveGuests: false,
  };
  const merged = mergeCohostControlScopes(base, {
    role: "cohost",
    canMuteGuests: true,
    canRemoveGuests: true,
    canInviteLinks: false,
    canChangeLayoutScene: true,
    canStartStopStream: true,
    canStartStopRecording: true,
  });
  assert.equal(merged.canMuteGuests, true);
  assert.equal(merged.canRemoveGuests, true);
  assert.equal(merged.canModerate, true);
  assert.equal(merged.canInvite, false);
  assert.equal(merged.canStream, false);
  assert.equal(merged.canRecord, false);
  assert.deepEqual(mergeCohostControlScopes(base, null), base);
  assert.deepEqual(mergeCohostControlScopes(base, { role: "cohost" }), base);
});
