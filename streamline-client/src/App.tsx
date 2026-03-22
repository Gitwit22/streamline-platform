import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import Support from "./pages/Support";
import BillingCanceled from "./pages/BillingCanceled";
import BillingSuccess from "./pages/BillingSuccess";
import PpvViewer from "./pages/PpvViewer";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { creatorRoutes } from "./creator/routes";

import { clearAuthStorage } from "./lib/api";
import { clearMeCache } from "./lib/meCache";
import { clearPlatformFlagsCache } from "./lib/platformFlagsCache";
import { useFeatureAccess } from "./hooks/useFeatureAccess";
import { useEffectiveEntitlements } from "./hooks/useEffectiveEntitlements";
import { cleanTrackingParams } from "./lib/cleanTrackingParams";


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
  const canMonetization = !!access?.monetization?.allowed;

  const myContentTarget = (canContentLibrary || canMyContentRecordings)
    ? "/content"
    : null;

  useEffect(() => {
    // Strip tracking parameters (fbclid, utm_*, etc.) that social platforms
    // and email clients append when users click shared invite links.
    cleanTrackingParams();
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      const path = window.location.pathname || "";

      // ── Public / auth pages: suppress ALL side-effects ──────────────
      // These pages don't require auth, so a 401 is expected and
      // must NOT clear tokens or flash the "Session expired" banner —
      // otherwise we race with a freshly-stored login token.
      if (
        path.startsWith("/login") || path.startsWith("/signup") ||
        path === "/welcome" || path === "/" ||
        path.startsWith("/privacy") || path.startsWith("/terms") ||
        path.startsWith("/support") || path.startsWith("/learnmore") ||
        path.startsWith("/i/") || path.startsWith("/invite/") ||
        path.startsWith("/billing/") || path.startsWith("/ppv/")
      ) {
        return;
      }

      // ── Invite join flow: suppress banner when arriving via invite ──
      // /join?t=<token> is a guest invite entry-point — a 401 is expected
      // because the participant has no account yet.
      if (path.startsWith("/join")) {
        const sp = new URLSearchParams(window.location.search);
        if (sp.has("t") || sp.has("inviteToken") || sp.has("room")) {
          return;
        }
      }

      // ── Guest detection: suppress banner for guest sessions ─────────
      // Guests who joined via an invite link have a guest session token
      // but no account. A 401 on auth endpoints is expected for them and
      // should not trigger the "Session expired" banner.
      if (path.startsWith("/room") || path.startsWith("/join") || path.startsWith("/live") || path.startsWith("/ig/")) {
        const sp = new URLSearchParams(window.location.search);
        const hasGuestToken = sp.has("gst");
        let hasStoredGuestSession = false;
        try {
          hasStoredGuestSession = !!localStorage.getItem("sl_guestSessionToken");
        } catch { /* ignore */ }
        if (hasGuestToken || hasStoredGuestSession) {
          // Guest user — do not show "Session expired" banner
          return;
        }

        // Authenticated user whose session expired — show banner but do NOT redirect.
        // The Room page manages its own `needsReauth` state and shows an
        // in-room re-auth prompt. Clearing storage here would destroy
        // the room-access-token and force-boot the user.
        setShowUnauthorized(true);
        return;
      }

      // ── Protected pages: full logout + redirect ─────────────────────
      clearAuthStorage();
      clearMeCache();
      clearPlatformFlagsCache();
      setShowUnauthorized(true);

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
      {/* Redirect legacy lane paths to creator welcome */}
      <Route path="/streamline/corporate/*" element={<Navigate to="/welcome" replace />} />
      <Route path="/streamline/edu/*" element={<Navigate to="/welcome" replace />} />
      <Route path="/demo" element={<Navigate to="/welcome" replace />} />

      {/* Public / auth flow */}
      <Route path="/" element={<Navigate to="/welcome" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/support" element={<Support />} />
      <Route path="/billing/canceled" element={<BillingCanceled />} />
      <Route path="/billing/success" element={<BillingSuccess />} />

      {/* PPV viewer (public, no auth required) */}
      <Route path="/ppv/:eventId" element={<PpvViewer />} />

      {/* Creator lane */}
      {creatorRoutes({ canContentLibrary, canMyContentRecordings, canProjects, canEditor, canMyContent, canMonetization, myContentTarget })}

      </Routes>
    </>
  );
}

export default App;