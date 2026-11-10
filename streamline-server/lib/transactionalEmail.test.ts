import test from "node:test";
import assert from "node:assert/strict";
import { emailConfig, maskEmail, sendTransactionalEmail } from "./transactionalEmail";
import { buildAccessCodeEmail, escapeHtml, isValidEmail, nextAttemptDelayMs } from "./ppvCodeEmailPure";

const ON = {
  EMAIL_PROVIDER: "resend",
  EMAIL_SEND_ENABLED: "true",
  RESEND_API_KEY: "re_test",
  EMAIL_FROM_NAME: "StreamLine",
  EMAIL_FROM_ADDRESS: "no-reply@example.com",
};
const MSG = { to: "buyer@example.com", subject: "Your ticket", html: "<p>CODE123</p>", text: "CODE123", idempotencyKey: "purchase_p1", tag: "t" };

test("email config: only sends when provider, flag, key and sender are all set", () => {
  assert.equal(emailConfig(ON).enabled, true);
  assert.equal(emailConfig(ON).from, "StreamLine <no-reply@example.com>");
  assert.equal(emailConfig({ ...ON, EMAIL_SEND_ENABLED: "false" }).enabled, false);
  assert.equal(emailConfig({ ...ON, EMAIL_PROVIDER: "stub" }).enabled, false);
  assert.equal(emailConfig({ ...ON, RESEND_API_KEY: "" }).enabled, false);
  assert.equal(emailConfig({ ...ON, EMAIL_FROM_ADDRESS: "" }).enabled, false);
  assert.equal(emailConfig({ ...ON, EMAIL_FROM: "X <x@y.z>" }).from, "X <x@y.z>");
});

test("disabled email is retryable and never calls the provider", async () => {
  let called = false;
  const r = await sendTransactionalEmail(MSG, { env: {}, fetchImpl: async () => ((called = true), { ok: true, status: 200, json: async () => ({}) }) });
  assert.deepEqual(r, { ok: false, retryable: true, error: "email_disabled" });
  assert.equal(called, false);
});

test("sends to Resend with the idempotency key; never logs bodies", async () => {
  let seen: any = null;
  const logs: string[] = [];
  const orig = { log: console.log, warn: console.warn };
  console.log = (...a: any[]) => logs.push(JSON.stringify(a));
  console.warn = (...a: any[]) => logs.push(JSON.stringify(a));
  try {
    const r = await sendTransactionalEmail(MSG, {
      env: ON,
      fetchImpl: async (url, init) => {
        seen = { url, init };
        return { ok: true, status: 200, json: async () => ({ id: "em_1" }) };
      },
    });
    assert.deepEqual(r, { ok: true, id: "em_1" });
  } finally {
    console.log = orig.log;
    console.warn = orig.warn;
  }
  assert.equal(seen.url, "https://api.resend.com/emails");
  assert.equal(seen.init.headers["Idempotency-Key"], "purchase_p1");
  assert.equal(JSON.parse(seen.init.body).to[0], "buyer@example.com");
  const all = logs.join("\n");
  assert.ok(!all.includes("CODE123"), "code must not be logged");
  assert.ok(!all.includes("buyer@example.com"), "recipient is masked");
});

test("provider errors: 4xx permanent, 429/5xx/network retryable", async () => {
  const quiet = console.warn;
  console.warn = () => {};
  try {
    const at = (status: number) =>
      sendTransactionalEmail(MSG, { env: ON, fetchImpl: async () => ({ ok: false, status, json: async () => ({ name: "x" }) }) });
    assert.equal(((await at(422)) as any).retryable, false);
    assert.equal(((await at(403)) as any).retryable, false);
    assert.equal(((await at(429)) as any).retryable, true);
    assert.equal(((await at(503)) as any).retryable, true);
    const net = await sendTransactionalEmail(MSG, { env: ON, fetchImpl: async () => { throw new Error("boom"); } });
    assert.deepEqual(net, { ok: false, retryable: true, error: "network_error" });
  } finally {
    console.warn = quiet;
  }
});

test("access-code email: escaped, contains the code, recovery wording", () => {
  const m = buildAccessCodeEmail({ eventName: "<script>x</script>", code: "ABCD2345EFGH", watchUrl: "https://app/ppv/e1", kind: "purchase" });
  assert.ok(!m.html.includes("<script>"));
  assert.ok(m.html.includes("&lt;script&gt;"));
  assert.ok(m.html.includes("ABCD2345EFGH") && m.text.includes("ABCD2345EFGH"));
  assert.ok(m.text.includes("https://app/ppv/e1"));
  const r = buildAccessCodeEmail({ eventName: "Show", code: "X", watchUrl: null, kind: "recovery" });
  assert.match(r.text, /no longer works/);
  assert.equal(escapeHtml(`"'&`), "&quot;&#39;&amp;");
});

test("helpers", () => {
  assert.equal(maskEmail("alice@example.com"), "a***@example.com");
  assert.equal(isValidEmail("a@b.co"), true);
  assert.equal(isValidEmail("nope"), false);
  assert.equal(nextAttemptDelayMs(1), 60_000);
  assert.equal(nextAttemptDelayMs(99), 60 * 60_000);
});
