import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useCorporateMe } from "./CorporateProtectedRoute";

export default function CorporateAdminRoute({ children }: { children: ReactNode }) {
  const me = useCorporateMe();

  if (!me) {
    return <Navigate to="/corporate/login" replace />;
  }

  if (me.role !== "admin") {
    return <Navigate to="/corporate/dashboard" replace />;
  }

  return <>{children}</>;
}
