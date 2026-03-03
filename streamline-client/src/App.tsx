import { useEffect, useState } from "react";
import { Routes, Route, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";

import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import Support from "./pages/Support";
import LaneEnforcer from "./components/LaneEnforcer";

import CorporateLanding from "./corporate/entry/CorporateLanding";
import CorporateLogin from "./corporate/entry/CorporateLogin";
import CorporateProtectedRoute from "./corporate/layout/CorporateProtectedRoute";
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


function App() {
  const nav = useNavigate();
  const location = useLocation();
  const [showUnauthorized, setShowUnauthorized] = useState(false);

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
      nav(`/streamline/corporate/login?${sp.toString()}`);
    };

    window.addEventListener("sl:unauthorized", onUnauthorized as any);
    return () => {
      window.removeEventListener("sl:unauthorized", onUnauthorized as any);
    };
  }, [nav]);

  // Hide the banner once the user is on the corporate login/landing.
  useEffect(() => {
    if (
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
              nav(`/streamline/corporate/login?${sp.toString()}`);
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
      <Route path="/streamline/corporate" element={<Outlet />}>
        <Route index element={<CorporateLanding />} />
        <Route path="landing" element={<CorporateLanding />} />
        <Route path="login" element={<CorporateLogin />} />

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
          <Route path="admin" element={<CorporateAdmin />} />
          <Route path="*" element={<Navigate to="/streamline/corporate/dashboard" replace />} />
        </Route>
      </Route>

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