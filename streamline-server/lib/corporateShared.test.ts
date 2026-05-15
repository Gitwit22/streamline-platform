import test from "node:test";
import assert from "node:assert/strict";
import {
  coerceCorporateRole,
  hashInviteToken,
  normalizeEmail,
  validatePassword,
} from "./corporateShared";

test("normalizeEmail lowercases and trims", () => {
  assert.equal(normalizeEmail("  USER@Example.COM  "), "user@example.com");
});

test("coerceCorporateRole accepts only allowed roles", () => {
  assert.equal(coerceCorporateRole("admin"), "admin");
  assert.equal(coerceCorporateRole("manager"), "manager");
  assert.equal(coerceCorporateRole("member"), "member");
  assert.equal(coerceCorporateRole("viewer"), "viewer");
  assert.equal(coerceCorporateRole("owner"), null);
});

test("validatePassword enforces baseline complexity", () => {
  assert.equal(validatePassword("Short1"), "Password must be at least 8 characters.");
  assert.equal(validatePassword("alllowercase1"), "Password must include at least one uppercase letter.");
  assert.equal(validatePassword("ALLUPPERCASE1"), "Password must include at least one lowercase letter.");
  assert.equal(validatePassword("NoNumberPassword"), "Password must include at least one number.");
  assert.equal(validatePassword("ValidPass1"), null);
});

test("hashInviteToken is deterministic and non-empty", () => {
  const first = hashInviteToken("abc123");
  const second = hashInviteToken("abc123");
  assert.equal(first, second);
  assert.ok(first.length > 20);
});
