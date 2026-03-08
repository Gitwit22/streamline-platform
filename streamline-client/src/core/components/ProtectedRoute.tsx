import { ReactElement } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthMe } from "../hooks/useAuthMe";

export function ProtectedRoute({ children }: { children: ReactElement }) {
  const { user, loading } = useAuthMe();
  const location = useLocation();

  if (loading) return null; // could swap for spinner later
  if (!user) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  return children;
}
