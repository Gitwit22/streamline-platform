/**
 * Public branding API — no auth required.
 *
 * Used by embed players, HLS viewers, and public watch pages so they can show
 * the school's logo, name, and accent colour without requiring a login.
 */

import { apiFetch } from "../../lib/api";

export type PublicSchoolBranding = {
  orgId: string;
  schoolName: string;
  logoUrl: string | null;
  accentColor: string | null;
  playerTitleText: string | null;
  showSchoolBranding: boolean;
  updatedAt: number | null;
};

/** Append a cache-bust query param (skip for data: urls). */
function cacheBust(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("data:")) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${Date.now()}`;
}

export async function fetchPublicBranding(orgId: string): Promise<PublicSchoolBranding | null> {
  try {
    const res = await apiFetch(
      `/api/public/edu/branding/${encodeURIComponent(orgId)}`,
      { method: "GET" },
      { allowNonOk: true },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const b = data?.branding;
    if (!b) return null;
    return {
      ...b,
      logoUrl: cacheBust(b.logoUrl),
    };
  } catch {
    return null;
  }
}

export async function fetchPublicBrandingBySlug(slug: string): Promise<PublicSchoolBranding | null> {
  try {
    const res = await apiFetch(
      `/api/public/edu/branding/slug/${encodeURIComponent(slug)}`,
      { method: "GET" },
      { allowNonOk: true },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const b = data?.branding;
    if (!b) return null;
    return {
      ...b,
      logoUrl: cacheBust(b.logoUrl),
    };
  } catch {
    return null;
  }
}
