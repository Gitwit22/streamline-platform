/**
 * LaneEnforcer — Global lane isolation guard
 *
 * Prevents EDU / Corporate users from accidentally landing on
 * unrecognised routes. Reads `orgType` from the canonical `sl_user`
 * localStorage entry (set by `/api/account/me` during login) and
 * redirects to the correct lane dashboard when the user is on an
 * unknown route.
 *
 * This is the outermost enforcement layer. Individual route guards
 * (EduProtectedRoute, CorporateProtectedRoute) provide additional
 * per-lane checks as a belt-and-suspenders measure.
 */
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/* ── helpers ──────────────────────────────────────────────────────── */

function getStoredOrgType(): string | null {
  try {
    const raw = localStorage.getItem("sl_user");
    if (!raw) return null;
    const user = JSON.parse(raw);
    return typeof user?.orgType === "string" && user.orgType.trim()
      ? user.orgType.trim()
      : null;
  } catch {
    return null;
  }
}

/**
 * Returns true when the given path is an unknown route (not under
 * a known lane or a public page).
 */
function isUnknownRoute(path: string): boolean {
  // EDU / Corporate lane paths
  if (path.startsWith("/streamline/edu")) return false;
  if (path.startsWith("/streamline/corporate")) return false;

  // Public / auth / marketing paths — lane-neutral
  if (path === "/" || path === "") return false;
  if (path.startsWith("/login")) return false;
  if (path.startsWith("/signup")) return false;
  if (path.startsWith("/demo")) return false;
  if (path === "/welcome") return false;
  if (path.startsWith("/privacy")) return false;
  if (path.startsWith("/terms")) return false;
  if (path.startsWith("/support")) return false;
  if (path.startsWith("/billing/")) return false;
  if (path.startsWith("/learnmore")) return false;
  if (path.startsWith("/checkout")) return false;
  if (path.startsWith("/pricing")) return false;

  // Public viewer / embed pages
  if (path.startsWith("/live")) return false;
  if (path.startsWith("/ig/")) return false;

  // Invite landing (public)
  if (path.startsWith("/i/")) return false;
  if (path.startsWith("/invite/")) return false;

  // Everything remaining is an unknown route
  return true;
}

const LANE_DASHBOARDS: Record<string, string> = {
  edu: "/streamline/edu/dashboard",
  corporate: "/streamline/corporate/dashboard",
};

/* ── component ────────────────────────────────────────────────────── */

export default function LaneEnforcer({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const nav = useNavigate();

  useEffect(() => {
    if (!isUnknownRoute(pathname)) return;

    const orgType = getStoredOrgType();
    if (!orgType) return; // not logged in — nothing to do

    const target = LANE_DASHBOARDS[orgType];
    if (target) {
      nav(target, { replace: true });
    }
  }, [pathname, nav]);

  return <>{children}</>;
}
