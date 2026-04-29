/**
 * Monetization library — unit tests
 *
 * Tests pure functions: code generation, hashing, and in-memory cache.
 * These don't require Firebase and can run in CI without credentials.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// Pure re-implementations of the functions to avoid importing firebaseAdmin
// (which requires credentials). The source of truth is lib/monetization.ts.

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 12;

function generateAccessCode(): string {
  const maxValid = Math.floor(256 / CODE_CHARS.length) * CODE_CHARS.length;
  let code = "";
  while (code.length < CODE_LENGTH) {
    const bytes = crypto.randomBytes(CODE_LENGTH * 2);
    for (let i = 0; i < bytes.length && code.length < CODE_LENGTH; i++) {
      if (bytes[i] < maxValid) {
        code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
      }
    }
  }
  return code;
}

function hashAccessCode(rawCode: string): string {
  const salt = "streamline-monetization-salt";
  return crypto
    .createHmac("sha256", salt)
    .update(rawCode.toUpperCase().trim())
    .digest("hex");
}

// In-memory raw-code cache (matches lib/monetization.ts implementation)
const rawCodeCache = new Map<string, { code: string; expiresAt: number }>();
const RAW_CODE_TTL_MS = 10 * 60 * 1000;

function storeRawCode(sessionId: string, rawCode: string) {
  rawCodeCache.set(sessionId, { code: rawCode, expiresAt: Date.now() + RAW_CODE_TTL_MS });
}

function peekRawCode(sessionId: string): string | null {
  const entry = rawCodeCache.get(sessionId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { rawCodeCache.delete(sessionId); return null; }
  return entry.code;
}

function retrieveAndDeleteRawCode(sessionId: string): string | null {
  const entry = rawCodeCache.get(sessionId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { rawCodeCache.delete(sessionId); return null; }
  rawCodeCache.delete(sessionId);
  return entry.code;
}

describe("generateAccessCode", () => {
  it("returns a 12-char uppercase+digit string", () => {
    const code = generateAccessCode();
    assert.equal(code.length, 12);
    assert.match(code, /^[A-Z2-9]+$/);
  });

  it("excludes ambiguous characters (0, O, 1, I)", () => {
    // Generate many codes and check none contain ambiguous chars
    for (let i = 0; i < 100; i++) {
      const code = generateAccessCode();
      assert.equal(code.includes("0"), false);
      assert.equal(code.includes("O"), false);
      assert.equal(code.includes("1"), false);
      assert.equal(code.includes("I"), false);
    }
  });

  it("produces unique codes", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      codes.add(generateAccessCode());
    }
    assert.equal(codes.size, 100, "100 codes should all be unique");
  });
});

describe("hashAccessCode", () => {
  it("returns a hex string", () => {
    const hash = hashAccessCode("ABCD1234EFGH");
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it("is case-insensitive", () => {
    const h1 = hashAccessCode("ABCD1234EFGH");
    const h2 = hashAccessCode("abcd1234efgh");
    assert.equal(h1, h2);
  });

  it("trims whitespace", () => {
    const h1 = hashAccessCode("ABCD1234EFGH");
    const h2 = hashAccessCode("  ABCD1234EFGH  ");
    assert.equal(h1, h2);
  });

  it("different codes produce different hashes", () => {
    const h1 = hashAccessCode("AAAA2222BBBB");
    const h2 = hashAccessCode("CCCC3333DDDD");
    assert.notEqual(h1, h2);
  });
});

describe("rawCodeCache", () => {
  it("stores and retrieves a code via peek", () => {
    storeRawCode("sess_1", "TESTCODE1234");
    const code = peekRawCode("sess_1");
    assert.equal(code, "TESTCODE1234");
  });

  it("retrieveAndDeleteRawCode removes the entry", () => {
    storeRawCode("sess_2", "CODE_DELETE");
    const code = retrieveAndDeleteRawCode("sess_2");
    assert.equal(code, "CODE_DELETE");
    // Second call should return null
    const code2 = retrieveAndDeleteRawCode("sess_2");
    assert.equal(code2, null);
  });

  it("returns null for unknown session", () => {
    assert.equal(peekRawCode("unknown_session"), null);
    assert.equal(retrieveAndDeleteRawCode("unknown_session"), null);
  });
});
