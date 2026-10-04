import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  getCodeSalt,
  sealPendingCode,
  openPendingCode,
  isPendingCodeExpired,
} from "./monetizationSecrets";

const saved = {
  NODE_ENV: process.env.NODE_ENV,
  MONETIZATION_CODE_SALT: process.env.MONETIZATION_CODE_SALT,
  STREAM_KEY_SECRET_V1: process.env.STREAM_KEY_SECRET_V1,
};

function restore(key: keyof typeof saved) {
  if (saved[key] === undefined) delete process.env[key];
  else process.env[key] = saved[key];
}

afterEach(() => {
  restore("NODE_ENV");
  restore("MONETIZATION_CODE_SALT");
  restore("STREAM_KEY_SECRET_V1");
});

describe("getCodeSalt", () => {
  it("uses the dev fallback outside production", () => {
    process.env.NODE_ENV = "development";
    delete process.env.MONETIZATION_CODE_SALT;
    assert.equal(getCodeSalt(), "streamline-monetization-salt");
  });

  it("throws in production and staging when unset", () => {
    delete process.env.MONETIZATION_CODE_SALT;
    process.env.NODE_ENV = "production";
    assert.throws(() => getCodeSalt(), /MONETIZATION_CODE_SALT/);
    process.env.NODE_ENV = "staging";
    assert.throws(() => getCodeSalt(), /MONETIZATION_CODE_SALT/);
  });

  it("returns the configured salt in production", () => {
    process.env.NODE_ENV = "production";
    process.env.MONETIZATION_CODE_SALT = "real-salt";
    assert.equal(getCodeSalt(), "real-salt");
  });
});

describe("sealPendingCode / openPendingCode", () => {
  it("encrypts with AES-256-GCM when a key is configured", () => {
    process.env.STREAM_KEY_SECRET_V1 = crypto.randomBytes(32).toString("base64");
    const sealed: any = sealPendingCode("ABCD2345EFGH");
    assert.equal(sealed.alg, "AES-256-GCM");
    assert.equal(JSON.stringify(sealed).includes("ABCD2345EFGH"), false);
    assert.equal(openPendingCode(sealed), "ABCD2345EFGH");
  });

  it("rejects tampered ciphertext", () => {
    process.env.STREAM_KEY_SECRET_V1 = crypto.randomBytes(32).toString("base64");
    const sealed: any = sealPendingCode("ABCD2345EFGH");
    sealed.tag = Buffer.alloc(16).toString("base64");
    assert.equal(openPendingCode(sealed), null);
  });

  it("falls back to plaintext only outside production", () => {
    delete process.env.STREAM_KEY_SECRET_V1;
    process.env.NODE_ENV = "development";
    const sealed = sealPendingCode("DEVCODE23456");
    assert.equal(openPendingCode(sealed), "DEVCODE23456");

    process.env.NODE_ENV = "production";
    assert.throws(() => sealPendingCode("X"), /STREAM_KEY_SECRET_V1/);
    assert.equal(openPendingCode(sealed), null);
  });

  it("returns null for missing payloads", () => {
    assert.equal(openPendingCode(null), null);
    assert.equal(openPendingCode(undefined), null);
  });
});

describe("isPendingCodeExpired", () => {
  it("compares against now", () => {
    assert.equal(isPendingCodeExpired(1000, 999), false);
    assert.equal(isPendingCodeExpired(1000, 1001), true);
  });

  it("treats missing/invalid expiry as expired", () => {
    assert.equal(isPendingCodeExpired(undefined, 0), true);
    assert.equal(isPendingCodeExpired("nope", 0), true);
  });
});
