import test from "node:test";
import assert from "node:assert/strict";
import { isDeletedAccountDoc } from "./accountStatusPure";

test("isDeletedAccountDoc", () => {
  assert.equal(isDeletedAccountDoc({ accountStatus: "deleted" }), true);
  assert.equal(isDeletedAccountDoc({ accountStatus: "DELETED" }), true);
  assert.equal(isDeletedAccountDoc({ deletedAtMs: 5 }), true);
  assert.equal(isDeletedAccountDoc({ accountStatus: "active", deletedAtMs: null }), false);
  assert.equal(isDeletedAccountDoc({ deletedAtMs: 0 }), false);
  assert.equal(isDeletedAccountDoc(null), false);
});
