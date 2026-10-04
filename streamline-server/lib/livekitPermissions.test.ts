import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPresenceModeToGrant,
  roleToParticipantPermission,
  toLiveKitParticipantPermission,
  toLiveKitTrackSourceNumber,
  toLiveKitTrackSourceString,
  restrictPermissionByControls,
  LIVEKIT_TRACK_SOURCE_ENUM,
} from "./livekitPermissions";

test("applyPresenceModeToGrant: normal mode passes through unchanged", () => {
  const base = roleToParticipantPermission("host");
  const result = applyPresenceModeToGrant(base, "normal");
  assert.deepStrictEqual(result, base);
});

test("applyPresenceModeToGrant: invisible mode disables publish for host", () => {
  const base = roleToParticipantPermission("host");
  const result = applyPresenceModeToGrant(base, "invisible");
  assert.equal(result.canSubscribe, true, "should still subscribe");
  assert.equal(result.canPublish, false, "should not publish");
  assert.equal(result.canPublishData, false, "should not publish data (chat)");
  assert.deepStrictEqual(result.canPublishSources, []);
});

test("applyPresenceModeToGrant: invisible mode disables publish for participant", () => {
  const base = roleToParticipantPermission("participant");
  const result = applyPresenceModeToGrant(base, "invisible");
  assert.equal(result.canSubscribe, true, "should still subscribe");
  assert.equal(result.canPublish, false, "should not publish");
  assert.equal(result.canPublishData, false, "should not publish data (chat)");
  assert.deepStrictEqual(result.canPublishSources, []);
});

test("applyPresenceModeToGrant: viewer base with invisible stays restricted", () => {
  const base = roleToParticipantPermission("viewer");
  const result = applyPresenceModeToGrant(base, "invisible");
  assert.equal(result.canSubscribe, true);
  assert.equal(result.canPublish, false);
  assert.equal(result.canPublishData, false);
});

test("toLiveKitTrackSourceNumber: maps strings and passes numbers through", () => {
  assert.equal(toLiveKitTrackSourceNumber("camera"), 1);
  assert.equal(toLiveKitTrackSourceNumber("microphone"), 2);
  assert.equal(toLiveKitTrackSourceNumber("screen_share"), 3);
  assert.equal(toLiveKitTrackSourceNumber("screen_share_audio"), 4);
  assert.equal(toLiveKitTrackSourceNumber("SCREEN_SHARE"), 3);
  assert.equal(toLiveKitTrackSourceNumber("screenShareAudio"), 4);
  assert.equal(toLiveKitTrackSourceNumber(2), 2);
  assert.equal(toLiveKitTrackSourceNumber(0), null);
  assert.equal(toLiveKitTrackSourceNumber(99), null);
  assert.equal(toLiveKitTrackSourceNumber("bogus"), null);
  assert.equal(toLiveKitTrackSourceNumber(null), null);
  assert.equal(LIVEKIT_TRACK_SOURCE_ENUM.microphone, 2);
});

test("toLiveKitTrackSourceString: reverse mapping", () => {
  assert.equal(toLiveKitTrackSourceString(1), "camera");
  assert.equal(toLiveKitTrackSourceString("MICROPHONE"), "microphone");
  assert.equal(toLiveKitTrackSourceString(7), null);
});

test("toLiveKitParticipantPermission: converts role grants to enum sources", () => {
  const host = toLiveKitParticipantPermission(roleToParticipantPermission("host"));
  assert.deepStrictEqual(host, {
    canSubscribe: true,
    canPublish: true,
    canPublishData: true,
    canPublishSources: [2, 1, 3, 4],
  });

  const participant = toLiveKitParticipantPermission(roleToParticipantPermission("participant"));
  assert.deepStrictEqual(participant.canPublishSources, [2, 1]);

  const viewer = toLiveKitParticipantPermission(roleToParticipantPermission("viewer"));
  assert.equal(viewer.canPublish, false);
  assert.deepStrictEqual(viewer.canPublishSources, []);
});

test("toLiveKitParticipantPermission: keeps numeric sources, dedupes, drops unknown keys", () => {
  const out = toLiveKitParticipantPermission({
    canPublish: true,
    canPublishSources: [1, "camera", 2, "nope", 0],
    hidden: false,
    somethingElse: "x",
  });
  assert.deepStrictEqual(out, { canPublish: true, hidden: false, canPublishSources: [1, 2] });
  assert.deepStrictEqual(toLiveKitParticipantPermission(undefined), { canPublishSources: [] });
});

test("restrictPermissionByControls: removes mic/camera per controls", () => {
  const base = roleToParticipantPermission("participant");
  assert.deepStrictEqual(restrictPermissionByControls(base, {}).canPublishSources, [2, 1]);
  assert.deepStrictEqual(restrictPermissionByControls(base, { forcedMute: true }).canPublishSources, [1]);
  assert.deepStrictEqual(restrictPermissionByControls(base, { canPublishAudio: false }).canPublishSources, [1]);
  assert.deepStrictEqual(restrictPermissionByControls(base, { forcedVideoOff: true }).canPublishSources, [2]);

  const none = restrictPermissionByControls(base, { forcedMute: true, forcedVideoOff: true });
  assert.equal(none.canPublish, false);
  assert.deepStrictEqual(none.canPublishSources, []);
  assert.equal(none.canPublishData, true, "chat stays enabled");

  // Empty source list means "all" in LiveKit; restricting expands first.
  const unrestricted = restrictPermissionByControls({ canPublish: true, canPublishSources: [] }, { muteLocked: true });
  assert.deepStrictEqual(unrestricted.canPublishSources, [1, 3, 4]);

  // Viewers stay viewers.
  const viewer = restrictPermissionByControls(roleToParticipantPermission("viewer"), { forcedMute: true });
  assert.equal(viewer.canPublish, false);
});
