import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useCorporateMe } from "./CorporateProtectedRoute";
import type { CorpRole } from "../api/me";

interface Props {
  /** The roles that are allowed through this guard */
  allow: CorpRole[];
  children: ReactNode;
}

/**
 * Route-level guard that checks the current user's corporate role.
 * If the role is not in the `allow` list, redirects to the dashboard.
 */
export default function CorporateRoleGuard({ allow, children }: Props) {
  const me = useCorporateMe();
  const role = (me?.orgRole ?? "employee") as CorpRole;

  if (!allow.includes(role)) {
    return <Navigate to="/streamline/corporate/dashboard" replace />;
  }

  return <>{children}</>;
}
