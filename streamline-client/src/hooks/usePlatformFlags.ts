import { useEffect, useState } from "react";
import { getPlatformFlagsCached, type PlatformFlags } from "../lib/platformFlagsCache";
import { getPlatformFlagsValue, subscribePlatformFlags } from "../lib/platformFlagsStore";

export function usePlatformFlags() {
  const [flags, setFlags] = useState<PlatformFlags | null>(() => {
    const existing = getPlatformFlagsValue();
    return existing === undefined ? null : (existing || {});
  });

  useEffect(() => {
    let cancelled = false;

    const unsub = subscribePlatformFlags(() => {
      if (cancelled) return;
      const v = getPlatformFlagsValue();
      if (v === undefined) {
        setFlags(null);
      } else {
        setFlags(v || {});
      }
    });

    // If nothing has published flags yet, fetch them (auth /me preferred, plans fallback).
    const existing = getPlatformFlagsValue();
    if (existing === undefined) {
      getPlatformFlagsCached()
        .then((f) => {
          if (!cancelled) setFlags(f || {});
        })
        .catch(() => {
          if (!cancelled) setFlags({ transcodeEnabled: false });
        });
    }

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return {
    flags,
    loading: flags === null,
  } as const;
}
