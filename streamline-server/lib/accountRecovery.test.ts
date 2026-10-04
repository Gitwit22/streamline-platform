import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import {
  buildRecoveryFailureState,
  buildAdminPasswordResetState,
  buildConsumedPasswordResetState,
  buildForgotPasswordStatus,
  buildRecoveryResetState,
  buildRecoverySetupState,
  buildRecoveryVerifiedState,
  canAdminManagePasswordReset,
  hashEmergencyCode,
  hashSecurityAnswer,
  isEmergencyCodeRecoveryAvailable,
  isAdminPasswordResetActive,
  isApprovedSecurityQuestionId,
  isQuestionRecoveryAvailable,
  needsRecoverySetup,
  normalizeEmergencyCode,
  normalizeRecoveryState,
  normalizeSecurityAnswer,
  validateRecoverySetupInput,
  ADMIN_RESET_MAX_FAILED_ATTEMPTS,
  buildAdminResetFailureState,
  buildPublicPasswordResetState,
  generateAdminResetSecret,
  hashAdminResetSecret,
  normalizeAdminResetSecret,
  reserveRecoveryAttempt,
  stripSensitiveRecoveryFields,
  verifyAdminResetSecret,
  RECOVERY_MAX_FAILED_ATTEMPTS,
} from "./accountRecovery";

const TEST_SECRET = "ABCDE-12345";
const TEST_SECRET_HASH = hashAdminResetSecret(TEST_SECRET);

test("admin password reset becomes active for 24 hours", () => {
  const state = buildAdminPasswordResetState("admin-1", TEST_SECRET_HASH, 1_000);

  assert.equal(state.adminAllowed, true);
  assert.equal(state.requestedBy, "admin-1");
  assert.equal(state.requestedAt, 1_000);
  assert.equal(state.expiresAt, 1_000 + 24 * 60 * 60 * 1000);
  assert.equal(isAdminPasswordResetActive(state, 2_000), true);
});

test("admin password reset expires and can only be used once", () => {
  const enabled = buildAdminPasswordResetState("admin-1", TEST_SECRET_HASH, 10_000);
  const consumed = buildConsumedPasswordResetState(enabled, 12_000);

  assert.equal(isAdminPasswordResetActive(enabled, enabled.expiresAt! + 1), false);
  assert.equal(isAdminPasswordResetActive(consumed, 11_000), false);
  assert.equal(consumed.adminAllowed, false);
  assert.equal(consumed.usedAt, 12_000);
});

test("non-admin-like targets cannot be managed by the same user or for admin accounts", () => {
  assert.equal(canAdminManagePasswordReset("admin-1", "admin-1", { isAdmin: false }), false);
  assert.equal(canAdminManagePasswordReset("admin-1", "user-2", { isAdmin: true }), false);
  assert.equal(
    canAdminManagePasswordReset("admin-1", "user-2", { admin: { isAdmin: true } }),
    false
  );
  assert.equal(canAdminManagePasswordReset("admin-1", "user-2", { isAdmin: false }), true);
});

test("recovery setup only accepts approved question ids and matching emergency code confirmation", () => {
  assert.equal(isApprovedSecurityQuestionId("first_pet"), true);
  assert.equal(isApprovedSecurityQuestionId("bad_question"), false);

  assert.equal(
    validateRecoverySetupInput({
      questionId: "bad_question",
      answer: "hello",
      emergencyCode: "123456",
      confirmEmergencyCode: "123456",
    }),
    "Select a valid security question."
  );

  assert.equal(
    validateRecoverySetupInput({
      questionId: "first_pet",
      answer: "hello",
      emergencyCode: "123 456",
      confirmEmergencyCode: "123456",
    }),
    null
  );

  assert.equal(
    validateRecoverySetupInput({
      questionId: "first_pet",
      answer: "hello",
      emergencyCode: "123456",
    }),
    null
  );

  assert.equal(
    validateRecoverySetupInput({
      questionId: "first_pet",
      answer: "hello",
      emergencyCode: "123456",
      confirmEmergencyCode: "999999",
    }),
    "Emergency recovery code confirmation does not match."
  );
});

test("security answers and emergency codes are normalized before hashing", async () => {
  const answerHash = await hashSecurityAnswer("  My   FIRST  Pet ");
  const codeHash = await hashEmergencyCode(" 12 34 56 ");

  assert.equal(normalizeSecurityAnswer("  My   FIRST  Pet "), "my first pet");
  assert.equal(normalizeEmergencyCode(" 12 34 56 "), "123456");
  assert.equal(await bcrypt.compare("my first pet", answerHash), true);
  assert.equal(await bcrypt.compare("123456", codeHash), true);
});

test("successful recovery setup marks the user configured", () => {
  const state = buildRecoverySetupState(
    {
      questionId: "first_pet",
      answerHash: "answer-hash",
      emergencyCodeHash: "code-hash",
    },
    {},
    50_000
  );

  assert.equal(state.configured, true);
  assert.equal(state.questionId, "first_pet");
  assert.equal(state.answerHash, "answer-hash");
  assert.equal(state.emergencyCodeHash, "code-hash");
  assert.equal(state.createdAt, 50_000);
  assert.equal(state.updatedAt, 50_000);
  assert.equal(needsRecoverySetup({ recovery: state }), false);
});

test("admin password reset clears recovery configuration so setup is forced again", () => {
  const resetState = buildRecoveryResetState(
    {
      configured: true,
      questionId: "first_pet",
      answerHash: "answer-hash",
      emergencyCodeHash: "code-hash",
      createdAt: 1,
      updatedAt: 2,
    },
    77_000
  );

  const normalized = normalizeRecoveryState(resetState);
  assert.equal(normalized.configured, false);
  assert.equal(normalized.questionId, null);
  assert.equal(normalized.answerHash, null);
  assert.equal(normalized.emergencyCodeHash, null);
  assert.equal(normalized.createdAt, 1);
  assert.equal(normalized.updatedAt, 77_000);
  assert.equal(normalized.lastRecoveryMethodUsed, "admin");
  assert.equal(needsRecoverySetup({ recovery: normalized }), true);
});

test("forgot-password status only exposes active admin reset as an available method today", () => {
  const active = buildForgotPasswordStatus({
    recovery: { configured: true },
    passwordReset: buildAdminPasswordResetState("admin-1", TEST_SECRET_HASH, 1_000),
  }, 2_000);
  assert.deepEqual(active.availableMethods, ["admin"]);
  assert.equal(active.recoveryConfigured, true);

  const inactive = buildForgotPasswordStatus({
    recovery: { configured: true },
    passwordReset: buildConsumedPasswordResetState(buildAdminPasswordResetState("admin-1", TEST_SECRET_HASH, 1_000), 2_000),
  }, 3_000);
  assert.deepEqual(inactive.availableMethods, []);
  assert.equal(inactive.recoveryConfigured, true);
});

test("forgot-password status exposes question and code methods for configured recovery", () => {
  const recovery = buildRecoverySetupState(
    {
      questionId: "first_pet",
      answerHash: "answer-hash",
      emergencyCodeHash: "code-hash",
    },
    {},
    10_000
  );

  const status = buildForgotPasswordStatus({ recovery }, 20_000);
  assert.deepEqual(status.availableMethods, ["question", "code"]);
  assert.equal(status.recoveryQuestion?.id, "first_pet");
});

test("recovery methods become unavailable when locked", () => {
  const recovery = buildRecoverySetupState(
    {
      questionId: "first_pet",
      answerHash: "answer-hash",
      emergencyCodeHash: "code-hash",
    },
    {},
    10_000
  );

  const failedQuestion = buildRecoveryFailureState(
    buildRecoveryFailureState(
      buildRecoveryFailureState(
        buildRecoveryFailureState(
          buildRecoveryFailureState(recovery, "question", 20_000),
          "question",
          20_001
        ),
        "question",
        20_002
      ),
      "question",
      20_003
    ),
    "question",
    20_004
  );

  assert.equal(isQuestionRecoveryAvailable(failedQuestion, 20_005), false);
  assert.equal(isEmergencyCodeRecoveryAvailable(failedQuestion, 20_005), true);

  const failedCode = buildRecoveryFailureState(
    buildRecoveryFailureState(
      buildRecoveryFailureState(
        buildRecoveryFailureState(
          buildRecoveryFailureState(recovery, "code", 30_000),
          "code",
          30_001
        ),
        "code",
        30_002
      ),
      "code",
      30_003
    ),
    "code",
    30_004
  );

  assert.equal(isEmergencyCodeRecoveryAvailable(failedCode, 30_005), false);
});

test("successful self-service verification clears failed attempts and records the method used", () => {
  const recovery = buildRecoverySetupState(
    {
      questionId: "first_pet",
      answerHash: "answer-hash",
      emergencyCodeHash: "code-hash",
    },
    {},
    10_000
  );

  const failed = buildRecoveryFailureState(buildRecoveryFailureState(recovery, "code", 20_000), "question", 20_001);
  const verified = buildRecoveryVerifiedState(failed, "code", 25_000);

  assert.equal(verified.failedQuestionAttempts, 0);
  assert.equal(verified.failedCodeAttempts, 0);
  assert.equal(verified.questionLockedUntil, null);
  assert.equal(verified.codeLockedUntil, null);
  assert.equal(verified.lastRecoveryMethodUsed, "code");
  assert.equal(verified.updatedAt, 25_000);
});

test("admin reset secrets are random, well-formed and verify only against their own hash", () => {
  const a = generateAdminResetSecret();
  const b = generateAdminResetSecret();
  assert.match(a, /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  assert.notEqual(a, b);

  const hash = hashAdminResetSecret(a);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, a);
  assert.equal(verifyAdminResetSecret(a, hash), true);
  assert.equal(verifyAdminResetSecret(b, hash), false);
});

test("admin reset secret verification tolerates formatting but rejects bad input", () => {
  assert.equal(normalizeAdminResetSecret(" abcde-12345 "), "ABCDE12345");
  assert.equal(normalizeAdminResetSecret("0O1IL"), "00111");
  assert.equal(verifyAdminResetSecret("abcde 12345", TEST_SECRET_HASH), true);
  assert.equal(verifyAdminResetSecret("ABCDE12345", TEST_SECRET_HASH), true);
  assert.equal(verifyAdminResetSecret("ABCDE-12346", TEST_SECRET_HASH), false);
  assert.equal(verifyAdminResetSecret("", TEST_SECRET_HASH), false);
  assert.equal(verifyAdminResetSecret(undefined, TEST_SECRET_HASH), false);
  assert.equal(verifyAdminResetSecret("ABCDE-1234", TEST_SECRET_HASH), false);
  assert.equal(verifyAdminResetSecret(TEST_SECRET, null), false);
  assert.equal(verifyAdminResetSecret(TEST_SECRET, "not-a-hash"), false);
});

test("admin reset without a stored secret (legacy) is not active", () => {
  const legacy = {
    adminAllowed: true,
    requestedAt: 1_000,
    requestedBy: "admin-1",
    expiresAt: 1_000 + 60_000,
    usedAt: null,
  };
  assert.equal(isAdminPasswordResetActive(legacy, 2_000), false);
  assert.deepEqual(buildForgotPasswordStatus({ passwordReset: legacy }, 2_000).availableMethods, []);
});

test("consuming an admin reset clears the secret hash", () => {
  const consumed = buildConsumedPasswordResetState(buildAdminPasswordResetState("admin-1", TEST_SECRET_HASH, 1_000), 2_000);
  assert.equal(consumed.secretHash, null);
  assert.equal(verifyAdminResetSecret(TEST_SECRET, consumed.secretHash), false);
});

test("too many wrong admin reset secrets void the reset", () => {
  let state: any = buildAdminPasswordResetState("admin-1", TEST_SECRET_HASH, 1_000);
  for (let i = 1; i < ADMIN_RESET_MAX_FAILED_ATTEMPTS; i++) {
    state = buildAdminResetFailureState(state);
    assert.equal(state.failedAttempts, i);
    assert.equal(isAdminPasswordResetActive(state, 2_000), true);
  }
  state = buildAdminResetFailureState(state);
  assert.equal(state.failedAttempts, ADMIN_RESET_MAX_FAILED_ATTEMPTS);
  assert.equal(state.secretHash, null);
  assert.equal(isAdminPasswordResetActive(state, 2_000), false);
});

test("public password reset state never exposes the secret hash", () => {
  const state = buildAdminPasswordResetState("admin-1", TEST_SECRET_HASH, 1_000);
  const pub = buildPublicPasswordResetState(state, 2_000) as any;
  assert.equal("secretHash" in pub, false);
  assert.equal(pub.active, true);

  const stripped = stripSensitiveRecoveryFields({ email: "a@b.c", passwordReset: state }, 2_000) as any;
  assert.equal(JSON.stringify(stripped).includes(TEST_SECRET_HASH), false);
});

test("reserving a recovery attempt counts it before verification and locks at the limit", () => {
  let recovery: any = buildRecoverySetupState(
    { questionId: "first_pet", answerHash: "answer-hash", emergencyCodeHash: "code-hash" },
    {},
    10_000
  );

  for (let i = 1; i <= RECOVERY_MAX_FAILED_ATTEMPTS; i++) {
    const reserved = reserveRecoveryAttempt(recovery, "code", 20_000);
    assert.equal(reserved.ok, true);
    if (!reserved.ok) return;
    assert.equal(reserved.next.failedCodeAttempts, i);
    recovery = reserved.next;
  }

  // The 5th reservation already set the lock, so a 6th concurrent attempt is refused.
  const blocked = reserveRecoveryAttempt(recovery, "code", 20_001);
  assert.deepEqual(blocked, { ok: false, reason: "locked" });

  // The other method is unaffected; a verified success clears everything.
  assert.equal(reserveRecoveryAttempt(recovery, "question", 20_001).ok, true);
  const verified = buildRecoveryVerifiedState(recovery, "code", 20_002);
  assert.equal(reserveRecoveryAttempt(verified, "code", 20_003).ok, true);
});

test("reserving a recovery attempt fails when the method is not configured", () => {
  assert.deepEqual(reserveRecoveryAttempt({}, "question", 1_000), { ok: false, reason: "unavailable" });
});