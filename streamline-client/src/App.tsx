import PricingExplainerPage from "./pages/PricingExplainerPage";
import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import AdminUsage from './pages/AdminUsage';
import AdminDashboard from './pages/AdminDashboard';

import Welcome from "./pages/Welcome";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import Join from "./pages/Join";
import Room from "./pages/Room";
import InviteLanding from "./pages/InviteLanding";
import InviteRedeem from "./pages/InviteRedeem";
import Live from "./pages/Live";
import SettingsDestinations from "./pages/SettingsDestinations";
import RoomExitPage from "./pages/RoomExitPage";
import AssetLibrary from "./editing/AssetLibrary";
import ProjectsDashboard from "./editing/ProjectsDashboard";
import EditorPage from "./editing/EditorPage";
import RenderAndUploadPage from "./editing/pages/RenderAndUploadPage";
import EditorDisabled from "./pages/EditorDisabled";
import LearnMore from "./pages/LearnMore";
import Checkout from "./pages/Checkout";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import Support from "./pages/Support";
import BillingCanceled from "./pages/BillingCanceled";
import BillingSuccess from "./pages/BillingSuccess";
import { ProtectedRoute } from "./components/ProtectedRoute";
import PostStreamSummary from "./pages/PostStreamSummary";

import { clearAuthStorage } from "./lib/api";
import { clearMeCache } from "./lib/meCache";
import { clearPlatformFlagsCache } from "./lib/platformFlagsCache";
import { useFeatureAccess } from "./hooks/useFeatureAccess";
import { useEffectiveEntitlements } from "./hooks/useEffectiveEntitlements";


// Stripe/Billing pages
import SettingsBilling from "./pages/SettingsBilling";
import MyContentDisabled from "./pages/MyContentDisabled";


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
      clearAuthStorage();
      clearMeCache();
      clearPlatformFlagsCache();
      setShowUnauthorized(true);

      const path = window.location.pathname || "";
      if (path.startsWith("/login") || path.startsWith("/signup")) {
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
      <Route path="/learnmore" element={<LearnMore />} />

      <Route path="/admin/usage" element={<AdminUsage />} />
      {/* Public / auth flow */}
      <Route path="/" element={<Welcome />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/checkout" element={<Checkout />} />

      {/* Invite landing */}
      <Route path="/i/:inviteToken" element={<InviteLanding />} />
      {/* New guest invite flow (Firestore-backed) */}
      <Route path="/invite/:inviteId" element={<InviteRedeem />} />
      {/* Policy & Support */}
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/support" element={<Support />} />
      {/* Stripe Checkout return routes */}
      <Route path="/billing/canceled" element={<BillingCanceled />} />
      <Route path="/billing/success" element={<BillingSuccess />} />
      <Route path="/admin/dashboard" element={<AdminDashboard />} />
      {/* Streaming flow */}
      <Route path="/join" element={<Join />} />
      <Route
        path="/my-content"
        element={canMyContent && myContentTarget ? <Navigate to={myContentTarget} replace /> : <MyContentDisabled />}
      />
      <Route path="/room" element={<Room />} />
      <Route path="/room/:roomName" element={<Room />} />
      <Route path="/live" element={<Live />} />
      {/* New stable viewer URL: /live/:savedEmbedId */}
      <Route path="/live/:savedEmbedId" element={<Live />} />
      {/* Instagram-only viewer URL (fullscreen, minimal UI): /ig/:savedEmbedId */}
      <Route path="/ig/:savedEmbedId" element={<Live />} />
      <Route path="/settings/destinations" element={<SettingsDestinations />} />
      <Route path="/room-exit/:recordingId" element={<RoomExitPage />} />

      {/* Legacy: /stream-summary -> canonical /room-exit */}
      <Route path="/stream-summary/:recordingId" element={<LegacyStreamSummaryRedirect />} />
      <Route
        path="/editing/post-stream"
        element={<PostStreamSummary />}
      />
      
      {/* Thank You / Post-Stream */}
      <Route path="/thanks" element={<Navigate to="/room-exit/unknown" replace />} />

      {/* Blocked Editing Routes - Coming Soon */}
      <Route path="/edit" element={<EditorDisabled />} />
      <Route path="/edit/:id" element={<EditorDisabled />} />
      <Route path="/editor" element={<EditorDisabled />} />
      <Route path="/editor/:id" element={<EditorDisabled />} />

      {/* Segmented feature routes */}
      <Route
        path="/content"
        element={(canContentLibrary || canMyContentRecordings) ? <AssetLibrary /> : <Navigate to="/join" replace />}
      />
      <Route
        path="/projects"
        element={canProjects ? <ProjectsDashboard /> : <Navigate to="/join" replace />}
      />

      {/* Legacy aliases */}
      <Route
        path="/editing/assets"
        element={(canContentLibrary || canMyContentRecordings) ? <Navigate to="/content" replace /> : <Navigate to="/join" replace />}
      />
      <Route
        path="/editing/projects"
        element={canProjects ? <Navigate to="/projects" replace /> : <Navigate to="/join" replace />}
      />
      <Route
        path="/editing/editor/:projectId"
        element={canEditor ? <EditorPage /> : <EditorDisabled />}
      />
      <Route
        path="/editing/export/:projectId"
        element={canEditor ? <RenderAndUploadPage /> : <EditorDisabled />}
      />

      {/* Stripe/Billing routes */}
      <Route path="/settings/billing" element={<SettingsBilling />} />
      <Route path="/pricing/explainer" element={<PricingExplainerPage />} />
      
      </Routes>
    </>
  );
}
function LegacyStreamSummaryRedirect() {
  const { recordingId } = useParams<{ recordingId: string }>();
  const target = recordingId ? `/room-exit/${encodeURIComponent(recordingId)}` : '/room-exit/unknown';
  return <Navigate to={target} replace state={{ exitRole: 'host' }} />;
}

export default App;