import test from "node:test";
import assert from "node:assert/strict";
import {
  PASSWORD_RESET_TOKEN_TTL_MS,
  VERIFY_EMAIL_TOKEN_TTL_MS,
  buildAccountEmailLink,
  buildPasswordResetEmail,
  buildVerifyEmailEmail,
  clientBaseUrl,
  evaluateAccountEmailToken,
  generateAccountEmailToken,
  hashAccountEmailToken,
  isEmailVerified,
  isWellFormedAccountEmailToken,
  tokenTtlMs,
} from "./accountEmailPure";
import { accountEmailAvailable } from "./accountEmail";

const NOW = 1_800_000_000_000;
const USER = { email: "Creator@Example.com", authRevokedAtMs: 0 };

function token(over: Record<string, unknown> = {}) {
  return {
    uid: "u1",
    purpose: "password_reset" as const,
    email: "creator@example.com",
    createdAtMs: NOW - 1000,
    expiresAtMs: NOW + PASSWORD_RESET_TOKEN_TTL_MS,
    usedAtMs: null,
    ...over,
  };
}

test("tokens are 256-bit, unique, url-safe, and stored only as a sha256", () => {
  const a = generateAccountEmailToken();
  const b = generateAccountEmailToken();
  assert.notEqual(a, b);
  assert.equal(isWellFormedAccountEmailToken(a), true);
  assert.equal(Buffer.from(a, "base64url").length, 32);
  const h = hashAccountEmailToken(a);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.notEqual(h, a);
  assert.equal(hashAccountEmailToken(` ${a} `), h, "surrounding whitespace from copy/paste is ignored");
});

test("malformed tokens are rejected before any database read", () => {
  for (const bad of [undefined, null, 42, "", "short", "x".repeat(44), "a".repeat(42) + "!", "../../etc"]) {
    assert.equal(isWellFormedAccountEmailToken(bad), false, String(bad));
  }
});

test("TTLs: reset links expire in 1 hour, confirmation links in 3 days", () => {
  assert.equal(tokenTtlMs("password_reset"), 60 * 60_000);
  assert.equal(tokenTtlMs("verify_email"), VERIFY_EMAIL_TOKEN_TTL_MS);
  assert.equal(VERIFY_EMAIL_TOKEN_TTL_MS, 72 * 60 * 60_000);
});

test("valid token for the right purpose, user and address is accepted", () => {
  assert.deepEqual(evaluateAccountEmailToken(token(), "password_reset", USER, NOW), { ok: true });
});

test("a link works once", () => {
  assert.deepEqual(evaluateAccountEmailToken(token({ usedAtMs: NOW - 1 }), "password_reset", USER, NOW), {
    ok: false,
    reason: "used",
  });
});

test("expired links are rejected", () => {
  assert.deepEqual(evaluateAccountEmailToken(token({ expiresAtMs: NOW - 1 }), "password_reset", USER, NOW), {
    ok: false,
    reason: "expired",
  });
});

test("a confirmation link can't be used to reset a password (and vice versa)", () => {
  assert.equal(evaluateAccountEmailToken(token({ purpose: "verify_email" }), "password_reset", USER, NOW).ok, false);
  assert.equal(evaluateAccountEmailToken(token(), "verify_email", USER, NOW).ok, false);
});

test("deleted or missing users, and changed addresses, void the link", () => {
  assert.equal(evaluateAccountEmailToken(token(), "password_reset", null, NOW).ok, false);
  assert.equal(evaluateAccountEmailToken(token(), "password_reset", { ...USER, accountStatus: "deleted" }, NOW).ok, false);
  assert.equal(evaluateAccountEmailToken(token(), "password_reset", { ...USER, deletedAtMs: NOW - 5 }, NOW).ok, false);
  assert.equal(evaluateAccountEmailToken(token(), "password_reset", { ...USER, email: "new@example.com" }, NOW).ok, false);
  assert.equal(evaluateAccountEmailToken(token({ uid: "" }), "password_reset", USER, NOW).ok, false);
});

test("reset links issued before a session revocation (another reset, sign-out-everywhere) stop working", () => {
  const revokedAfter = { ...USER, authRevokedAtMs: NOW - 500 };
  assert.deepEqual(evaluateAccountEmailToken(token(), "password_reset", revokedAfter, NOW), { ok: false, reason: "superseded" });
  const revokedBefore = { ...USER, authRevokedAtMs: NOW - 5000 };
  assert.deepEqual(evaluateAccountEmailToken(token(), "password_reset", revokedBefore, NOW), { ok: true });
  // Revocation doesn't affect email confirmation links.
  const verify = token({ purpose: "verify_email", expiresAtMs: NOW + VERIFY_EMAIL_TOKEN_TTL_MS });
  assert.deepEqual(evaluateAccountEmailToken(verify, "verify_email", revokedAfter, NOW), { ok: true });
});

test("links put the token in the fragment, never the query string", () => {
  const t = generateAccountEmailToken();
  const reset = buildAccountEmailLink("https://app.example.com", "password_reset", t);
  const verify = buildAccountEmailLink("https://app.example.com", "verify_email", t);
  assert.equal(reset, `https://app.example.com/reset-password#token=${t}`);
  assert.equal(verify, `https://app.example.com/verify-email#token=${t}`);
  assert.equal(new URL(reset).search, "");
});

test("client base URL: trailing slashes trimmed, missing or non-http values rejected", () => {
  assert.equal(clientBaseUrl({ CLIENT_URL: "https://app.example.com/" }), "https://app.example.com");
  assert.equal(clientBaseUrl({ CLIENT_URL: "http://localhost:5173" }), "http://localhost:5173");
  assert.equal(clientBaseUrl({}), null);
  assert.equal(clientBaseUrl({ CLIENT_URL: "javascript:alert(1)" }), null);
});

test("account email is only available with Resend fully configured AND a client URL", () => {
  const on = {
    EMAIL_PROVIDER: "resend",
    EMAIL_SEND_ENABLED: "true",
    RESEND_API_KEY: "re_test",
    EMAIL_FROM: "StreamLine <no-reply@example.com>",
    CLIENT_URL: "https://app.example.com",
  };
  assert.equal(accountEmailAvailable(on), true);
  assert.equal(accountEmailAvailable({ ...on, CLIENT_URL: "" }), false);
  assert.equal(accountEmailAvailable({ ...on, EMAIL_SEND_ENABLED: "false" }), false);
  assert.equal(accountEmailAvailable({ ...on, RESEND_API_KEY: "" }), false);
});

test("email content includes the link in text and escaped HTML", () => {
  const link = "https://app.example.com/reset-password#token=abc&x=<y>";
  const reset = buildPasswordResetEmail({ link });
  assert.match(reset.subject, /Reset your StreamLine password/);
  assert.ok(reset.text.includes(link));
  assert.ok(reset.text.includes("60 minutes"));
  assert.ok(reset.html.includes("abc&amp;x=&lt;y&gt;"));
  assert.ok(!reset.html.includes("<y>"));

  const verify = buildVerifyEmailEmail({ link: "https://app.example.com/verify-email#token=abc" });
  assert.match(verify.subject, /Confirm your StreamLine email/);
  assert.ok(verify.text.includes("3 days"));
  assert.ok(verify.html.includes("https://app.example.com/verify-email#token=abc"));
});

test("only an explicit true counts as verified (legacy docs have no field)", () => {
  assert.equal(isEmailVerified({ emailVerified: true }), true);
  assert.equal(isEmailVerified({ emailVerified: "true" }), false);
  assert.equal(isEmailVerified({}), false);
  assert.equal(isEmailVerified(null), false);
});
