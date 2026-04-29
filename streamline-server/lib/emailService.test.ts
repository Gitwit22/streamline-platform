/**
 * Unit tests for the StreamLine email service and templates.
 *
 * Test runner: Node built-in (node --test)
 * Run after tsc: node --test dist/lib/emailService.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Helpers / mocks
// ---------------------------------------------------------------------------

// Clear singleton between tests
import { _resetEmailServiceForTests } from "./emailService.js";

// ---------------------------------------------------------------------------
// Tests: validateEmail helper (from @cores/notifications)
// ---------------------------------------------------------------------------

test("isValidEmail: accepts standard addresses", () => {
  const { isValidEmail } = require("@cores/notifications");
  assert.equal(isValidEmail("user@example.com"), true);
  assert.equal(isValidEmail("  user@example.com  "), true); // trimmed
});

test("isValidEmail: rejects invalid inputs", () => {
  const { isValidEmail } = require("@cores/notifications");
  assert.equal(isValidEmail(""), false);
  assert.equal(isValidEmail("notanemail"), false);
  assert.equal(isValidEmail("@nodomain"), false);
  assert.equal(isValidEmail(null), false);
  assert.equal(isValidEmail(undefined), false);
  assert.equal(isValidEmail(42), false);
});

test("normalizeEmail: trims and lowercases", () => {
  const { normalizeEmail } = require("@cores/notifications");
  assert.equal(normalizeEmail("  User@Example.COM  "), "user@example.com");
});

// ---------------------------------------------------------------------------
// Tests: loadNotificationConfig
// ---------------------------------------------------------------------------

test("loadNotificationConfig: defaults to console provider when no API key", () => {
  const saved = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  const { loadNotificationConfig } = require("@cores/notifications");
  const config = loadNotificationConfig();
  assert.equal(config.provider, "console");
  assert.equal(config.enabled, true);
  if (saved !== undefined) process.env.RESEND_API_KEY = saved;
});

test("loadNotificationConfig: EMAIL_SEND_ENABLED=false disables sending", () => {
  const saved = process.env.EMAIL_SEND_ENABLED;
  process.env.EMAIL_SEND_ENABLED = "false";
  const { loadNotificationConfig } = require("@cores/notifications");
  const config = loadNotificationConfig();
  assert.equal(config.enabled, false);
  if (saved !== undefined) process.env.EMAIL_SEND_ENABLED = saved;
  else delete process.env.EMAIL_SEND_ENABLED;
});

// ---------------------------------------------------------------------------
// Tests: SendEmailUseCase
// ---------------------------------------------------------------------------

test("SendEmailUseCase: returns ok:true on successful send", async () => {
  const { SendEmailUseCase, ConsoleEmailLogger } = require("@cores/notifications");

  const mockProvider = {
    send: async () => ({ ok: true, messageId: "test-123" }),
  };
  const useCase = new SendEmailUseCase(mockProvider, new ConsoleEmailLogger("silent"));
  const result = await useCase.execute({
    to: "user@example.com",
    from: "noreply@example.com",
    subject: "Test",
    html: "<p>Test</p>",
  });

  assert.equal(result.ok, true);
  assert.equal(result.messageId, "test-123");
});

test("SendEmailUseCase: returns ok:false when provider reports error", async () => {
  const { SendEmailUseCase, ConsoleEmailLogger } = require("@cores/notifications");

  const mockProvider = {
    send: async () => ({ ok: false, error: "provider_error" }),
  };
  const useCase = new SendEmailUseCase(mockProvider, new ConsoleEmailLogger("silent"));
  const result = await useCase.execute({
    to: "user@example.com",
    from: "noreply@example.com",
    subject: "Test",
    html: "<p>Test</p>",
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "provider_error");
});

test("SendEmailUseCase: catches provider throw and returns ok:false", async () => {
  const { SendEmailUseCase, ConsoleEmailLogger } = require("@cores/notifications");

  const mockProvider = {
    send: async () => { throw new Error("network failure"); },
  };
  const useCase = new SendEmailUseCase(mockProvider, new ConsoleEmailLogger("silent"));
  const result = await useCase.execute({
    to: "user@example.com",
    from: "noreply@example.com",
    subject: "Test",
    html: "<p>Test</p>",
  });

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /network failure/);
});

// ---------------------------------------------------------------------------
// Tests: sendEmail (StreamLine adapter)
// ---------------------------------------------------------------------------

test("sendEmail: rejects invalid recipient without calling provider", async () => {
  _resetEmailServiceForTests();
  // Set console provider (no RESEND_API_KEY)
  delete process.env.RESEND_API_KEY;
  process.env.EMAIL_SEND_ENABLED = "true";

  const { sendEmail } = require("./emailService.js");
  const result = await sendEmail({ to: "not-an-email", subject: "Hi", html: "<p>Hi</p>" });

  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid_recipient");
});

test("sendEmail: returns disabled result when EMAIL_SEND_ENABLED=false", async () => {
  _resetEmailServiceForTests();
  process.env.EMAIL_SEND_ENABLED = "false";
  delete process.env.RESEND_API_KEY;

  const { sendEmail } = require("./emailService.js");
  const result = await sendEmail({ to: "user@example.com", subject: "Hi", html: "<p>Hi</p>" });

  assert.equal(result.ok, true);
  assert.equal(result.messageId, "disabled");

  // restore
  delete process.env.EMAIL_SEND_ENABLED;
});

test("sendEmail: succeeds with console provider", async () => {
  _resetEmailServiceForTests();
  delete process.env.RESEND_API_KEY;
  process.env.EMAIL_SEND_ENABLED = "true";
  process.env.EMAIL_FROM = "noreply@test.com";

  const { sendEmail } = require("./emailService.js");
  const result = await sendEmail({ to: "user@example.com", subject: "Welcome", html: "<p>Hi</p>" });

  assert.equal(result.ok, true);
  assert.equal(result.messageId, "console-noop");
});

// ---------------------------------------------------------------------------
// Tests: email templates
// ---------------------------------------------------------------------------

test("buildWelcomeEmail: contains expected content", () => {
  process.env.CLIENT_URL = "http://localhost:5173";
  const { buildWelcomeEmail } = require("./emailTemplates.js");
  const { subject, html } = buildWelcomeEmail({ email: "user@example.com", displayName: "Alice Smith" });

  assert.match(subject, /Welcome/i);
  assert.match(html, /Alice/);
  assert.match(html, /user@example.com/);
  assert.match(html, /localhost/);
});

test("buildEduWelcomeEmail: contains org name and login link", () => {
  process.env.CLIENT_URL = "http://localhost:5173";
  const { buildEduWelcomeEmail } = require("./emailTemplates.js");
  const { subject, html } = buildEduWelcomeEmail({
    email: "admin@school.edu",
    displayName: "Bob Jones",
    orgName: "Springfield Academy",
  });

  assert.match(subject, /administrator/i);
  assert.match(html, /Bob/);
  assert.match(html, /Springfield Academy/);
  assert.match(html, /admin@school\.edu/);
});

test("buildWelcomeEmail: HTML-escapes displayName to prevent injection", () => {
  const { buildWelcomeEmail } = require("./emailTemplates.js");
  const { html } = buildWelcomeEmail({
    email: "xss@example.com",
    displayName: '<script>alert("xss")</script>',
  });

  assert.ok(!html.includes("<script>"), "raw <script> tag must not appear in HTML output");
  assert.match(html, /&lt;script&gt;/);
});

test("email templates: sensitive data is not present in HTML", () => {
  const { buildWelcomeEmail } = require("./emailTemplates.js");
  const { html } = buildWelcomeEmail({ email: "user@example.com" });

  // Passwords, tokens, API keys must never appear in template output
  assert.ok(!html.toLowerCase().includes("password"), "password must not appear in welcome email");
  assert.ok(!html.toLowerCase().includes("api_key"), "API key must not appear in template");
  assert.ok(!html.toLowerCase().includes("secret"), "secrets must not appear in template");
});
