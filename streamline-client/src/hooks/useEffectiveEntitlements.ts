import { useEffect, useState, useCallback } from "react";
import { getMeCached, clearMeCache } from "../lib/meCache";

/**
 * Fetches effective entitlements from the cached /api/account/me payload.
 *
 * • Skips the network call entirely when no auth signals exist in
 *   localStorage (avoids firing `sl:unauthorized` on public pages).
 * • Listens for the `sl:auth-changed` custom event (dispatched by
 *   LoginPage after a successful login) so entitlements refresh
 *   automatically without a full page reload.
 */
export function useEffectiveEntitlements() {
  const [effectiveEntitlements, setEffectiveEntitlements] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [trigger, setTrigger] = useState(0);

  // Re-fetch whenever the trigger bumps (initial mount + post-login)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // If the user clearly has no auth session yet, skip the fetch
      // to avoid a 401 that would fire sl:unauthorized on public pages.
      const hasAuth =
        typeof window !== "undefined" &&
        (localStorage.getItem("sl_user") || localStorage.getItem("authToken"));

      if (!hasAuth) {
        if (!cancelled) {
          setEffectiveEntitlements(null);
          setLoading(false);
        }
        return;
      }

      try {
        const me = await getMeCached();
        const ent = me?.effectiveEntitlements || me?.entitlements || null;
        if (!cancelled) setEffectiveEntitlements(ent);
      } catch {
        if (!cancelled) setEffectiveEntitlements(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [trigger]);

  // Listen for login events so we re-hydrate entitlements post-login
  const bump = useCallback(() => {
    clearMeCache();
    setLoading(true);
    setTrigger((t) => t + 1);
  }, []);

  useEffect(() => {
    window.addEventListener("sl:auth-changed", bump);
    return () => window.removeEventListener("sl:auth-changed", bump);
  }, [bump]);

  return { effectiveEntitlements, loading } as const;
}
