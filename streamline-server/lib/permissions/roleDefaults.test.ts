import test from "node:test";
import assert from "node:assert/strict";
import {
  ROLE_PRESET_DEFAULTS,
  ROLE_PRESET_DEFAULT_PERMISSIONS,
  ROLE_PRESET_EDITABLE_KEYS,
  cleanRolePresetPatch,
  normalizeRolePreset,
  normalizeRolePresetId,
  presetToRoomPermissions,
} from "./roleDefaults";
import { DEFAULT_ROLE_PROFILES_BY_ID } from "./defaultRoleProfiles";
import { ROLE_PERMISSIONS } from "../rolePermissions";
import { SIMPLE_ROLE_DEFAULTS } from "../../routes/account";
import { presetControlsPatch } from "./rolePresetStore";
import { mergeCohostControlScopes } from "../roomModerationPolicy";
import { roleToParticipantPermission, permissionForRoleWithControls, LIVEKIT_TRACK_SOURCE_ENUM } from "../livekitPermissions";
import { normalizeControlsRole } from "../../routes/roomGuestAccess";

test("product defaults: cohost and participant", () => {
  const c = ROLE_PRESET_DEFAULTS.cohost;
  assert.equal(c.canChangeLayoutScene, true);
  assert.equal(c.canScreenShare, true);
  assert.equal(c.canInviteLinks, true);
  assert.equal(c.canMuteGuests, true);
  assert.equal(c.canRemoveGuests, true);
  assert.equal(c.canStartStopStream, false);
  assert.equal(c.canStartStopRecording, false);
  assert.equal(c.canManageDestinations, false);

  const p = ROLE_PRESET_DEFAULTS.participant;
  assert.equal(p.canPublishAudio, true);
  assert.equal(p.canPublishVideo, true);
  assert.equal(p.canScreenShare, false);
  for (const k of ["canMuteGuests", "canRemoveGuests", "canInviteLinks", "canChangeLayoutScene", "canStartStopStream", "canStartStopRecording", "canManageDestinations"] as const) {
    assert.equal(p[k], false, k);
  }
});

test("single source: Settings defaults, room presets and token permissions agree", () => {
  // Token permissions (ROLE_PERMISSIONS) come from the role defaults.
  assert.deepEqual(ROLE_PERMISSIONS.cohost, ROLE_PRESET_DEFAULT_PERMISSIONS.cohost);
  assert.deepEqual(ROLE_PERMISSIONS.participant, ROLE_PRESET_DEFAULT_PERMISSIONS.participant);
  assert.deepEqual(DEFAULT_ROLE_PROFILES_BY_ID.cohost.permissions, presetToRoomPermissions(ROLE_PRESET_DEFAULTS.cohost));
  assert.deepEqual(DEFAULT_ROLE_PROFILES_BY_ID.participant.permissions, presetToRoomPermissions(ROLE_PRESET_DEFAULTS.participant));
  // Legacy "moderator" profile is the cohost profile.
  assert.deepEqual(DEFAULT_ROLE_PROFILES_BY_ID.moderator.permissions, DEFAULT_ROLE_PROFILES_BY_ID.cohost.permissions);
  // Account (Settings) simple defaults are the same objects' values.
  assert.deepEqual(SIMPLE_ROLE_DEFAULTS.cohost, ROLE_PRESET_DEFAULT_PERMISSIONS.cohost);
  assert.deepEqual(SIMPLE_ROLE_DEFAULTS.participant, ROLE_PRESET_DEFAULT_PERMISSIONS.participant);
  // Cohost default token permissions: layout/screen/invite/mute/remove on.
  const cp = ROLE_PRESET_DEFAULT_PERMISSIONS.cohost;
  assert.equal(cp.canLayout && cp.canScreenShare && cp.canInvite && cp.canMuteGuests && cp.canRemoveGuests && cp.canModerate, true);
  assert.equal(cp.canStream || cp.canRecord || cp.canDestinations || cp.canAnalytics, false);
});

test("legacy moderator is cohost everywhere", () => {
  assert.equal(normalizeRolePresetId("moderator"), "cohost");
  assert.equal(normalizeRolePresetId("Co-Host"), "cohost");
  assert.equal(normalizeRolePresetId("participant"), "participant");
  assert.equal(normalizeRolePresetId("guest"), "participant");
  assert.equal(normalizeRolePresetId("host"), null);
  assert.equal(normalizeControlsRole("moderator"), "cohost");
  assert.equal(normalizeControlsRole("cohost"), "cohost");
  assert.equal(normalizeControlsRole("speaker"), "participant");
  assert.equal(normalizeControlsRole("viewer"), "viewer");
  assert.equal(normalizeControlsRole("host"), "");
});

test("stored presets: editable keys only; participants can never moderate", () => {
  const p = normalizeRolePreset("participant", {
    canScreenShare: true,
    canMuteGuests: true,
    canStartStopRecording: true,
    canPublishAudio: false,
  });
  assert.equal(p.canScreenShare, true);
  assert.equal(p.canMuteGuests, false);
  assert.equal(p.canStartStopRecording, false);
  assert.equal(p.canPublishAudio, true);
  assert.equal(p.role, "participant");

  const c = normalizeRolePreset("cohost", { canStartStopRecording: true, canMuteGuests: false, junk: true });
  assert.equal(c.canStartStopRecording, true);
  assert.equal(c.canMuteGuests, false);
  assert.equal((c as any).junk, undefined);

  assert.deepEqual(cleanRolePresetPatch("participant", { canScreenShare: true, canMuteGuests: true }), { canScreenShare: true });
  assert.deepEqual(cleanRolePresetPatch("cohost", { canManageDestinations: true, canViewAnalytics: true, role: "host" }), {
    canManageDestinations: true,
  });
  // "View Analytics" is not a role toggle any more.
  assert.equal(ROLE_PRESET_EDITABLE_KEYS.cohost.includes("canViewAnalytics" as any), false);
});

test("cohost toggles are real: stream/record/destinations flow into token permissions", () => {
  const preset = normalizeRolePreset("cohost", { canStartStopStream: true, canStartStopRecording: true, canManageDestinations: true });
  const perms = presetToRoomPermissions(preset);
  assert.equal(perms.canStream, true);
  assert.equal(perms.canRecord, true);
  assert.equal(perms.canDestinations, true);
  const noMod = presetToRoomPermissions(normalizeRolePreset("cohost", { canMuteGuests: false, canRemoveGuests: false }));
  assert.equal(noMod.canModerate, false);
});

test("cohost preset application: controls doc carries the owner's preset and a refresh hint", () => {
  const preset = normalizeRolePreset("cohost", { canStartStopRecording: true, canInviteLinks: false });
  const patch = presetControlsPatch(preset, "owner1") as any;
  assert.equal(patch.role, "cohost");
  assert.equal(patch.appliedPresetId, "cohost");
  assert.equal(patch.canStartStopRecording, true);
  assert.equal(patch.canInviteLinks, false);
  assert.equal(typeof patch.tokenRefreshRequestedAt, "number");
  assert.equal(patch.updatedByUid, "owner1");
  // The token path folds the applied controls over the owner's preset.
  const minted = mergeCohostControlScopes(presetToRoomPermissions(ROLE_PRESET_DEFAULTS.cohost), patch);
  assert.equal(minted.canRecord, true);
  assert.equal(minted.canInvite, false);
  assert.equal(minted.canMuteGuests, true);
});

test("participant Share Screen toggle reaches the LiveKit grant", () => {
  const off = roleToParticipantPermission("participant");
  assert.deepEqual(off.canPublishSources, ["microphone", "camera"]);
  const on = roleToParticipantPermission("participant", { screenShare: true });
  assert.ok(on.canPublishSources.includes("screen_share"));
  assert.ok(on.canPublishSources.includes("screen_share_audio"));
  const guestOn = roleToParticipantPermission("guest", { screenShare: true });
  assert.ok(guestOn.canPublishSources.includes("screen_share"));
  // Viewers never get sources.
  assert.deepEqual(roleToParticipantPermission("viewer", { screenShare: true }).canPublishSources, []);

  const enforced = permissionForRoleWithControls("participant", { canScreenShare: true }, true);
  assert.ok(enforced.canPublishSources.includes(LIVEKIT_TRACK_SOURCE_ENUM.screen_share));
  // Room-wide default canScreenShare: true alone does not widen a participant.
  const notScoped = permissionForRoleWithControls("participant", { canScreenShare: true }, false);
  assert.equal(notScoped.canPublishSources.includes(LIVEKIT_TRACK_SOURCE_ENUM.screen_share), false);
  // A restriction still wins over the scope.
  const blocked = permissionForRoleWithControls("participant", { canScreenShare: false }, true);
  assert.equal(blocked.canPublishSources.includes(LIVEKIT_TRACK_SOURCE_ENUM.screen_share), false);
});
