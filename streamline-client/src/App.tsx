import { useEffect, useState } from "react";
import { Routes, Route, Navigate, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";

import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import Support from "./pages/Support";
import LaneEnforcer from "./components/LaneEnforcer";

import CorporateLanding from "./corporate/entry/CorporateLanding";
import CorporateLogin from "./corporate/entry/CorporateLogin";
import CorporateCreateAccount from "./corporate/entry/CorporateCreateAccount";
import CorporateInviteAccept from "./corporate/entry/CorporateInviteAccept";
import CorporateProtectedRoute from "./corporate/layout/CorporateProtectedRoute";
import CorporateAdminRoute from "./corporate/layout/CorporateAdminRoute";
import CorporateShell from "./corporate/layout/CorporateShell";
import CorporateDashboard from "./corporate/pages/Dashboard";
import CorporateCalls from "./corporate/pages/Calls";
import CorporateBroadcasts from "./corporate/pages/Broadcasts";
import CorporateChat from "./corporate/pages/Chat";
import CorporateTraining from "./corporate/pages/Training";
import CorporateDocuments from "./corporate/pages/Documents";
import CorporateAnalytics from "./corporate/pages/Analytics";
import CorporateAdmin from "./corporate/pages/Admin";
import CorporateBroadcastStudio from "./corporate/pages/BroadcastStudio";
import CorporateBroadcastViewer from "./corporate/pages/BroadcastViewer";

import { clearAuthStorage } from "./lib/api";
import { clearMeCache } from "./lib/meCache";
import { clearPlatformFlagsCache } from "./lib/platformFlagsCache";

function LegacyCorporateInviteRedirect() {
  const params = useParams();
  const token = params.token ? encodeURIComponent(params.token) : "";
  return <Navigate to={token ? `/corporate/invite/${token}` : "/corporate"} replace />;
}


function App() {
  const nav = useNavigate();
  const location = useLocation();
  const [showUnauthorized, setShowUnauthorized] = useState(false);

  useEffect(() => {
    document.title = "StreamLine Corporate";
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      const path = window.location.pathname || "";

      // ── Public / auth pages: suppress ALL side-effects ──────────────
      if (
        path.startsWith("/privacy") || path.startsWith("/terms") ||
        path.startsWith("/support")
      ) {
        return;
      }

      // ── Corporate landing / login: suppress ─────────────────────────
      if (
        path.startsWith("/corporate/login") ||
        path.startsWith("/corporate/create-account") ||
        path.startsWith("/corporate/invite") ||
        path === "/corporate" ||
        path === "/corporate/" ||
        path === "/streamline/corporate" ||
        path === "/streamline/corporate/" ||
        path.startsWith("/streamline/corporate/landing") ||
        path.startsWith("/streamline/corporate/login")
      ) {
        return;
      }

      // ── Protected pages: full logout + redirect ─────────────────────
      clearAuthStorage();
      clearMeCache();
      clearPlatformFlagsCache();
      setShowUnauthorized(true);

      const next = `${window.location.pathname}${window.location.search}`;
      const sp = new URLSearchParams();
      sp.set("returnTo", next);
      nav(`/corporate/login?${sp.toString()}`);
    };

    window.addEventListener("sl:unauthorized", onUnauthorized as any);
    return () => {
      window.removeEventListener("sl:unauthorized", onUnauthorized as any);
    };
  }, [nav]);

  // Hide the banner once the user is on the corporate login/landing.
  useEffect(() => {
    if (
      location.pathname.startsWith("/corporate/login") ||
      location.pathname.startsWith("/corporate/create-account") ||
      location.pathname.startsWith("/corporate/invite") ||
      location.pathname === "/corporate" ||
      location.pathname === "/corporate/" ||
      location.pathname.startsWith("/streamline/corporate/login") ||
      location.pathname.startsWith("/streamline/corporate/landing") ||
      location.pathname === "/streamline/corporate" ||
      location.pathname === "/streamline/corporate/"
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
              nav(`/corporate/login?${sp.toString()}`);
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
      {/* Corporate lane */}
      <Route path="/corporate" element={<Outlet />}>
        <Route index element={<CorporateLanding />} />
        <Route path="landing" element={<CorporateLanding />} />
        <Route path="login" element={<CorporateLogin />} />
        <Route path="create-account" element={<CorporateCreateAccount />} />
        <Route path="invite/:token" element={<CorporateInviteAccept />} />

        <Route
          element={
            <CorporateProtectedRoute>
              <CorporateShell />
            </CorporateProtectedRoute>
          }
        >
          <Route path="dashboard" element={<CorporateDashboard />} />
          <Route path="calls" element={<CorporateCalls />} />
          <Route path="broadcasts" element={<CorporateBroadcasts />} />
          <Route path="broadcasts/:id/studio" element={<CorporateBroadcastStudio />} />
          <Route path="broadcasts/:id/watch" element={<CorporateBroadcastViewer />} />
          <Route path="chat" element={<CorporateChat />} />
          <Route path="training" element={<CorporateTraining />} />
          <Route path="documents" element={<CorporateDocuments />} />
          <Route path="analytics" element={<CorporateAnalytics />} />
          <Route path="admin" element={<CorporateAdminRoute><CorporateAdmin /></CorporateAdminRoute>} />
          <Route path="*" element={<Navigate to="/corporate/dashboard" replace />} />
        </Route>
      </Route>

      {/* Legacy corporate URLs */}
      <Route path="/streamline/corporate" element={<Navigate to="/corporate" replace />} />
      <Route path="/streamline/corporate/landing" element={<Navigate to="/corporate/landing" replace />} />
      <Route path="/streamline/corporate/login" element={<Navigate to="/corporate/login" replace />} />
      <Route path="/streamline/corporate/create-account" element={<Navigate to="/corporate/create-account" replace />} />
      <Route path="/streamline/corporate/invite/:token" element={<LegacyCorporateInviteRedirect />} />
      <Route path="/streamline/corporate/dashboard" element={<Navigate to="/corporate/dashboard" replace />} />
      <Route path="/streamline/corporate/calls" element={<Navigate to="/corporate/calls" replace />} />
      <Route path="/streamline/corporate/broadcasts" element={<Navigate to="/corporate/broadcasts" replace />} />
      <Route path="/streamline/corporate/chat" element={<Navigate to="/corporate/chat" replace />} />
      <Route path="/streamline/corporate/training" element={<Navigate to="/corporate/training" replace />} />
      <Route path="/streamline/corporate/documents" element={<Navigate to="/corporate/documents" replace />} />
      <Route path="/streamline/corporate/analytics" element={<Navigate to="/corporate/analytics" replace />} />
      <Route path="/streamline/corporate/admin" element={<Navigate to="/corporate/admin" replace />} />

      {/* Public pages */}
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/support" element={<Support />} />

      {/* Catch-all → corporate landing */}
      <Route path="*" element={<Navigate to="/streamline/corporate" replace />} />

      </Routes>
    </LaneEnforcer>
  );
}

export default App;