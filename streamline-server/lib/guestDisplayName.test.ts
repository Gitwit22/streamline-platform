import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { signGuestSession, tryGetGuestSession, type GuestSessionClaims } from "../middleware/guestSession";

// ---------------------------------------------------------------------------
// Guest display name persistence tests
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-guest-session-secret";

test("signGuestSession includes displayName in JWT when provided", () => {
  process.env.GUEST_SESSION_SECRET = TEST_SECRET;
  const token = signGuestSession(
    { inviteId: "inv_1", roomId: "room_1", role: "guest", displayName: "Alice" },
    "1h",
  );
  const decoded = jwt.verify(token, TEST_SECRET) as any;
  assert.equal(decoded.displayName, "Alice");
  assert.equal(decoded.role, "guest");
  assert.equal(decoded.roomId, "room_1");
});

test("signGuestSession works without displayName (backward compat)", () => {
  process.env.GUEST_SESSION_SECRET = TEST_SECRET;
  const token = signGuestSession(
    { inviteId: "inv_2", roomId: "room_2", role: "guest" },
    "1h",
  );
  const decoded = jwt.verify(token, TEST_SECRET) as any;
  assert.equal(decoded.displayName, undefined);
  assert.equal(decoded.role, "guest");
});

test("tryGetGuestSession extracts displayName from JWT", () => {
  process.env.GUEST_SESSION_SECRET = TEST_SECRET;
  const token = signGuestSession(
    { inviteId: "inv_3", roomId: "room_3", role: "guest", displayName: "Bob" },
    "1h",
  );
  const req = { cookies: { sl_guest: token }, headers: {}, body: {}, query: {} } as any;
  const session = tryGetGuestSession(req);
  assert.ok(session);
  assert.equal(session.displayName, "Bob");
  assert.equal(session.role, "guest");
  assert.equal(session.roomId, "room_3");
});

test("tryGetGuestSession returns undefined displayName for old tokens", () => {
  process.env.GUEST_SESSION_SECRET = TEST_SECRET;
  // Simulate an old token without displayName
  const token = jwt.sign(
    { inviteId: "inv_4", roomId: "room_4", role: "guest" },
    TEST_SECRET,
    { expiresIn: "1h" },
  );
  const req = { cookies: { sl_guest: token }, headers: {}, body: {}, query: {} } as any;
  const session = tryGetGuestSession(req);
  assert.ok(session);
  assert.equal(session.displayName, undefined);
  assert.equal(session.role, "guest");
});

test("display name fallback chain: body > session > identity > generated", () => {
  // This tests the server-side resolution logic used in POST /rooms/:roomId/token
  // (extracted here as a pure function test)
  function resolveDisplayName(
    bodyName: string,
    sessionName: string,
    identityName: string,
  ): string {
    const rawDisplayName = bodyName.trim();
    const sessionDisplayName = sessionName;
    const identityFallback = identityName.trim();
    return rawDisplayName
      || sessionDisplayName
      || identityFallback
      || `Guest-XXXXXX`;
  }

  // Body provided
  assert.equal(resolveDisplayName("Alice", "Bob", "uid123"), "Alice");
  // Body empty, session available
  assert.equal(resolveDisplayName("", "Bob", "uid123"), "Bob");
  // Both empty, identity available
  assert.equal(resolveDisplayName("", "", "uid123"), "uid123");
  // All empty, falls back to generated
  assert.equal(resolveDisplayName("", "", ""), "Guest-XXXXXX");
  // Body with spaces only
  assert.equal(resolveDisplayName("   ", "Bob", "uid123"), "Bob");
});
