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
import LaneEnforcer from "./components/LaneEnforcer";
import Demo from "./pages/Demo";
import { DEMO_LANDING_ENABLED } from "./config/demoLanding";

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
import EduDirectory from "./edu/pages/Directory";
import EduRooms from "./edu/pages/Rooms";
import EduRoomPreJoin from "./edu/pages/RoomPreJoin";
import EduRoomView from "./edu/pages/RoomView";
import EduRecordings from "./edu/pages/Recordings";
import EduStudents from "./edu/pages/Students";
import EduMediaLibrary from "./edu/pages/MediaLibrary";
import EduPeopleHub from "./edu/pages/PeopleHub";
import EduLearnMore from "./edu/entry/EduLearnMore";
import EduGetStarted from "./edu/entry/EduGetStarted";
import EduChat from "./edu/pages/Chat";
import EduCalls from "./edu/pages/Calls";
import EduSupport from "./edu/pages/Support";
import SchoolPortal from "./edu/entry/SchoolPortal";
import ChangePassword from "./edu/pages/ChangePassword";
import LiveRoomViewer from "./pages/LiveRoomViewer";
import CompositorSpeaker from "./pages/CompositorSpeaker";

import CorporateLanding from "./corporate/entry/CorporateLanding";
import CorporateLogin from "./corporate/entry/CorporateLogin";
import CorporateJoinOrg from "./corporate/entry/JoinOrg";
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
import CorporateSettings from "./corporate/pages/Settings";
import CorporateCompany from "./corporate/pages/Company";
import CorporateMembers from "./corporate/pages/Members";
import CorporateBroadcastStudio from "./corporate/pages/BroadcastStudio";
import CorporateBroadcastViewer from "./corporate/pages/BroadcastViewer";
import CorporateRoleGuard from "./corporate/layout/CorporateRoleGuard";
import CorporateDirectory from "./corporate/pages/Directory";
import CorporateOrgChart from "./corporate/pages/OrgChart";

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

      // ── EDU / Corporate public entry pages: suppress everything ─────
      // Landing, login, and onboarding pages don't require auth.
      // A stale token or background refresh 401 must NOT flash the
      // banner or clear storage — the user hasn't even logged in yet.
      if (
        path === "/streamline/edu" ||
        path.startsWith("/streamline/edu/login") ||
        path.startsWith("/streamline/edu/learn-more") ||
        path.startsWith("/streamline/edu/get-started") ||
        path.startsWith("/streamline/edu/onboarding") ||
        path.startsWith("/streamline/edu/embed/event") ||
        path === "/streamline/corporate" ||
        path.startsWith("/streamline/corporate/login") ||
        path.startsWith("/streamline/corporate/join")
      ) {
        return;
      }
      if (DEMO_LANDING_ENABLED && path === "/") {
        return;
      }

      // ── HLS viewer / embed pages: fully public, suppress everything ─
      // These are public viewer pages that never require auth.  A 401
      // from a stale cookie or background probe should be silently
      // swallowed — no banner, no redirect, no token clearing.
      if (
        path.startsWith("/live") || path.startsWith("/ig/")
      ) {
        return;
      }

      // ── Room / join pages: show banner but do NOT redirect ─────────
      // The Room page manages its own `needsReauth` state and shows an
      // in-room re-auth prompt.  Clearing storage here would destroy
      // the room-access-token and force-boot the user.
      if (
        path.startsWith("/room") || path.startsWith("/join")
      ) {
        setShowUnauthorized(true);
        return;
      }

      // ── Protected pages: full logout + redirect ─────────────────────
      clearAuthStorage();
      clearMeCache();
      clearPlatformFlagsCache();
      setShowUnauthorized(true);

      // EDU lane should stay within EDU landing.
      if (path.startsWith("/streamline/edu")) {
        const next = `${window.location.pathname}${window.location.search}`;
        const sp = new URLSearchParams();
        sp.set("returnTo", next);
        nav(`/streamline/edu?${sp.toString()}`);
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

  // Hide the banner once the user is on an auth route or public viewer pages.
  useEffect(() => {
    if (
      location.pathname.startsWith("/login") ||
      location.pathname.startsWith("/signup") ||
      location.pathname.startsWith("/live") ||
      location.pathname.startsWith("/ig/") ||
      location.pathname === "/streamline/edu" ||
      location.pathname.startsWith("/streamline/edu/login") ||
      location.pathname.startsWith("/streamline/corporate/login") ||
      (DEMO_LANDING_ENABLED && location.pathname === "/")
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
              const path = window.location.pathname || "";
              const next = `${path}${window.location.search}`;
              if (path.startsWith("/streamline/edu")) {
                const sp = new URLSearchParams();
                sp.set("returnTo", next);
                nav(`/streamline/edu?${sp.toString()}`);
              } else if (path.startsWith("/streamline/corporate")) {
                const sp = new URLSearchParams();
                sp.set("returnTo", next);
                nav(`/streamline/corporate/login?${sp.toString()}`);
              } else {
                const sp = new URLSearchParams();
                sp.set("next", next);
                nav(`/login?${sp.toString()}`);
              }
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
      <Route path="/demo" element={<Demo />} />

      {/* Corporate lane */}
      <Route path="/streamline/corporate" element={<Outlet />}>
        <Route index element={<CorporateLanding />} />
        <Route path="landing" element={<CorporateLanding />} />
        <Route path="login" element={<CorporateLogin />} />
        <Route path="join" element={<CorporateJoinOrg />} />

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
          <Route path="directory" element={<CorporateDirectory />} />
          <Route path="org-chart" element={<CorporateOrgChart />} />
          <Route path="analytics" element={<CorporateRoleGuard allow={["owner", "admin"]}><CorporateAnalytics /></CorporateRoleGuard>} />
          <Route path="admin" element={<CorporateRoleGuard allow={["owner", "admin"]}><CorporateAdmin /></CorporateRoleGuard>} />
          <Route path="company" element={<CorporateRoleGuard allow={["owner", "admin"]}><CorporateCompany /></CorporateRoleGuard>} />
          <Route path="members" element={<CorporateRoleGuard allow={["owner", "admin"]}><CorporateMembers /></CorporateRoleGuard>} />
          <Route path="settings" element={<CorporateSettings />} />
          <Route path="*" element={<Navigate to="/streamline/corporate/dashboard" replace />} />
        </Route>
      </Route>

      {/* EDU lane */}
      <Route path="/streamline/edu" element={<Outlet />}>
        <Route index element={<EduLanding />} />
        <Route path="learn-more" element={<EduLearnMore />} />
        <Route path="get-started" element={<EduGetStarted />} />
        <Route path="login" element={<EduLogin />} />
        <Route path="onboarding" element={<EduOnboarding />} />

        {/* Public EDU embed players (no auth) */}
        <Route path="embed/event" element={<EduEmbedEventPlayer />} />

        {/* School-specific portal: /:schoolSlug login + staff activation */}
        <Route path="portal/:schoolSlug" element={<SchoolPortal />} />
        <Route path="portal/:schoolSlug/change-password" element={<ChangePassword />} />

        <Route
          element={
            <EduProtectedRoute>
              <EduShell />
            </EduProtectedRoute>
          }
        >
          <Route path="dashboard" element={<EduDashboard />} />
          <Route path="broadcast" element={<EduBroadcast />} />
          <Route path="rooms" element={<EduRooms />} />
          <Route path="rooms/:roomId/prejoin" element={<EduRoomPreJoin />} />
          <Route path="rooms/:roomId" element={<EduRoomView />} />
          <Route path="events" element={<EduEvents />} />
          {/* Merged: Media Library (Recordings + Archive) */}
          <Route path="media-library" element={<EduMediaLibrary />} />
          {/* Merged: People (Staff Directory + Students + Roles) */}
          <Route path="people" element={<EduPeopleHub />} />
          {/* Legacy redirects for bookmarks / old links */}
          <Route path="recordings" element={<Navigate to="/streamline/edu/media-library" replace />} />
          <Route path="archive" element={<Navigate to="/streamline/edu/media-library" replace />} />
          <Route path="students" element={<Navigate to="/streamline/edu/people" replace />} />
          <Route path="directory" element={<Navigate to="/streamline/edu/people" replace />} />
          <Route path="embed" element={<EduEmbed />} />
          <Route
            path="chat"
            element={
              <EduRoleGuard allow={["faculty_admin", "faculty_teacher"]}>
                <EduChat />
              </EduRoleGuard>
            }
          />
          <Route
            path="calls"
            element={
              <EduRoleGuard allow={["faculty_admin", "faculty_teacher"]}>
                <EduCalls />
              </EduRoleGuard>
            }
          />
          <Route
            path="support"
            element={
              <EduRoleGuard allow={["faculty_admin", "faculty_teacher", "principal", "school_admin", "district_staff", "support_staff"]}>
                <EduSupport />
              </EduRoleGuard>
            }
          />
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

      {/* Public shareable-room HLS viewer (no auth) */}
      <Route path="/live/:id" element={<LiveRoomViewer />} />

      {/* LiveKit egress compositor (loaded by headless browser, no auth) */}
      <Route path="/compositor/speaker" element={<CompositorSpeaker />} />

      {/* Public / auth flow */}
      <Route path="/" element={DEMO_LANDING_ENABLED ? <Demo /> : <Navigate to="/welcome" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/support" element={<Support />} />
      <Route path="/billing/canceled" element={<BillingCanceled />} />
      <Route path="/billing/success" element={<BillingSuccess />} />

      {/* Catch-all: redirect unknown routes to demo landing */}
      <Route path="*" element={<Navigate to="/" replace />} />

      </Routes>
    </LaneEnforcer>
  );
}

export default App;