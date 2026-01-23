
import { API_BASE } from "./apiBase";

/**
 * Read the auth token from localStorage for header-based auth fallback.
 * This complements the httpOnly cookie so that browsers or webviews that
 * block third-party cookies can still authenticate via Authorization.
 */
export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return (
      window.localStorage.getItem("sl_token") ||
      window.localStorage.getItem("auth_token") ||
      null
    );
  } catch {
    return null;
  }
}

export function clearAuthToken() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem("sl_token");
    window.localStorage.removeItem("auth_token");
  } catch {}
}

function logClearedStaleHeaderTokenOnce() {
  if (typeof window === "undefined") return;
  const w = window as any;
  if (w.__sl_auth_cleared_stale_token_logged) return;
  w.__sl_auth_cleared_stale_token_logged = true;
  // One-line, rate-limited per page load.
  console.log("[auth] Cleared stale header token after cookie fallback");
}

function looksLikeJwt(token: string): boolean {
  // Basic sanity check to avoid spamming the API with obviously malformed values.
  // Keep this intentionally loose: just require 3 non-empty segments (a.b.c).
  if (typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  return parts.every((p) => typeof p === "string" && p.length > 0);
}

/**
 * API helper that always sends credentials and, when available, a
 * Bearer token header. Callers should pass a path like "/api/...";
 * this helper will prepend API_BASE. Absolute URLs are also accepted
 * and will be used as-is.
 */
export async function apiFetch(path: string, init: RequestInit = {}, options?: { allowNonOk?: boolean }) {
  let token = getAuthToken();
  if (token && !looksLikeJwt(token)) {
    clearAuthToken();
    token = null;
  }
  const headers = new Headers(init.headers || {});

  // Default JSON content-type when sending a body unless overridden.
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  // Header-based auth fallback: prefer explicit Authorization on init,
  // otherwise attach the stored token if present.
  const attachedAuthFromStorage = Boolean(token) && !headers.has("Authorization");
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;

  const res = await fetch(url, {
    ...init,
    credentials: "include",
    headers,
  });

  // If the server had to ignore a bad Authorization header and fall back
  // to a valid cookie session, quietly clear the stored token to prevent
  // future stale-token poisoning.
  if (
    res.ok &&
    attachedAuthFromStorage &&
    (path === "/api/account/me" || path === "/api/auth/me")
  ) {
    const fallback = (res.headers.get("x-sl-auth-fallback") || "").toLowerCase();
    const headerInvalid = res.headers.get("x-sl-auth-header-invalid") === "1";
    if (fallback === "cookie" || headerInvalid) {
      const hadStoredToken = Boolean(getAuthToken());
      clearAuthToken();
      if (hadStoredToken) {
        logClearedStaleHeaderTokenOnce();
      }
    }
  }

  if (!options?.allowNonOk && !res.ok) {
    if ((res.status === 401 || res.status === 403) && (path === "/api/account/me" || path === "/api/auth/me")) {
      clearAuthStorage();
    }
    let errBody: any = null;
    try {
      errBody = await res.json();
    } catch {}
    throw Object.assign(new Error(`HTTP ${res.status}`), {
      status: res.status,
      body: errBody,
    });
  }
  return res;
}

export async function getToken(
  roomId: string,
  userId: string,
  role: "host" | "guest"
) {
  const res = await apiFetch("/v1/rooms/token", {
    method: "POST",
    body: JSON.stringify({ roomId, userId, role }),
  });
  return res.json() as Promise<{ token: string; wsUrl: string }>;
}

export async function apiStartRecording(
  roomId: string,
  layout: "speaker" | "grid",
  mode: "cloud" | "dual" = "cloud",
  presetId?: string,
  roomAccessToken?: string | null
) {
  const res = await apiFetch("/api/recordings/start", {
    method: "POST",
    body: JSON.stringify({ roomId, layout, mode, presetId }),
    headers: roomAccessToken
      ? {
          "x-room-access-token": roomAccessToken,
        }
      : undefined,
  });
  return res.json();
}

export async function apiStopRecording(recordingId: string, roomAccessToken?: string | null) {
  const res = await apiFetch("/api/recordings/stop", {
    method: "POST",
    body: JSON.stringify({ recordingId }),
    headers: roomAccessToken
      ? {
          "x-room-access-token": roomAccessToken,
        }
      : undefined,
  });
  return res.json() as Promise<{ ok: true }>;
}

export function clearAuthStorage() {
  if (typeof window === "undefined") return;
  try {
    clearAuthToken();
    window.localStorage.removeItem("sl_user");
    window.localStorage.removeItem("sl_userId");
  } catch {}
}
