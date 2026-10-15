import test from "node:test";
import assert from "node:assert/strict";
import { checkEnv, publicEnvReport } from "./envCheckPure";

const FULL: Record<string, string> = {
  NODE_ENV: "production",
  FIREBASE_SERVICE_ACCOUNT_BASE64: "x",
  JWT_SECRET: "s",
  CLIENT_URL: "https://app.example.com",
  MAINTENANCE_KEY: "k",
  LIVEKIT_URL: "wss://lk.example.com",
  LIVEKIT_API_KEY: "k",
  LIVEKIT_API_SECRET: "s",
  R2_ACCESS_KEY_ID: "a",
  R2_SECRET_ACCESS_KEY: "b",
  R2_BUCKET: "c",
  R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
  HLS_PUBLIC_BASE_URL: "https://cdn.example.com/hls",
  STREAM_KEY_SECRET_V1: Buffer.alloc(32, 1).toString("base64"),
  MONETIZATION_CODE_SALT: "salt",
  STRIPE_SECRET_KEY: "sk",
  STRIPE_WEBHOOK_SECRET: "whsec",
  STRIPE_PRICE_STARTER: "p1",
  STRIPE_PRICE_BASIC: "p2",
  STRIPE_PRICE_PRO: "p3",
  EGRESS_TEMPLATE_BASE_URL: "https://api.example.com",
  ROOM_ACCESS_TOKEN_SECRET: "r",
  SUPPORT_TICKET_HASH_SALT: "h",
};

test("checkEnv: a complete production config is ok with nothing to report", () => {
  const r = checkEnv(FULL);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missingRequired, []);
  assert.deepEqual(r.missingRecommended, []);
});

test("checkEnv: a missing core variable fails readiness and is named", () => {
  const { R2_BUCKET: _b, ...env } = FULL;
  const r = checkEnv(env);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missingRequired.map((p) => p.variables), [["R2_BUCKET"]]);
});

test("checkEnv: alternatives satisfy a requirement", () => {
  const { FIREBASE_SERVICE_ACCOUNT_BASE64: _f, EGRESS_TEMPLATE_BASE_URL: _e, ...env } = FULL;
  const r = checkEnv({ ...env, GOOGLE_APPLICATION_CREDENTIALS: "/etc/sa.json", RENDER_EXTERNAL_URL: "https://x.onrender.com" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.missingRecommended, []);
});

test("checkEnv: billing gaps are reported but don't fail readiness", () => {
  const { STRIPE_PRICE_PRO: _p, STRIPE_WEBHOOK_SECRET: _w, ...env } = FULL;
  const r = checkEnv(env);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missingRecommended.map((p) => p.variables[0]).sort(), ["STRIPE_PRICE_PRO", "STRIPE_WEBHOOK_SECRET"]);
});

test("checkEnv: invalid values count as problems; whitespace counts as missing", () => {
  const r = checkEnv({ ...FULL, STREAM_KEY_SECRET_V1: "c2hvcnQ=", JWT_SECRET: "   " });
  assert.equal(r.ok, false);
  const byVar = Object.fromEntries(r.missingRequired.map((p) => [p.variables[0], p.problem]));
  assert.equal(byVar.STREAM_KEY_SECRET_V1, "invalid");
  assert.equal(byVar.JWT_SECRET, "missing");
});

test("checkEnv: production-only requirements are skipped in development", () => {
  const { HLS_PUBLIC_BASE_URL: _h, MONETIZATION_CODE_SALT: _m, ...env } = FULL;
  assert.equal(checkEnv({ ...env, NODE_ENV: "development" }).ok, true);
  assert.equal(checkEnv(env).ok, false);
});

test("publicEnvReport never includes variable names or values", () => {
  const { R2_BUCKET: _b, STRIPE_PRICE_PRO: _p, ...env } = FULL;
  const pub = publicEnvReport(checkEnv(env));
  assert.deepEqual(pub, { ok: false, config: { missingRequired: 1, missingRecommended: 1, areas: ["billing", "storage"] } });
  const json = JSON.stringify(pub);
  assert.ok(!json.includes("R2_") && !json.includes("STRIPE") && !json.includes("whsec"));
});
