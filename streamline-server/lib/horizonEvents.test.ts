import test from "node:test";
import assert from "node:assert/strict";
import { isHorizonEnabled } from "./horizonEvents";

// We can only unit-test the pure config-checking function without mocking fetch.
// The HMAC signing is fully covered by hmac.test.ts.

test("isHorizonEnabled returns false when env vars are unset", () => {
  const saved = { ...process.env };
  delete process.env.HORIZON_WEBHOOK_URL;
  delete process.env.HORIZON_WEBHOOK_SECRET;
  try {
    assert.equal(isHorizonEnabled(), false);
  } finally {
    Object.assign(process.env, saved);
  }
});

test("isHorizonEnabled returns false when only URL is set", () => {
  const saved = { ...process.env };
  process.env.HORIZON_WEBHOOK_URL = "https://example.com/hook";
  delete process.env.HORIZON_WEBHOOK_SECRET;
  try {
    assert.equal(isHorizonEnabled(), false);
  } finally {
    Object.assign(process.env, saved);
  }
});

test("isHorizonEnabled returns false when only secret is set", () => {
  const saved = { ...process.env };
  delete process.env.HORIZON_WEBHOOK_URL;
  process.env.HORIZON_WEBHOOK_SECRET = "secret123";
  try {
    assert.equal(isHorizonEnabled(), false);
  } finally {
    Object.assign(process.env, saved);
  }
});

test("isHorizonEnabled returns true when both URL and secret are set", () => {
  const saved = { ...process.env };
  process.env.HORIZON_WEBHOOK_URL = "https://example.com/hook";
  process.env.HORIZON_WEBHOOK_SECRET = "secret123";
  try {
    assert.equal(isHorizonEnabled(), true);
  } finally {
    Object.assign(process.env, saved);
  }
});
