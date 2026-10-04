import test from "node:test";
import assert from "node:assert/strict";
import { isCollaboratorCleanupRoute, isDisableOnlyUpdate } from "./cleanupPolicy";
import { requiredHlsConfigFeatures } from "../../routes/roomsHlsConfig";

test("collaborator cleanup routes bypass the delegation kill switch", () => {
  assert.equal(isCollaboratorCleanupRoute("GET", "/me"), true);
  assert.equal(isCollaboratorCleanupRoute("POST", "/rel123/decline"), true);
  assert.equal(isCollaboratorCleanupRoute("POST", "/rel123/revoke"), true);
  assert.equal(isCollaboratorCleanupRoute("POST", "/rel123/revoke/"), true);
  // create / use stay gated
  assert.equal(isCollaboratorCleanupRoute("POST", "/invite"), false);
  assert.equal(isCollaboratorCleanupRoute("POST", "/rel123/accept"), false);
  assert.equal(isCollaboratorCleanupRoute("PATCH", "/rel123/permissions"), false);
});

test("disable-only / clear-key updates are cleanup (never gated); anything else is use", () => {
  assert.equal(isDisableOnlyUpdate({ enabled: false }), true);
  assert.equal(isDisableOnlyUpdate({ enabled: false, name: undefined }), true);
  assert.equal(isDisableOnlyUpdate({ streamKeyPlain: "" }), true);
  assert.equal(isDisableOnlyUpdate({ streamKeyEnc: null, enabled: false }), true);
  assert.equal(isDisableOnlyUpdate({ streamKeyPlain: "new-key" }), false);
  assert.equal(isDisableOnlyUpdate({ enabled: true }), false);
  assert.equal(isDisableOnlyUpdate({ enabled: false, name: "x" }), false);
  assert.equal(isDisableOnlyUpdate({}), false);
  assert.equal(isDisableOnlyUpdate(null), false);
});

test("room HLS config: only turning things ON or editing branding needs entitlement", () => {
  const room = { hlsConfig: { enabled: true, title: "Show", theme: "dark" }, monetizationEnabled: true, payPerViewEnabled: true };
  // Turning everything off = cleanup.
  assert.deepEqual(requiredHlsConfigFeatures(room, { enabled: false, monetizationEnabled: false, payPerViewEnabled: false }), []);
  // Re-sending unchanged values is not a change.
  assert.deepEqual(requiredHlsConfigFeatures(room, { enabled: true, title: "Show", theme: "dark", monetizationEnabled: true }), []);
  // Branding edit requires hlsCustomization.
  assert.deepEqual(requiredHlsConfigFeatures(room, { enabled: true, title: "New title" }), ["hlsCustomization"]);
  // Defaults (empty strings) on a fresh room are not branding edits.
  assert.deepEqual(requiredHlsConfigFeatures({}, { enabled: true, title: "", subtitle: "", logoUrl: "", theme: "dark" }), ["hls"]);
  // Enabling monetization / PPV.
  assert.deepEqual(
    requiredHlsConfigFeatures({ hlsConfig: { enabled: true } }, { enabled: true, monetizationEnabled: true, payPerViewEnabled: true }),
    ["monetization", "payPerView"]
  );
});
