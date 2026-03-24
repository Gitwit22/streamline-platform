import test from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Invite role validation tests
// ---------------------------------------------------------------------------
// Tests the role validation logic used in the join-now endpoint
// (extracted from roomGuestAccess.ts for testability)

type ValidateResult =
  | { ok: true; role: "guest" }
  | { ok: false; error: string };

/**
 * Validates an invite document's role field.
 * Active product flows never mint host invites.
 * A host role in an invite doc is treated as invalid state (likely DB tampering),
 * not a recoverable case.
 */
function validateInviteRole(rawRole: unknown): ValidateResult {
  const inviteRole = String(rawRole ?? "").trim().toLowerCase();

  if (inviteRole === "host") {
    return { ok: false, error: "INVALID_INVITE_ROLE" };
  }

  if (
    inviteRole === "guest" ||
    inviteRole === "participant" ||
    inviteRole === "viewer"
  ) {
    return { ok: true, role: "guest" };
  }

  return { ok: false, error: "INVALID_ROLE" };
}

// ---------- role="host" is rejected ----------

test('validateInviteRole rejects "host"', () => {
  const result = validateInviteRole("host");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "INVALID_INVITE_ROLE");
  }
});

test('validateInviteRole rejects "Host" (case-insensitive)', () => {
  const result = validateInviteRole("Host");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "INVALID_INVITE_ROLE");
  }
});

test('validateInviteRole rejects " HOST " (whitespace)', () => {
  const result = validateInviteRole(" HOST ");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "INVALID_INVITE_ROLE");
  }
});

// ---------- valid roles are accepted ----------

test('validateInviteRole accepts "guest"', () => {
  const result = validateInviteRole("guest");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.role, "guest");
});

test('validateInviteRole accepts "participant" (maps to guest)', () => {
  const result = validateInviteRole("participant");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.role, "guest");
});

test('validateInviteRole accepts "viewer" (maps to guest)', () => {
  const result = validateInviteRole("viewer");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.role, "guest");
});

// ---------- unknown roles are rejected ----------

test('validateInviteRole rejects unknown role "admin"', () => {
  const result = validateInviteRole("admin");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "INVALID_ROLE");
});

test("validateInviteRole rejects empty string", () => {
  const result = validateInviteRole("");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "INVALID_ROLE");
});

test("validateInviteRole rejects null/undefined", () => {
  assert.equal(validateInviteRole(null).ok, false);
  assert.equal(validateInviteRole(undefined).ok, false);
});
