/**
 * Strip tracking / analytics query parameters that social platforms and
 * email clients append when users click shared links.
 *
 * Calling this early (e.g. on App mount) ensures downstream route handlers
 * and invite-link parsers see a clean URL without interference from
 * Facebook (fbclid), Google (gclid, utm_*), Twitter (twclid), etc.
 *
 * The function performs a `history.replaceState` (no navigation / reload)
 * only when at least one tracking param was removed.
 */

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "msclkid",
  "twclid",
  "dclid",
  "mc_cid",
  "mc_eid",
  "oly_anon_id",
  "oly_enc_id",
  "_openstat",
  "wickedid",
  "yclid",
  "igshid",
]);

const UTM_PREFIX = "utm_";

function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  if (TRACKING_PARAMS.has(lower)) return true;
  if (lower.startsWith(UTM_PREFIX)) return true;
  return false;
}

export function cleanTrackingParams(): void {
  if (typeof window === "undefined") return;

  try {
    const url = new URL(window.location.href);
    const params = url.searchParams;
    const toDelete: string[] = [];

    params.forEach((_value, key) => {
      if (isTrackingParam(key)) {
        toDelete.push(key);
      }
    });

    if (toDelete.length === 0) return;

    for (const key of toDelete) {
      params.delete(key);
    }

    // Rebuild the URL preserving path + remaining params + hash
    const cleaned = `${url.pathname}${params.toString() ? `?${params.toString()}` : ""}${url.hash}`;
    window.history.replaceState(window.history.state, "", cleaned);
  } catch {
    // Defensive: never break routing on URL parsing edge cases
  }
}
