import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PLAYBACK_TOKEN_TTL_SEC,
  getPlaybackSecret,
  getPlaybackTokenTtlSec,
  signPlaybackToken,
  verifyPlaybackToken,
} from "./playbackToken";

const SECRET = "x".repeat(40);
const NOW = 1_800_000_000_000;

function sign(over: Partial<{ roomId: string; runId: string | null; ttlSec: number; entitlementId: string | null }> = {}) {
  return signPlaybackToken(SECRET, { roomId: "room1", runId: "run1", ttlSec: 600, entitlementId: "ent1", mode: "pay_per_view", ...over }, NOW);
}

describe("playback tokens", () => {
  it("round-trips and carries room, run, entitlement and expiry", () => {
    const { token, expiresAt } = sign();
    assert.equal(expiresAt, NOW + 600_000);
    const v = verifyPlaybackToken(SECRET, token, { roomId: "room1", runId: "run1" }, NOW + 1000);
    assert.equal(v.ok, true);
    assert.equal((v as any).payload.e, "ent1");
    assert.equal((v as any).payload.r, "room1");
    assert.equal((v as any).payload.m, "pay_per_view");
  });

  it("expires (boundary inclusive)", () => {
    const { token } = sign({ ttlSec: 60 });
    assert.equal(verifyPlaybackToken(SECRET, token, { roomId: "room1" }, NOW + 59_999).ok, true);
    assert.deepEqual(verifyPlaybackToken(SECRET, token, { roomId: "room1" }, NOW + 60_000), { ok: false, reason: "expired" });
  });

  it("is bound to the room path", () => {
    const { token } = sign();
    assert.deepEqual(verifyPlaybackToken(SECRET, token, { roomId: "room2" }, NOW), { ok: false, reason: "wrong_room" });
  });

  it("is bound to the HLS run (a new go-live invalidates old tokens)", () => {
    const { token } = sign();
    assert.deepEqual(verifyPlaybackToken(SECRET, token, { roomId: "room1", runId: "run2" }, NOW), { ok: false, reason: "wrong_run" });
    const legacy = sign({ runId: null }).token;
    assert.equal(verifyPlaybackToken(SECRET, legacy, { roomId: "room1", runId: null }, NOW).ok, true);
    // runId not checked when the caller doesn't ask (pre-I/O check).
    assert.equal(verifyPlaybackToken(SECRET, token, { roomId: "room1" }, NOW).ok, true);
  });

  it("rejects tampered payloads, signatures and other secrets", () => {
    const { token } = sign();
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, r: "room1", k: "run1", exp: Math.floor(NOW / 1000) + 99999 }))
      .toString("base64")
      .replace(/=+$/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    assert.deepEqual(verifyPlaybackToken(SECRET, `${forged}.${sig}`, { roomId: "room1" }, NOW), { ok: false, reason: "bad_signature" });
    const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
    assert.deepEqual(verifyPlaybackToken(SECRET, `${body}.${flipped}`, { roomId: "room1" }, NOW), { ok: false, reason: "bad_signature" });
    assert.deepEqual(verifyPlaybackToken("y".repeat(40), token, { roomId: "room1" }, NOW), { ok: false, reason: "bad_signature" });
  });

  it("rejects malformed input", () => {
    for (const t of [undefined, null, 42, "", "abc", "a.b.c", ".x", "x."]) {
      assert.equal(verifyPlaybackToken(SECRET, t, { roomId: "room1" }, NOW).ok, false);
    }
    assert.equal(verifyPlaybackToken(SECRET, "a".repeat(3000), { roomId: "room1" }, NOW).ok, false);
  });

  it("secret: required (>=32 chars) in production, dev fallback elsewhere", () => {
    assert.equal(getPlaybackSecret({ NODE_ENV: "production" }), null);
    assert.equal(getPlaybackSecret({ NODE_ENV: "production", HLS_PLAYBACK_SECRET: "short" }), null);
    assert.equal(getPlaybackSecret({ NODE_ENV: "production", HLS_PLAYBACK_SECRET: SECRET }), SECRET);
    assert.ok((getPlaybackSecret({ NODE_ENV: "development" }) || "").length > 0);
  });

  it("ttl env is clamped", () => {
    assert.equal(getPlaybackTokenTtlSec({}), DEFAULT_PLAYBACK_TOKEN_TTL_SEC);
    assert.equal(getPlaybackTokenTtlSec({ HLS_PLAYBACK_TOKEN_TTL_SEC: "5" }), 60);
    assert.equal(getPlaybackTokenTtlSec({ HLS_PLAYBACK_TOKEN_TTL_SEC: "999999" }), 6 * 3600);
    assert.equal(getPlaybackTokenTtlSec({ HLS_PLAYBACK_TOKEN_TTL_SEC: "nope" }), DEFAULT_PLAYBACK_TOKEN_TTL_SEC);
  });
});
