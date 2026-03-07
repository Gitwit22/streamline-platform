/**
 * School Branding Context
 *
 * Provides school branding (logo, name, accent color, player title) to ALL
 * authenticated EDU pages via React context.
 *
 * Key behaviours:
 *  - Fetches branding once from GET /api/edu/org on mount.
 *  - Exposes `refreshBranding()` so the Settings page can trigger an
 *    instant update across the entire shell after saving.
 *  - Appends a cache-bust `?v=<timestamp>` to logo URLs so browser cache
 *    never shows stale images.
 *  - Re-exports a lightweight `useSchoolBranding()` hook for consumers.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { fetchEduOrg, type EduOrgSettings } from "../api/settings";

/* ── Public types ─────────────────────────────────────────────── */

export type SchoolBranding = {
  /** Firestore org doc id */
  orgId: string;
  schoolName: string;
  /** data-url OR remote url — always cache-busted when available */
  logoUrl: string | null;
  /** Raw logoDataUrl from Firestore (data: url). Null when no logo. */
  logoDataUrl: string | null;
  accentColor: string | null;
  secondaryColor: string | null;
  playerTitleText: string | null;
  /** Whether to show school branding in embedded iframes. Default true. */
  showSchoolBranding: boolean;
  /** Monotonically-increasing version counter; changes on every refresh. */
  version: number;
};

type SchoolBrandingCtx = {
  branding: SchoolBranding;
  /** Force an immediate re-fetch of branding data. Good for post-save. */
  refreshBranding: () => Promise<void>;
  loading: boolean;
};

const DEFAULT_BRANDING: SchoolBranding = {
  orgId: "",
  schoolName: "Your School",
  logoUrl: null,
  logoDataUrl: null,
  accentColor: null,
  secondaryColor: null,
  playerTitleText: null,
  showSchoolBranding: true,
  version: 0,
};

const BrandingContext = createContext<SchoolBrandingCtx>({
  branding: DEFAULT_BRANDING,
  refreshBranding: async () => {},
  loading: true,
});

/* ── Helpers ──────────────────────────────────────────────────── */

/** Append a cache-bust query param to a URL (skip for data: urls). */
function cacheBust(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("data:")) return url; // data urls don't cache
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${Date.now()}`;
}

function orgToBranding(org: EduOrgSettings, prevVersion: number): SchoolBranding {
  const raw = org.branding?.logoDataUrl ?? null;
  return {
    orgId: org.id,
    schoolName: org.name || "Your School",
    logoUrl: cacheBust(raw),
    logoDataUrl: raw,
    accentColor: org.branding?.accentColor ?? null,
    secondaryColor: org.branding?.secondaryColor ?? null,
    playerTitleText: org.branding?.playerTitleText ?? null,
    showSchoolBranding: true,
    version: prevVersion + 1,
  };
}

/* ── CSS variable injection ───────────────────────────────────── */

const DEFAULT_PRIMARY = "#f97316";   // orange-500
const DEFAULT_SECONDARY = "#7c3aed"; // violet-600

function hexToRgb(hex: string): string | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  return `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}`;
}

function applySchoolCssVars(b: SchoolBranding) {
  const root = document.documentElement;
  const p = b.accentColor || DEFAULT_PRIMARY;
  const s = b.secondaryColor || DEFAULT_SECONDARY;
  root.style.setProperty("--sl-school-primary", p);
  root.style.setProperty("--sl-school-primary-rgb", hexToRgb(p) || "249, 115, 22");
  root.style.setProperty("--sl-school-secondary", s);
  root.style.setProperty("--sl-school-secondary-rgb", hexToRgb(s) || "124, 58, 237");
}

/* ── Provider ────────────────────────────────────────────────── */

export function SchoolBrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<SchoolBranding>(DEFAULT_BRANDING);
  const [loading, setLoading] = useState(true);
  const versionRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const org = await fetchEduOrg();
      versionRef.current += 1;
      const next = orgToBranding(org, versionRef.current);
      setBranding(next);
      applySchoolCssVars(next);
    } catch {
      // Keep whatever we had before; don't crash the shell.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshBranding = useCallback(async () => {
    setLoading(true);
    await load();
  }, [load]);

  return (
    <BrandingContext.Provider value={{ branding, refreshBranding, loading }}>
      {children}
    </BrandingContext.Provider>
  );
}

/* ── Hook ─────────────────────────────────────────────────────── */

export function useSchoolBranding() {
  return useContext(BrandingContext);
}
