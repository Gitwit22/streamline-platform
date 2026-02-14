import { apiFetchAuth } from "./api";
import { setPlatformFlagsValue } from "./platformFlagsStore";

// Simple in-memory cache for /api/account/me so Settings and other pages
// can share a single canonical user payload per session, with basic
// in-flight de-duplication.

let cachedMe: any | null | undefined = undefined; // undefined => not fetched yet
let inFlightMe: Promise<any | null> | null = null;

export function clearMeCache() {
  cachedMe = undefined;
  inFlightMe = null;
}

export function getCachedMeValue(): any | null | undefined {
  return cachedMe;
}

export async function getMeCached(): Promise<any | null> {
  // Fast path: reuse any cached value (including explicit null) without
  // triggering a new network request.
  if (cachedMe !== undefined) return cachedMe;

  if (!inFlightMe) {
    inFlightMe = (async () => {
      try {
        const res = await apiFetchAuth("/api/account/me", { cache: "no-store" });
        const data = await res.json();
        cachedMe = data;
        if (data && typeof data === "object" && (data as any).platformFlags) {
          setPlatformFlagsValue((data as any).platformFlags);
        }
        return data;
      } finally {
        inFlightMe = null;
      }
    })();
  }

  return inFlightMe;
}
