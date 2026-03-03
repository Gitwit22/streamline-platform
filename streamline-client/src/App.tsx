import { useEffect, useState } from "react";
import { Routes, Route, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import Support from "./pages/Support";
import LaneEnforcer from "./components/LaneEnforcer";

import EduLanding from "./edu/entry/EduLanding";
import EduLogin from "./edu/entry/EduLogin";
import EduProtectedRoute from "./edu/layout/EduProtectedRoute";
import EduRoleGuard from "./edu/layout/EduRoleGuard";
import EduShell from "./edu/layout/EduShell";
import EduDashboard from "./edu/pages/Dashboard";
import EduBroadcast from "./edu/pages/Broadcast";
import EduEvents from "./edu/pages/Events";
import EduArchive from "./edu/pages/Archive";
import EduPeople from "./edu/pages/People";
import EduEmbed from "./edu/pages/Embed";
import EduEmbedEventPlayer from "./edu/pages/EmbedEventPlayer";
import EduSettings from "./edu/pages/Settings";
import EduOnboarding from "./edu/pages/Onboarding";

import { clearAuthStorage } from "./lib/api";
import { clearMeCache } from "./lib/meCache";
import { clearPlatformFlagsCache } from "./lib/platformFlagsCache";


function App() {
  const nav = useNavigate();
  const location = useLocation();
  const [showUnauthorized, setShowUnauthorized] = useState(false);

  useEffect(() => {
    const onUnauthorized = () => {
      const path = window.location.pathname || "";

      // ── Public / auth pages: suppress ALL side-effects ──────────────
      if (
        path.startsWith("/login") || path.startsWith("/signup") ||
        path.startsWith("/privacy") || path.startsWith("/terms") ||
        path.startsWith("/support") || path === "/"
      ) {
        return;
      }

      // ── EDU embed pages: fully public, suppress everything ──────────
      // Public embed pages never require auth. A 401 from a stale
      // cookie or background probe should be silently swallowed.
      if (path.startsWith("/streamline/edu/embed")) {
        return;
      }

      // ── Protected pages: full logout + redirect to EDU login ────────
      clearAuthStorage();
      clearMeCache();
      clearPlatformFlagsCache();
      setShowUnauthorized(true);

      const next = `${window.location.pathname}${window.location.search}`;
      const sp = new URLSearchParams();
      sp.set("returnTo", next);
      nav(`/streamline/edu/login?${sp.toString()}`);
    };

    window.addEventListener("sl:unauthorized", onUnauthorized as any);
    return () => {
      window.removeEventListener("sl:unauthorized", onUnauthorized as any);
    };
  }, [nav]);

  // Hide the banner once the user is on an auth/public page.
  useEffect(() => {
    if (
      location.pathname.startsWith("/streamline/edu/login") ||
      location.pathname.startsWith("/streamline/edu/embed") ||
      location.pathname === "/"
    ) {
      setShowUnauthorized(false);
    }
  }, [location.pathname]);

  return (
    <LaneEnforcer>
      {showUnauthorized && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            padding: "10px 12px",
            background: "rgba(153, 27, 27, 0.95)",
            borderBottom: "1px solid rgba(255,255,255,0.12)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 13 }}>
            Session expired. Please sign in again.
          </div>
          <button
            onClick={() => {
              const next = `${window.location.pathname}${window.location.search}`;
              const sp = new URLSearchParams();
              sp.set("returnTo", next);
              nav(`/streamline/edu/login?${sp.toString()}`);
            }}
            style={{
              fontSize: 12,
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.25)",
              background: "rgba(0,0,0,0.25)",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Sign in
          </button>
        </div>
      )}

      <Routes>

      {/* ── EDU lane (primary) ────────────────────────────────────────── */}
      <Route path="/streamline/edu" element={<Outlet />}>
        <Route index element={<EduLanding />} />
        <Route path="login" element={<EduLogin />} />
        <Route path="onboarding" element={<EduOnboarding />} />

        {/* Public EDU embed players (no auth) */}
        <Route path="embed/event" element={<EduEmbedEventPlayer />} />

        <Route
          element={
            <EduProtectedRoute>
              <EduShell />
            </EduProtectedRoute>
          }
        >
          <Route path="dashboard" element={<EduDashboard />} />
          <Route path="broadcast" element={<EduBroadcast />} />
          <Route path="events" element={<EduEvents />} />
          <Route path="archive" element={<EduArchive />} />
          <Route
            path="people"
            element={
              <EduRoleGuard allow={["faculty_admin", "student_producer", "student_producer_assigned"]}>
                <EduPeople />
              </EduRoleGuard>
            }
          />
          <Route path="embed" element={<EduEmbed />} />
          <Route
            path="settings"
            element={
              <EduRoleGuard allow={["faculty_admin"]}>
                <EduSettings />
              </EduRoleGuard>
            }
          />

          <Route path="*" element={<Navigate to="/streamline/edu/dashboard" replace />} />
        </Route>
      </Route>

      {/* ── Public / legal ─────────────────────────────────────────── */}
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/support" element={<Support />} />

      {/* ── Catch-all: redirect everything else to EDU ────────────────── */}
      <Route path="/" element={<Navigate to="/streamline/edu" replace />} />
      <Route path="*" element={<Navigate to="/streamline/edu" replace />} />

      </Routes>
    </LaneEnforcer>
  );
}

export default App;