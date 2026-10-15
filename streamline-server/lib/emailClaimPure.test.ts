import test from "node:test";
import assert from "node:assert/strict";
import { emailClaimBlocks, emailClaimId } from "./emailClaimPure";

test("emailClaimId is stable across case/whitespace and doesn't contain the email", () => {
  assert.equal(emailClaimId(" A@B.com "), emailClaimId("a@b.com"));
  assert.notEqual(emailClaimId("a@b.com"), emailClaimId("c@b.com"));
  assert.ok(!emailClaimId("a@b.com").includes("@"));
});

test("emailClaimBlocks: live account blocks; missing or deleted account releases", () => {
  assert.equal(emailClaimBlocks({ uid: "u1" }, { accountStatus: "active" }), true);
  assert.equal(emailClaimBlocks({ uid: "u1" }, {}), true);
  assert.equal(emailClaimBlocks({ uid: "u1" }, { accountStatus: "deleted" }), false);
  assert.equal(emailClaimBlocks({ uid: "u1" }, null), false);
  assert.equal(emailClaimBlocks(null, { accountStatus: "active" }), false);
});
