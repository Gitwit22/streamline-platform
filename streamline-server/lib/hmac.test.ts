import test from "node:test";
import assert from "node:assert/strict";
import { signPayload, verifySignature } from "./hmac";

test("signPayload returns sha256= prefixed hex string", () => {
  const sig = signPayload("test-secret", "hello world");
  assert.ok(sig.startsWith("sha256="));
  assert.equal(sig.length, 7 + 64); // "sha256=" (7) + 64 hex chars
});

test("signPayload is deterministic", () => {
  const a = signPayload("s", "body");
  const b = signPayload("s", "body");
  assert.equal(a, b);
});

test("signPayload differs for different secrets", () => {
  const a = signPayload("secret-a", "body");
  const b = signPayload("secret-b", "body");
  assert.notEqual(a, b);
});

test("signPayload differs for different payloads", () => {
  const a = signPayload("s", "body-a");
  const b = signPayload("s", "body-b");
  assert.notEqual(a, b);
});

test("verifySignature returns true for valid signature", () => {
  const secret = "my-secret";
  const body = JSON.stringify({ event: "chat.message" });
  const sig = signPayload(secret, body);
  assert.ok(verifySignature(secret, body, sig));
});

test("verifySignature returns false for wrong secret", () => {
  const body = "payload";
  const sig = signPayload("real-secret", body);
  assert.ok(!verifySignature("wrong-secret", body, sig));
});

test("verifySignature returns false for tampered payload", () => {
  const secret = "s";
  const sig = signPayload(secret, "original");
  assert.ok(!verifySignature(secret, "tampered", sig));
});

test("verifySignature returns false for empty inputs", () => {
  assert.ok(!verifySignature("", "body", "sha256=abc"));
  assert.ok(!verifySignature("secret", "", "sha256=abc"));
  assert.ok(!verifySignature("secret", "body", ""));
});

test("verifySignature handles Buffer payload", () => {
  const secret = "buf-secret";
  const body = Buffer.from("binary body");
  const sig = signPayload(secret, body);
  assert.ok(verifySignature(secret, body, sig));
});
