import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidPresenceMode,
  normalizePresenceMode,
  getPresencePolicy,
  getPresenceModeDefaults,
  buildPresenceMetadata,
} from "./presenceMode";

// ---------- isValidPresenceMode ----------

test("isValidPresenceMode accepts valid modes", () => {
  assert.ok(isValidPresenceMode("normal"));
  assert.ok(isValidPresenceMode("invisible"));
});

test("isValidPresenceMode accepts legacy 'silent' for backwards compat", () => {
  assert.ok(isValidPresenceMode("silent"));
});

test("isValidPresenceMode rejects invalid values", () => {
  assert.equal(isValidPresenceMode(""), false);
  assert.equal(isValidPresenceMode("hidden"), false);
  assert.equal(isValidPresenceMode(null), false);
  assert.equal(isValidPresenceMode(undefined), false);
  assert.equal(isValidPresenceMode(42), false);
});

// ---------- normalizePresenceMode ----------

test("normalizePresenceMode maps 'silent' to 'invisible'", () => {
  assert.equal(normalizePresenceMode("silent"), "invisible");
});

test("normalizePresenceMode passes through valid modes", () => {
  assert.equal(normalizePresenceMode("normal"), "normal");
  assert.equal(normalizePresenceMode("invisible"), "invisible");
});

test("normalizePresenceMode defaults unknown values to 'normal'", () => {
  assert.equal(normalizePresenceMode(""), "normal");
  assert.equal(normalizePresenceMode(null), "normal");
  assert.equal(normalizePresenceMode(undefined), "normal");
  assert.equal(normalizePresenceMode(42), "normal");
});

// ---------- getPresencePolicy ----------

test("normal policy allows publish, chat, screen-share, and is visible", () => {
  const p = getPresencePolicy("normal");
  assert.equal(p.canPublishAudio, true);
  assert.equal(p.canPublishVideo, true);
  assert.equal(p.canScreenShare, true);
  assert.equal(p.canSendChat, true);
  assert.equal(p.canReadChat, true);
  assert.equal(p.canRequestStage, true);
  assert.equal(p.isVisibleInRoster, true);
  assert.equal(p.canModerate, false);
});

test("invisible policy disables publish, chat, screen-share, stage and hides from roster", () => {
  const p = getPresencePolicy("invisible");
  assert.equal(p.canPublishAudio, false);
  assert.equal(p.canPublishVideo, false);
  assert.equal(p.canScreenShare, false);
  assert.equal(p.canSendChat, false);
  assert.equal(p.canReadChat, true);
  assert.equal(p.canRequestStage, false);
  assert.equal(p.isVisibleInRoster, false);
  assert.equal(p.canModerate, true);
});

test("getPresenceModeDefaults is a backwards-compat alias for getPresencePolicy", () => {
  assert.deepStrictEqual(getPresenceModeDefaults("normal"), getPresencePolicy("normal"));
  assert.deepStrictEqual(getPresenceModeDefaults("invisible"), getPresencePolicy("invisible"));
});

// ---------- buildPresenceMetadata ----------

test("buildPresenceMetadata produces correct metadata for invisible mod", () => {
  const meta = buildPresenceMetadata({
    role: "mod",
    presenceMode: "invisible",
    rolePresetId: "cohost",
  });
  assert.equal(meta.role, "mod");
  assert.equal(meta.presenceMode, "invisible");
  assert.equal(meta.isVisibleInRoster, false);
  assert.equal(meta.canSendChat, false);
  assert.equal(meta.canReadChat, true);
  assert.equal(meta.canScreenShare, false);
  assert.equal(meta.canRequestStage, false);
  assert.equal(meta.rolePresetId, "cohost");
});

test("buildPresenceMetadata for normal mode", () => {
  const meta = buildPresenceMetadata({
    role: "host",
    presenceMode: "normal",
  });
  assert.equal(meta.role, "host");
  assert.equal(meta.presenceMode, "normal");
  assert.equal(meta.isVisibleInRoster, true);
  assert.equal(meta.canSendChat, true);
  assert.equal(meta.canScreenShare, true);
  assert.equal(meta.canRequestStage, true);
  assert.equal(meta.rolePresetId, undefined);
});
