import { useEffect, useState, useCallback } from "react";
import { apiFetchAuth, clearAuthStorage } from "../lib/api";

export interface AuthUser {
  id?: string;
  uid?: string;
  email?: string;
  planId?: string;
  isAdmin?: boolean;
  billingEnabled?: boolean;
  platformBillingEnabled?: boolean;
  effectiveBillingEnabled?: boolean;
  billingMode?: "test" | "live" | string;
  // Allow arbitrary additional fields from the server without losing type-safety on the ones we care about.
  [key: string]: any;
}

let cachedUser: AuthUser | null | undefined = undefined; // undefined => not fetched yet
let inFlight: Promise<AuthUser | null> | null = null;

// Bootstrap cachedUser from localStorage if available so login works
// even if /api/auth/me is temporarily unreachable (e.g., dev env).
if (typeof window !== "undefined" && cachedUser === undefined) {
  try {
    const raw = window.localStorage.getItem("sl_user");
    if (raw && raw !== "undefined") {
      cachedUser = JSON.parse(raw);
    }
  } catch {
    cachedUser = null;
  }
}

async function fetchAuthMeFresh(): Promise<AuthUser | null> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      // Use the canonical auth endpoint which exposes plan + billing + admin flags
      const res = await apiFetchAuth("/api/auth/me");
      const data = (await res.json()) as AuthUser;
      cachedUser = data;
      return data;
    } catch (err: any) {
      if (err?.status === 401 || err?.status === 403) {
        clearAuthStorage();
        cachedUser = null;
        return null;
      }
      throw err;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

async function loadAuthMe(): Promise<AuthUser | null> {
  // Fast path: if we already have a cached value (including from localStorage), use it.
  // We still do a background refresh in the hook so fields like isAdmin stay accurate.
  if (cachedUser !== undefined) return cachedUser;
  return fetchAuthMeFresh();
}

export function isAuthUserInTestMode(user: AuthUser | null | undefined): boolean {
  if (!user) return false;

  // Canonical: effectiveBillingEnabled === false
  if (user.effectiveBillingEnabled === false) return true;

  // Legacy per-user test mode: explicit billingEnabled === false
  if (user.billingEnabled === false) return true;

  // Fallback: older payloads that only expose billingMode
  if (user.billingMode === "test") return true;

  return false;
}

export function useAuthMe() {
  const [user, setUser] = useState<AuthUser | null>(cachedUser ?? null);
  const [loading, setLoading] = useState<boolean>(cachedUser === undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    // Always perform a background refresh so role/isAdmin don't get stuck
    // on stale localStorage values (common in test/dev env).
    if (cachedUser === undefined) {
      setLoading(true);
    }

    loadAuthMe()
      .then((data) => {
        if (!isMounted) return;
        setUser(data);
        setError(null);
        setLoading(false);
        // If we bootstrapped from localStorage, refresh once from the server.
        if (cachedUser !== undefined) {
          fetchAuthMeFresh()
            .then((fresh) => {
              if (!isMounted) return;
              setUser(fresh);
              setError(null);
            })
            .catch((err: any) => {
              if (!isMounted) return;
              setError(err?.message || String(err));
            });
        }
      })
      .catch((err: any) => {
        if (!isMounted) return;
        setUser(null);
        setError(err?.message || String(err));
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    cachedUser = undefined;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAuthMeFresh();
      setUser(data);
      setLoading(false);
    } catch (err: any) {
      setUser(null);
      setError(err?.message || String(err));
      setLoading(false);
    }
  }, []);

  return { user, loading, error, refresh } as const;
}
