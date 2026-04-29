import test from "node:test";
import assert from "node:assert/strict";
import { applyPresenceModeToGrant, roleToParticipantPermission } from "./livekitPermissions";

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
