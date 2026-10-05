import test from "node:test";
import assert from "node:assert/strict";
import {
  accessHasPerm,
  actorMay,
  canAssignRolePreset,
  collaboratorToRoomAccessPermissions,
  isAnonymousIdentity,
  isFullHostActor,
  isProtectedRoomIdentity,
  isStaffActor,
  mergeCohostControlScopes,
  missingPermForControlsPatch,
  screenShareLayoutNeedsFeature,
  moderationActorRole,
} from "./roomModerationPolicy";

test("delegated producers (host token + actingOwnerUid) are limited by their permissions", () => {
  const limitedPerms = collaboratorToRoomAccessPermissions({
    manageParticipants: false,
    controlLayouts: false,
    manageRecording: true,
    manageStreaming: false,
  });
  const producer = { role: "host", actingOwnerUid: "owner1", permissions: limitedPerms };
  const owner = { role: "host", permissions: {} };

  assert.equal(moderationActorRole(producer), "producer");
  assert.equal(moderationActorRole(owner), "host");
  assert.equal(moderationActorRole("moderator"), "cohost");
  assert.equal(isFullHostActor(producer), false);
  assert.equal(isFullHostActor(owner), true);
  assert.equal(isStaffActor(producer), true);

  assert.equal(actorMay(owner, {}, "canModerate"), true);
  assert.equal(actorMay(producer, producer.permissions, "canModerate"), false);
  assert.equal(actorMay(producer, producer.permissions, "canLayout"), false);
  assert.equal(actorMay(producer, producer.permissions, "canRecord"), true);
  assert.equal(actorMay(producer, producer.permissions, "canStream"), false);

  assert.equal(missingPermForControlsPatch(producer, producer.permissions, ["screenShareLayout"]), "canLayout");
  assert.equal(missingPermForControlsPatch(producer, producer.permissions, ["forcedMute"]), "canMuteGuests");
  assert.equal(missingPermForControlsPatch(producer, producer.permissions, ["canMuteGuests"]), "host");

  const fullProducerPerms = collaboratorToRoomAccessPermissions({
    manageParticipants: true,
    controlLayouts: true,
    manageRecording: true,
    manageStreaming: true,
  });
  const fullProducer = { role: "host", actingOwnerUid: "owner1" };
  assert.equal(missingPermForControlsPatch(fullProducer, fullProducerPerms, ["canMuteGuests", "screenShareLayout"]), null);
  assert.equal(canAssignRolePreset(fullProducer, "cohost"), true);
  assert.equal(fullProducerPerms.canDestinations, true);
  assert.equal(fullProducerPerms.canInvite, true);
});

test("anonymous identities can't be cohosts", () => {
  assert.equal(isAnonymousIdentity("invite:abc:123"), true);
  assert.equal(isAnonymousIdentity("guest_1700000000_ab12"), true);
  assert.equal(isAnonymousIdentity("direct:room:guest_1"), true);
  assert.equal(isAnonymousIdentity("producer:uid:owner"), true);
  assert.equal(isAnonymousIdentity("invisible_uid_123"), true);
  assert.equal(isAnonymousIdentity(""), true);
  assert.equal(isAnonymousIdentity("kX9f2LmQ1aZpR7tYvB3cW8nD4eH2"), false);
});

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

test("mergeCohostControlScopes folds preset/host-granted scopes (streaming included; plan limits applied later)", () => {
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
  // Cohost stream/record/destinations toggles are real now: they come from
  // the owner's cohost preset (intersected with the owner's plan by callers).
  assert.equal(merged.canStream, true);
  assert.equal(merged.canRecord, true);
  assert.equal(merged.canDestinations, false);
  assert.equal(
    mergeCohostControlScopes(base, { canManageDestinations: true }).canDestinations,
    true,
  );
  assert.deepEqual(mergeCohostControlScopes(base, null), base);
  assert.deepEqual(mergeCohostControlScopes(base, { role: "cohost" }), base);
});

test("screen-share routing beyond off needs Advanced screen share", () => {
  assert.equal(screenShareLayoutNeedsFeature("off"), false);
  assert.equal(screenShareLayoutNeedsFeature(undefined), false);
  assert.equal(screenShareLayoutNeedsFeature("main"), true);
  assert.equal(screenShareLayoutNeedsFeature("popout"), true);
});
