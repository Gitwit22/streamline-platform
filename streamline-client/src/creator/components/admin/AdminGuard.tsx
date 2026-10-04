import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuthMe } from "../../../hooks/useAuthMe";

/**
 * Client-side guard for /admin/* pages. The server enforces requireAdmin on
 * every admin API; this only avoids rendering admin UI (and firing admin
 * requests) for signed-out or non-admin users.
 */
export function AdminGuard({ children }: { children: ReactNode }) {
  const { user, loading } = useAuthMe();

  if (loading) {
    return (
      <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af" }}>
        Verifying admin access…
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "#e5e7eb" }}>
        <h1 style={{ margin: 0 }}>Sign in required</h1>
        <p style={{ margin: 0, color: "#9ca3af" }}>Admin pages require a signed-in admin account.</p>
        <Link to="/login" style={{ color: "#93c5fd" }}>
          Go to sign in
        </Link>
      </div>
    );
  }

  if (!user.isAdmin) {
    return (
      <div style={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "#e5e7eb" }}>
        <h1 style={{ margin: 0 }}>Access denied</h1>
        <p style={{ margin: 0, color: "#9ca3af" }}>You don't have admin privileges.</p>
        <Link to="/join" style={{ color: "#93c5fd" }}>
          Back to StreamLine
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}

/** Cross-links between the admin pages. */
export function AdminNav({ current }: { current: "dashboard" | "usage" | "support" }) {
  const links: Array<{ id: typeof current; to: string; label: string }> = [
    { id: "dashboard", to: "/admin/dashboard", label: "Dashboard" },
    { id: "usage", to: "/admin/usage", label: "Usage & billing" },
    { id: "support", to: "/admin/support", label: "Horizon live monitor" },
  ];
  return (
    <nav aria-label="Admin pages" style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 13 }}>
      {links.map((l) =>
        l.id === current ? (
          <span key={l.id} style={{ fontWeight: 700, color: "#e5e7eb" }} aria-current="page">
            {l.label}
          </span>
        ) : (
          <Link key={l.id} to={l.to} style={{ color: "#93c5fd" }}>
            {l.label}
          </Link>
        )
      )}
    </nav>
  );
}
