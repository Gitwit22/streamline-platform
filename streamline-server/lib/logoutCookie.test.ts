import test from "node:test";
import assert from "node:assert/strict";
import { clearCookieOptions } from "../routes/auth";

// Regression (audit): logout cleared the cookie without Secure/SameSite=None,
// which browsers ignore for the cross-site session cookie.
test("logout clears the cookie with the same attributes it was set with", () => {
  const prev = process.env.CLIENT_URL;
  try {
    process.env.CLIENT_URL = "https://app.example.com";
    assert.deepEqual(clearCookieOptions(), { httpOnly: true, secure: true, sameSite: "none", path: "/" });
    process.env.CLIENT_URL = "http://localhost:5173";
    assert.deepEqual(clearCookieOptions(), { httpOnly: true, secure: false, sameSite: "lax", path: "/" });
  } finally {
    if (prev === undefined) delete process.env.CLIENT_URL;
    else process.env.CLIENT_URL = prev;
  }
});
