import { useEffect, useState } from "react";
import { Routes, Route, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import Support from "./pages/Support";
import BillingCanceled from "./pages/BillingCanceled";
import BillingSuccess from "./pages/BillingSuccess";
import { ProtectedRoute } from "./components/ProtectedRoute";
import Demo from "./pages/Demo";
import { DEMO_LANDING_ENABLED } from "./config/demoLanding";
import { LANES_ENABLED } from "./config/lanes";

import { creatorRoutes } from "./creator/routes";

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
import { useFeatureAccess } from "./hooks/useFeatureAccess";
import { useEffectiveEntitlements } from "./hooks/useEffectiveEntitlements";


function App() {
  const nav = useNavigate();
  const location = useLocation();
  const [showUnauthorized, setShowUnauthorized] = useState(false);
  const { effectiveEntitlements } = useEffectiveEntitlements();
  const { access } = useFeatureAccess(effectiveEntitlements);

  const canContentLibrary = access.contentLibrary.allowed;
  const canProjects = access.projects.allowed;
  const canEditor = access.editor.allowed;
  const canMyContentRecordings = !!access?.myContentRecordings?.allowed;
  const canMyContent = !!access?.myContent?.allowed;

  const myContentTarget = canProjects
    ? "/projects"
    : (canContentLibrary || canMyContentRecordings)
      ? "/content"
      : null;

  useEffect(() => {
    const onUnauthorized = () => {
      const path = window.location.pathname || "";

      // ── Public / auth pages: suppress ALL side-effects ──────────────
      // These pages don't require auth, so a 401 is expected and
      // must NOT clear tokens or flash the "Session expired" banner —
      // otherwise we race with a freshly-stored login token.
      if (
        path.startsWith("/login") || path.startsWith("/signup") ||
        path.startsWith("/demo") || path === "/welcome" ||
        path.startsWith("/privacy") || path.startsWith("/terms") ||
        path.startsWith("/support") || path.startsWith("/learnmore") ||
        path.startsWith("/i/") || path.startsWith("/invite/") ||
        path.startsWith("/billing/")
      ) {
        return;
      }
      if (DEMO_LANDING_ENABLED && path === "/") {
        return;
      }

      // ── Room / live / join pages: show banner but do NOT redirect ──
      // The Room page manages its own `needsReauth` state and shows an
      // in-room re-auth prompt.  Clearing storage here would destroy
      // the room-access-token and force-boot the user.
      if (
        path.startsWith("/room") || path.startsWith("/join") ||
        path.startsWith("/live") || path.startsWith("/ig/")
      ) {
        setShowUnauthorized(true);
        return;
      }

      // ── Protected pages: full logout + redirect ─────────────────────
      clearAuthStorage();
      clearMeCache();
      clearPlatformFlagsCache();
      setShowUnauthorized(true);

      // EDU lane should stay within EDU login.
      if (path.startsWith("/streamline/edu")) {
        const next = `${window.location.pathname}${window.location.search}`;
        const sp = new URLSearchParams();
        sp.set("returnTo", next);
        nav(`/streamline/edu/login?${sp.toString()}`);
        return;
      }

      if (path.startsWith("/streamline/corporate")) {
        const next = `${window.location.pathname}${window.location.search}`;
        const sp = new URLSearchParams();
        sp.set("returnTo", next);
        nav(`/streamline/corporate/login?${sp.toString()}`);
        return;
      }

      const next = `${window.location.pathname}${window.location.search}`;
      const sp = new URLSearchParams();
      sp.set("next", next);
      nav(`/login?${sp.toString()}`);
    };

    window.addEventListener("sl:unauthorized", onUnauthorized as any);
    return () => {
      window.removeEventListener("sl:unauthorized", onUnauthorized as any);
    };
  }, [nav]);

  // Hide the banner once the user is on an auth route.
  useEffect(() => {
    if (location.pathname.startsWith("/login") || location.pathname.startsWith("/signup")) {
      setShowUnauthorized(false);
    }
  }, [location.pathname]);

  return (
    <>
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
              sp.set("next", next);
              nav(`/login?${sp.toString()}`);
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
      {/* Demo Switchboard */}
      {LANES_ENABLED && <Route path="/demo" element={<Demo />} />}

      {/* Corporate lane — only when LANES_ENABLED */}
      {LANES_ENABLED ? (
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
      ) : (
        <Route path="/streamline/corporate/*" element={<Navigate to="/welcome" replace />} />
      )}

      {/* EDU lane — only when LANES_ENABLED */}
      {LANES_ENABLED ? (
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
      ) : (
        <Route path="/streamline/edu/*" element={<Navigate to="/welcome" replace />} />
      )}

      {/* Public / auth flow */}
      <Route path="/" element={DEMO_LANDING_ENABLED ? <Demo /> : <Navigate to="/welcome" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/support" element={<Support />} />
      <Route path="/billing/canceled" element={<BillingCanceled />} />
      <Route path="/billing/success" element={<BillingSuccess />} />

      {/* Creator lane */}
      {creatorRoutes({ canContentLibrary, canMyContentRecordings, canProjects, canEditor, canMyContent, myContentTarget })}

      </Routes>
    </>
  );
}

export default App;