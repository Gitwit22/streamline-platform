
import { API_BASE } from "./apiBase";

/**
 * Read the auth token from localStorage for header-based auth fallback.
 * This complements the httpOnly cookie so that browsers or webviews that
 * block third-party cookies can still authenticate via Authorization.
 */
export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("authToken") || null;
  } catch {
    return null;
  }
}

export function clearAuthToken() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem("authToken");
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

export class ApiUnauthorizedError extends Error {
  name = "ApiUnauthorizedError";
  status = 401;
  constructor() {
    super("unauthorized");
  }
}

function emitUnauthorizedEventOnce(detail?: string) {
  if (typeof window === "undefined") return;
  const w = window as any;
  const now = Date.now();
  // Rate limit (avoid event storms if several calls fail at once)
  if (typeof w.__sl_last_unauthorized_event_ts === "number" && now - w.__sl_last_unauthorized_event_ts < 2000) {
    return;
  }
  w.__sl_last_unauthorized_event_ts = now;
  try {
    window.dispatchEvent(new CustomEvent("sl:unauthorized", { detail: { reason: detail || "unauthorized" } }));
  } catch {
    // ignore
  }
}

/**
 * API helper that always sends credentials and, when available, a
 * Bearer token header. Callers should pass a path like "/api/...";
 * this helper will prepend API_BASE. Absolute URLs are also accepted
 * and will be used as-is.
 */
export async function apiFetch(path: string, init: RequestInit = {}, options?: { allowNonOk?: boolean }) {
  const headers = new Headers(init.headers || {});

  // Default JSON content-type when sending a body unless overridden.
  // NOTE: Only auto-set for string bodies (JSON.stringify). Do NOT set this for
  // FormData uploads (browser must set multipart boundaries), blobs, etc.
  if (typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  // Cookie-primary auth: always send credentials.
  // NOTE: Do not auto-attach Authorization from localStorage here; callers
  // that truly need header auth should set it explicitly.

  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;

  const res = await fetch(url, {
    ...init,
    credentials: "include",
    headers,
  });

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

/**
 * Strict auth wrapper for protected endpoints.
 * - Reads the token from localStorage at call time
 * - Always attaches `Authorization: Bearer ...`
 * - Still uses cookie credentials via apiFetch
 */
export async function apiFetchAuth(
  path: string,
  init: RequestInit = {},
  options?: { allowNonOk?: boolean }
) {
  if (typeof window === "undefined") {
    throw new ApiUnauthorizedError();
  }

  let token: string | null = null;
  try {
    token = window.localStorage.getItem("authToken");
  } catch {}

  if (!token || !looksLikeJwt(token)) {
    clearAuthToken();
    emitUnauthorizedEventOnce("missing_or_invalid_token");
    throw new ApiUnauthorizedError();
  }

  const headers = new Headers(init.headers || {});
  const hadExplicitAuthHeader = headers.has("Authorization");
  if (!hadExplicitAuthHeader) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  // Always allow non-ok here so we can handle 401 consistently, while keeping
  // the same thrown error shape as apiFetch for other non-ok responses.
  const res = await apiFetch(path, { ...init, headers }, { allowNonOk: true });

  if (res.status === 401) {
    // Tiny but high ROI: a single retry can recover from multi-tab token updates
    // or very small races where authToken was updated after this request began.
    if (!hadExplicitAuthHeader) {
      try {
        const nextToken = window.localStorage.getItem("authToken");
        if (nextToken && nextToken !== token && looksLikeJwt(nextToken)) {
          const retryHeaders = new Headers(init.headers || {});
          retryHeaders.set("Authorization", `Bearer ${nextToken}`);
          const retryRes = await apiFetch(path, { ...init, headers: retryHeaders }, { allowNonOk: true });
          if (retryRes.status !== 401) {
            if (!options?.allowNonOk && !retryRes.ok) {
              let errBody: any = null;
              try {
                errBody = await retryRes.json();
              } catch {}
              throw Object.assign(new Error(`HTTP ${retryRes.status}`), {
                status: retryRes.status,
                body: errBody,
              });
            }
            return retryRes;
          }
        }
      } catch {
        // ignore retry failures; fall through to unauthorized handling
      }
    }

    clearAuthToken();
    emitUnauthorizedEventOnce("401");
    throw new ApiUnauthorizedError();
  }

  if (!options?.allowNonOk && !res.ok) {
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
  mode: "cloud" | "dual" = "cloud",
  presetId?: string,
  roomAccessToken?: string | null
) {
  const res = await apiFetchAuth("/api/recordings/start", {
    method: "POST",
    body: JSON.stringify({ roomId, mode, presetId }),
    headers: roomAccessToken
      ? {
          "x-room-access-token": roomAccessToken,
        }
      : undefined,
  });
  return res.json();
}

export async function apiStopRecording(recordingId: string, roomAccessToken?: string | null) {
  const res = await apiFetchAuth("/api/recordings/stop", {
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

export type RoomLayoutMode = "speaker" | "grid" | "carousel" | "pip";

export type RoomLayout = {
  mode: RoomLayoutMode;
  maxTiles?: number;
  followSpeaker?: boolean;
  pinnedIdentity?: string | null;
};

export async function apiGetRoomLayout(roomId: string, roomAccessToken: string) {
  const res = await apiFetch(`/api/rooms/${encodeURIComponent(roomId)}/layout`, {
    method: "GET",
    headers: {
      "x-room-access-token": roomAccessToken,
    },
  });
  return res.json() as Promise<{
    ok: true;
    roomId: string;
    roomLayout: RoomLayout | null;
    effectiveLayoutMode: "speaker" | "grid";
    effectiveLayoutSource: "roomLayout" | "legacyRecordingLayout" | "request" | "default";
  }>;
}

export async function apiUpdateRoomLayout(
  roomId: string,
  roomAccessToken: string,
  roomLayout: Pick<RoomLayout, "mode"> & Partial<RoomLayout>
) {
  const res = await apiFetchAuth(`/api/rooms/${encodeURIComponent(roomId)}/layout`, {
    method: "PATCH",
    body: JSON.stringify({ roomLayout }),
    headers: {
      "x-room-access-token": roomAccessToken,
    },
  });
  return res.json() as Promise<{ ok: true; roomId: string; roomLayout: RoomLayout }>;
}

export function clearAuthStorage() {
  if (typeof window === "undefined") return;
  try {
    clearAuthToken();
    // Clear all Streamline-scoped session state (auth + cached user/session hints)
    // so stale tabs/deep-links can't reuse old localStorage values.
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      if (key === "authToken" || key.startsWith("sl_")) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      try {
        window.localStorage.removeItem(key);
      } catch {}
    }
  } catch {}
}
