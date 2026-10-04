import { getFirebaseIdToken, isFirebaseWebConfigured, onFirebaseAuthStateChanged } from "./firebaseClient";

/**
 * Client-side helpers for invite guest sessions (the `sl_guest` JWT the
 * server issues from join-now / redeem and renews on every room token mint).
 *
 * Storage layers, most specific first:
 *   - sessionStorage `sl_guest_session:<roomId>` (per tab, per room)
 *   - localStorage `sl_guestSessionToken` + `sl_guestSessionRoomId` (survives
 *     in-app browsers that drop sessionStorage on reload)
 */

const SESSION_KEY_PREFIX = "sl_guest_session:";
const LOCAL_TOKEN_KEY = "sl_guestSessionToken";
const LOCAL_ROOM_KEY = "sl_guestSessionRoomId";

function base64UrlDecode(segment: string): string {
  const b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return atob(padded);
}

/** Decodes (without verifying) a JWT payload. Returns null when malformed. */
export function decodeJwtPayload(token: string | null | undefined): Record<string, any> | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const json = base64UrlDecode(parts[1]);
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * True when the token is malformed or its `exp` is in the past (with a small
 * skew so a token about to expire isn't sent). Tokens without `exp` are
 * treated as usable; the server decides.
 */
export function isJwtExpired(token: string | null | undefined, nowMs: number = Date.now(), skewMs = 15_000): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload) return true;
  const exp = typeof payload.exp === "number" ? payload.exp : null;
  if (exp === null) return false;
  return exp * 1000 <= nowMs + skewMs;
}

/** A usable guest session for this room: well-formed, unexpired, and scoped to roomId. */
export function isUsableGuestSession(token: string | null | undefined, roomId: string, nowMs: number = Date.now()): boolean {
  if (!token || isJwtExpired(token, nowMs)) return false;
  const payload = decodeJwtPayload(token);
  const claimRoom = typeof payload?.roomId === "string" ? payload.roomId : "";
  // Sessions always carry roomId; when present it must match.
  return !claimRoom || claimRoom === roomId;
}

export function storeGuestSession(roomId: string, token: string): void {
  if (!roomId || !token) return;
  try {
    sessionStorage.setItem(`${SESSION_KEY_PREFIX}${roomId}`, token);
  } catch {
    // ignore
  }
  try {
    localStorage.setItem(LOCAL_TOKEN_KEY, token);
    localStorage.setItem(LOCAL_ROOM_KEY, roomId);
  } catch {
    // ignore
  }
}

export function clearStoredGuestSession(roomId: string): void {
  try {
    sessionStorage.removeItem(`${SESSION_KEY_PREFIX}${roomId}`);
  } catch {
    // ignore
  }
  try {
    if (localStorage.getItem(LOCAL_ROOM_KEY) === roomId) {
      localStorage.removeItem(LOCAL_TOKEN_KEY);
      localStorage.removeItem(LOCAL_ROOM_KEY);
    }
  } catch {
    // ignore
  }
}

/** Stored (sessionStorage, then localStorage) guest session for the room, ignoring expired ones. */
export function readStoredGuestSession(roomId: string): string | null {
  if (!roomId) return null;
  try {
    const fromSession = sessionStorage.getItem(`${SESSION_KEY_PREFIX}${roomId}`)?.trim();
    if (fromSession && isUsableGuestSession(fromSession, roomId)) return fromSession;
  } catch {
    // ignore
  }
  try {
    if (localStorage.getItem(LOCAL_ROOM_KEY) === roomId) {
      const fromLocal = localStorage.getItem(LOCAL_TOKEN_KEY)?.trim();
      if (fromLocal && isUsableGuestSession(fromLocal, roomId)) return fromLocal;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Per-tab nonce for join-now so the server can make double-clicks/retries
 * idempotent (same identity) without two people sharing an identity.
 */
export function getJoinNonce(inviteId: string): string {
  const key = `sl_join_nonce:${inviteId}`;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing && /^[A-Za-z0-9_-]{16,128}$/.test(existing)) return existing;
  } catch {
    // ignore
  }
  let nonce = "";
  try {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  }
  try {
    sessionStorage.setItem(key, nonce);
  } catch {
    // ignore
  }
  return nonce;
}

/**
 * Resolves once Firebase has restored (or ruled out) the signed-in user, so a
 * freshly loaded invite page doesn't treat a signed-in user as anonymous.
 * Bounded so a misconfigured Firebase never blocks the page.
 */
function waitForFirebaseAuthReady(timeoutMs = 3000): Promise<void> {
  if (!isFirebaseWebConfigured()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let done = false;
    let unsub: (() => void) | null = null;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        unsub?.();
      } catch {
        // ignore
      }
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    try {
      unsub = onFirebaseAuthStateChanged(() => {
        clearTimeout(timer);
        finish();
      });
      if (done) unsub();
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
}

/**
 * Authorization header for optional-auth endpoints (invite resolve/redeem):
 * attaches the signed-in user's token when there is one, with no logout side
 * effects when there isn't.
 */
export async function optionalAuthHeaders(): Promise<Record<string, string>> {
  let token: string | null = null;
  try {
    await waitForFirebaseAuthReady();
    token = await getFirebaseIdToken();
  } catch {
    token = null;
  }
  if (!token) {
    try {
      token = localStorage.getItem("authToken");
    } catch {
      token = null;
    }
  }
  return token && token.split(".").length === 3 ? { Authorization: `Bearer ${token}` } : {};
}

/** `/login?next=<current path>` so the user comes back to the same invite link. */
export function loginUrlReturningHere(): string {
  const next = `${window.location.pathname}${window.location.search}`;
  return `/login?next=${encodeURIComponent(next)}`;
}

/** Removes the given query params from the address bar without navigating. */
export function stripQueryParams(names: string[]): void {
  try {
    const url = new URL(window.location.href);
    let changed = false;
    for (const n of names) {
      if (url.searchParams.has(n)) {
        url.searchParams.delete(n);
        changed = true;
      }
    }
    if (changed) {
      const search = url.searchParams.toString();
      window.history.replaceState(window.history.state, "", `${url.pathname}${search ? `?${search}` : ""}${url.hash}`);
    }
  } catch {
    // ignore
  }
}
