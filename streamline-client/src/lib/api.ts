
import { API_BASE } from "./apiBase";
import { getFirebaseIdToken, getFirebaseIdTokenWhenReady } from "./firebaseClient";

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

/**
 * Best available bearer token for the current user, or null when anonymous.
 * Unlike getAuthToken() (legacy localStorage only, which is cleared after a
 * Firebase login), this also considers the Firebase ID token and waits briefly
 * for Firebase to restore a persisted session on page load.
 */
export async function getOptionalAuthToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const fb = await getFirebaseIdTokenWhenReady();
    if (fb && looksLikeJwt(fb)) return fb;
  } catch {
    // ignore
  }
  const legacy = getAuthToken();
  return legacy && looksLikeJwt(legacy) ? legacy : null;
}

/** True when the user has a usable sign-in session (Firebase or legacy JWT). */
export async function hasAuthSession(): Promise<boolean> {
  return !!(await getOptionalAuthToken());
}

/** `{ Authorization: "Bearer …" }` when signed in, otherwise `{}`. */
export async function optionalAuthHeaders(): Promise<Record<string, string>> {
  const token = await getOptionalAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Fetch that sends Authorization when the user is signed in and plain
 * credentials otherwise. Never emits global unauthorized side effects and
 * always returns the response (including 401/403) to the caller.
 */
export async function apiFetchOptionalAuth(path: string, init: RequestInit = {}): Promise<Response> {
  if (await hasAuthSession()) {
    try {
      return await apiFetchAuth(path, init, { allowNonOk: true, suppressAuthSideEffects: true });
    } catch (err) {
      if (!(err instanceof ApiUnauthorizedError)) throw err;
      // Session vanished between the check and the request: fall through.
    }
  }
  return apiFetch(path, init, { allowNonOk: true });
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
  options?: { allowNonOk?: boolean; suppressAuthSideEffects?: boolean }
) {
  if (typeof window === "undefined") {
    throw new ApiUnauthorizedError();
  }

  const suppressAuthSideEffects = !!options?.suppressAuthSideEffects;

  const headers = new Headers(init.headers || {});
  const hadExplicitAuthHeader = headers.has("Authorization");


  let token: string | null = null;
  let tokenSource: "firebase" | "legacy" | "explicit" | null = null;

  if (hadExplicitAuthHeader) {
    tokenSource = "explicit";
  } else {
    // 1) Firebase ID token (preferred)
    token = await getFirebaseIdToken();
    if (token && looksLikeJwt(token)) {
      tokenSource = "firebase";
    } else {
      token = null;
    }

    // 2) Legacy header JWT fallback (localStorage)
    if (!token) {
      try {
        const legacy = window.localStorage.getItem("authToken");
        if (legacy && looksLikeJwt(legacy)) {
          token = legacy;
          tokenSource = "legacy";
        }
      } catch {}
    }

    if (!token) {
      if (!suppressAuthSideEffects) {
        clearAuthToken();
        emitUnauthorizedEventOnce("missing_token");
      }
      throw new ApiUnauthorizedError();
    }

    headers.set("Authorization", `Bearer ${token}`);
  }

  // Always allow non-ok here so we can handle 401 consistently, while keeping
  // the same thrown error shape as apiFetch for other non-ok responses.
  const res = await apiFetch(path, { ...init, headers }, { allowNonOk: true });

  // If the server indicates our legacy header token was stale and it used a cookie
  // session instead, clear the cached legacy token so we don't keep sending it.
  try {
    const headerInvalid = String(res.headers.get("x-sl-auth-header-invalid") || "").trim();
    if (headerInvalid === "1" || headerInvalid.toLowerCase() === "true") {
      clearAuthToken();
      logClearedStaleHeaderTokenOnce();
    }
  } catch {
    // ignore
  }

  if (res.status === 401) {
    let last401Res: Response = res;
    // A retry that gets past 401 is returned (or thrown as a normal HTTP error)
    // outside the try/catch blocks so a 403/500 isn't mistaken for a logout.
    let recoveredRes: Response | null = null;
    const finishRecovered = async (retryRes: Response) => {
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
    };

    // Firebase tokens can expire; attempt a single force-refresh retry.
    if (!hadExplicitAuthHeader && tokenSource === "firebase") {
      try {
        const refreshed = await getFirebaseIdToken({ forceRefresh: true });
        if (refreshed && looksLikeJwt(refreshed)) {
          const retryHeaders = new Headers(init.headers || {});
          retryHeaders.set("Authorization", `Bearer ${refreshed}`);
          const retryRes = await apiFetch(path, { ...init, headers: retryHeaders }, { allowNonOk: true });
          if (retryRes.status !== 401) {
            recoveredRes = retryRes;
          } else {
            last401Res = retryRes;
          }
        }
      } catch {
        // ignore refresh failures; fall through to unauthorized handling
      }
      if (recoveredRes) return finishRecovered(recoveredRes);
    }

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
            recoveredRes = retryRes;
          } else {
            last401Res = retryRes;
          }
        }
      } catch {
        // ignore retry failures; fall through to unauthorized handling
      }
      if (recoveredRes) return finishRecovered(recoveredRes);
    }

    // Callers that opt into both allowNonOk and suppressAuthSideEffects
    // handle 401 themselves (e.g. the room token request maps error codes,
    // retries with a guest session, or shows a re-auth banner). Hand them the
    // response instead of throwing, and leave stored tokens alone.
    if (options?.allowNonOk && suppressAuthSideEffects) {
      return last401Res;
    }

    if (!suppressAuthSideEffects) {
      clearAuthToken();
      emitUnauthorizedEventOnce("401");
    }
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

export type OutputFormat = "landscape_16x9" | "vertical_9x16" | "square_1x1";

export type RoomLayout = {
  mode: RoomLayoutMode;
  maxTiles?: number;
  followSpeaker?: boolean;
  pinnedIdentity?: string | null;
  outputFormat?: OutputFormat;
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
    outputFormat: OutputFormat;
    effectiveLayoutMode: "speaker" | "grid";
    effectiveLayoutSource: "roomLayout" | "legacyRecordingLayout" | "request" | "default";
    availablePresets: Array<{ id: string; label: string; participantCount: number }>;
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

// ---------------------------------------------------------------------------
// Studio Layout API (preset-based canvas composition)
// ---------------------------------------------------------------------------

import type { StudioLayout } from "./studioLayout";

export async function apiGetStudioLayout(roomId: string, roomAccessToken: string) {
  const res = await apiFetch(`/api/rooms/${encodeURIComponent(roomId)}/studio-layout`, {
    method: "GET",
    headers: {
      "x-room-access-token": roomAccessToken,
    },
  });
  return res.json() as Promise<{
    ok: true;
    roomId: string;
    studioLayout: StudioLayout | null;
  }>;
}

export async function apiUpdateStudioLayout(
  roomId: string,
  roomAccessToken: string,
  studioLayout: StudioLayout,
) {
  const res = await apiFetchAuth(`/api/rooms/${encodeURIComponent(roomId)}/studio-layout`, {
    method: "PATCH",
    body: JSON.stringify({ studioLayout }),
    headers: {
      "x-room-access-token": roomAccessToken,
    },
  });
  return res.json() as Promise<{ ok: true; roomId: string; studioLayout: StudioLayout }>;
}

// ---------------------------------------------------------------------------
// Program State (shared output/compositor state)
// ---------------------------------------------------------------------------

import type { ProgramState } from "./programState";

export async function apiGetProgramState(roomId: string, roomAccessToken: string) {
  const res = await apiFetch(`/api/rooms/${encodeURIComponent(roomId)}/program-state`, {
    method: "GET",
    headers: {
      "x-room-access-token": roomAccessToken,
    },
  });
  return res.json() as Promise<{
    ok: true;
    roomId: string;
    programState: ProgramState | null;
  }>;
}

export async function apiUpdateProgramState(
  roomId: string,
  roomAccessToken: string,
  patch: Partial<ProgramState>,
) {
  const res = await apiFetchAuth(`/api/rooms/${encodeURIComponent(roomId)}/program-state`, {
    method: "PATCH",
    body: JSON.stringify(patch),
    headers: {
      "x-room-access-token": roomAccessToken,
    },
  });
  return res.json() as Promise<{ ok: true; roomId: string; programState: ProgramState }>;
}

export type RoomPolicy = {
  visibility: "public" | "unlisted" | "private";
  requiresAuth: boolean;
  requiresPayment: boolean;
  allowGuests: boolean | null;
};

export async function apiGetRoomPolicy(roomId: string, roomAccessToken: string) {
  const res = await apiFetch(`/api/rooms/${encodeURIComponent(roomId)}/policy`, {
    method: "GET",
    headers: {
      "x-room-access-token": roomAccessToken,
    },
  });

  return res.json() as Promise<{ ok: true; roomId: string } & RoomPolicy>;
}

export async function apiUpdateRoomPolicy(
  roomId: string,
  roomAccessToken: string,
  patch: Pick<Required<RoomPolicy>, "allowGuests">
) {
  const res = await apiFetchAuth(`/api/rooms/${encodeURIComponent(roomId)}/policy`, {
    method: "PATCH",
    headers: {
      "x-room-access-token": roomAccessToken,
    },
    body: JSON.stringify(patch),
  });
  return res.json() as Promise<{ ok: true; roomId: string; allowGuests: boolean }>;
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
