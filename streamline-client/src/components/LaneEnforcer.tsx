/**
 * LaneEnforcer — Corporate-only route guard
 *
 * Ensures all navigation stays within the corporate lane.
 * Any path outside the allowlist redirects to the corporate dashboard.
 */
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/* ── helpers ──────────────────────────────────────────────────────── */

/**
 * Returns true when the given path is allowed in the corporate-only app.
 */
function isAllowedPath(path: string): boolean {
  // Corporate lane — all sub-routes
  if (path.startsWith("/streamline/corporate")) return true;

  // Public pages
  if (path === "/" || path === "") return true;
  if (path.startsWith("/privacy")) return true;
  if (path.startsWith("/terms")) return true;
  if (path.startsWith("/support")) return true;

  // Everything else is not allowed
  return false;
}

/* ── component ────────────────────────────────────────────────────── */

export default function LaneEnforcer({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const nav = useNavigate();

  useEffect(() => {
    if (isAllowedPath(pathname)) return;

    // Redirect any non-corporate path to corporate dashboard
    nav("/streamline/corporate/dashboard", { replace: true });
  }, [pathname, nav]);

  return <>{children}</>;
}
