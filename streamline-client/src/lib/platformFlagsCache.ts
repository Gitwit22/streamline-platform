import { apiFetch } from "./api";
import { getMeCached } from "./meCache";
import { getPlatformFlagsValue, setPlatformFlagsValue, type PlatformFlags } from "./platformFlagsStore";

let inFlight: Promise<PlatformFlags> | null = null;

export function clearPlatformFlagsCache() {
  setPlatformFlagsValue(undefined, { fetchedAt: Date.now() });
  inFlight = null;
}

export function getCachedPlatformFlagsValue(): PlatformFlags | null | undefined {
  return getPlatformFlagsValue();
}

export async function getPlatformFlagsCached(): Promise<PlatformFlags> {
  const existing = getPlatformFlagsValue();
  if (existing !== undefined) return existing || {};

  if (!inFlight) {
    inFlight = (async () => {
      try {
        // Primary source of truth for general app UI: /api/account/me
        // (This is auth-scoped and reflects the current user's environment.)
        try {
          const me = await getMeCached();
          const meFlags = (me && typeof me === "object") ? ((me as any).platformFlags || null) : null;
          if (meFlags && typeof meFlags === "object") {
            setPlatformFlagsValue(meFlags as any);
            return (meFlags as any) as PlatformFlags;
          }
        } catch {
          // ignore and fall through to /api/plans
        }

        // Fallback: /api/plans for unauthenticated views / pricing pages.
        const res = await apiFetch("/api/plans", {}, { allowNonOk: true });
        if (!res.ok) {
          const fallback = { transcodeEnabled: false } as PlatformFlags;
          setPlatformFlagsValue(fallback);
          return fallback;
        }
        const json = await res.json().catch(() => null);
        const flags = ((json as any)?.platformFlags || {}) as PlatformFlags;
        const normalized = flags && typeof flags === "object" ? flags : ({ transcodeEnabled: false } as PlatformFlags);
        setPlatformFlagsValue(normalized);
        return normalized;
      } catch {
        const fallback = { transcodeEnabled: false } as PlatformFlags;
        setPlatformFlagsValue(fallback);
        return fallback;
      } finally {
        inFlight = null;
      }
    })();
  }

  return inFlight;
}
