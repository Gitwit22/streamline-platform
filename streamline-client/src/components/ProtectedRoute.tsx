import { ReactElement } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthMe } from "../hooks/useAuthMe";

/**
 * Reads orgType from the canonical sl_user localStorage entry
 * (set by /api/account/me during login). Returns null for creator users.
 */
function getStoredOrgType(): string | null {
  try {
    const raw = localStorage.getItem("sl_user");
    if (!raw) return null;
    const u = JSON.parse(raw);
    return typeof u?.orgType === "string" && u.orgType.trim() ? u.orgType.trim() : null;
  } catch {
    return null;
  }
}

const LANE_DASHBOARDS: Record<string, string> = {
  edu: "/streamline/edu/dashboard",
  corporate: "/streamline/corporate/dashboard",
};

export function ProtectedRoute({ children }: { children: ReactElement }) {
  const { user, loading } = useAuthMe();
  const location = useLocation();

  if (loading) return null; // could swap for spinner later
  if (!user) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  // Prevent EDU / Corporate users from accessing Creator routes.
  const orgType = getStoredOrgType();
  const laneDash = orgType ? LANE_DASHBOARDS[orgType] : null;
  if (laneDash) {
    return <Navigate to={laneDash} replace />;
  }

  return children;
}
