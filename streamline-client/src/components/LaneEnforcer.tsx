/**
 * LaneEnforcer — EDU-only lane guard
 *
 * In the EDU build, any path that is NOT under /streamline/edu or a
 * known public path (/privacy, /terms, /support) gets redirected to
 * the EDU dashboard. This prevents deep-links to defunct creator or
 * corporate routes from reaching a blank page.
 */
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const EDU_DASHBOARD = "/streamline/edu/dashboard";

/**
 * Returns true if this path is allowed in the EDU build
 * (either an EDU route or a public/legal page).
 */
function isAllowedPath(path: string): boolean {
  // EDU lane
  if (path.startsWith("/streamline/edu")) return true;

  // Public / legal
  if (path === "/" || path === "") return true;
  if (path.startsWith("/privacy")) return true;
  if (path.startsWith("/terms")) return true;
  if (path.startsWith("/support")) return true;

  // Everything else is a defunct creator/corporate route
  return false;
}

/* ── component ────────────────────────────────────────────────────── */

export default function LaneEnforcer({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const nav = useNavigate();

  useEffect(() => {
    if (isAllowedPath(pathname)) return;

    // Redirect any non-EDU route to the EDU dashboard
    nav(EDU_DASHBOARD, { replace: true });
  }, [pathname, nav]);

  return <>{children}</>;
}
