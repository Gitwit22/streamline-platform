import { useEffect, useState } from "react";
import { getMeCached } from "../lib/meCache";

export function useEffectiveEntitlements() {
  const [effectiveEntitlements, setEffectiveEntitlements] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
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
  }, []);

  return { effectiveEntitlements, loading } as const;
}
