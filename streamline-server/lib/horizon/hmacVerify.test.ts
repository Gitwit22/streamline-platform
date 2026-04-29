import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signPayload, verifySignature } from "./hmacVerify";

describe("hmacVerify", () => {
  const secret = "test-webhook-secret-abc123";
  const payload = '{"type":"chat.message","data":{}}';

  describe("signPayload", () => {
    it("returns a sha256= prefixed hex string", () => {
      const sig = signPayload(secret, payload);
      assert.ok(sig.startsWith("sha256="), "should start with sha256=");
      // sha256 hex digest is 64 chars + 7 prefix chars = 71
      assert.equal(sig.length, 71);
    });

    it("produces deterministic output", () => {
      const a = signPayload(secret, payload);
      const b = signPayload(secret, payload);
      assert.equal(a, b);
    });

    it("differs for different secrets", () => {
      const a = signPayload("secret-a", payload);
      const b = signPayload("secret-b", payload);
      assert.notEqual(a, b);
    });

    it("differs for different payloads", () => {
      const a = signPayload(secret, "payload-a");
      const b = signPayload(secret, "payload-b");
      assert.notEqual(a, b);
    });

    it("handles Buffer payloads", () => {
      const strSig = signPayload(secret, payload);
      const bufSig = signPayload(secret, Buffer.from(payload));
      assert.equal(strSig, bufSig);
    });
  });

  describe("verifySignature", () => {
    it("returns true for a valid signature", () => {
      const sig = signPayload(secret, payload);
      assert.equal(verifySignature(secret, payload, sig), true);
    });

    it("returns false for a tampered payload", () => {
      const sig = signPayload(secret, payload);
      assert.equal(verifySignature(secret, payload + "x", sig), false);
    });

    it("returns false for a wrong secret", () => {
      const sig = signPayload(secret, payload);
      assert.equal(verifySignature("wrong-secret", payload, sig), false);
    });

    it("returns false for a truncated signature", () => {
      const sig = signPayload(secret, payload);
      assert.equal(verifySignature(secret, payload, sig.slice(0, 20)), false);
    });

    it("returns false when signature header is undefined", () => {
      assert.equal(verifySignature(secret, payload, undefined), false);
    });

    it("returns false when signature header is empty string", () => {
      assert.equal(verifySignature(secret, payload, ""), false);
    });

    it("returns false when secret is empty", () => {
      const sig = signPayload(secret, payload);
      assert.equal(verifySignature("", payload, sig), false);
    });

    it("returns false for completely wrong format", () => {
      assert.equal(verifySignature(secret, payload, "not-a-valid-signature"), false);
    });
  });
});
