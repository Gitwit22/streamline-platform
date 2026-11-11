import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, hasAuthSession } from "../lib/api";
import { clearMeCache } from "../lib/meCache";

type Status = "verifying" | "verified" | "failed";

/** Token from an emailed /verify-email#token=… link (read only; no side effects). */
function readVerifyTokenFromUrl(): string | null {
  try {
    const token = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token");
    return token && token.trim() ? token.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Landing page for the "Confirm your email" link. Public: the link may be
 * opened on a device that isn't signed in. The token is redeemed once, by
 * POST, so link-preview scanners that only GET the page can't consume it.
 */
export const VerifyEmailPage: React.FC = () => {
  const nav = useNavigate();
  const [token] = useState<string | null>(() => readVerifyTokenFromUrl());
  const [status, setStatus] = useState<Status>(token ? "verifying" : "failed");
  const [error, setError] = useState(
    token ? "" : "This confirmation link is incomplete. Open the link from your email again."
  );
  const [signedIn, setSignedIn] = useState(false);
  // Effects run twice in React StrictMode (dev); the token must be redeemed once.
  const submitted = useRef(false);

  useEffect(() => {
    // Drop the token from the address bar so it doesn't linger in history.
    if (window.location.hash) {
      try {
        window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      } catch {
        // ignore
      }
    }
    hasAuthSession()
      .then(setSignedIn)
      .catch(() => setSignedIn(false));
  }, []);

  useEffect(() => {
    if (!token || submitted.current) return;
    submitted.current = true;

    (async () => {
      try {
        const res = await apiFetch(
          "/api/auth/verify-email",
          { method: "POST", body: JSON.stringify({ token }) },
          { allowNonOk: true }
        );
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.ok) {
          // /me now reports emailVerified: true; drop the cached copy.
          clearMeCache();
          try {
            window.dispatchEvent(new CustomEvent("sl:email-verified"));
          } catch {
            // ignore
          }
          setStatus("verified");
          return;
        }
        setError(
          res.status === 429
            ? "Too many attempts. Please wait a few minutes and try again."
            : String(data?.error || "This confirmation link is invalid or has expired.")
        );
        setStatus("failed");
      } catch {
        setError("We couldn't confirm your email. Check your connection and try again.");
        setStatus("failed");
      }
    })();
  }, [token]);

  const title =
    status === "verifying" ? "Confirming your email…" : status === "verified" ? "Email confirmed" : "Couldn't confirm email";

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <h1 style={{ fontSize: 28, margin: 0, marginBottom: 12 }}>{title}</h1>
        {status === "verified" && (
          <p style={{ color: "#bbf7d0", margin: 0, lineHeight: 1.5 }}>Thanks — your email address is confirmed.</p>
        )}
        {status === "failed" && (
          <p role="alert" style={{ color: "#fecaca", margin: 0, lineHeight: 1.5 }}>
            {error}
            {signedIn ? " You can send a new link from the reminder in the app." : " Sign in to send a new link."}
          </p>
        )}
        {status !== "verifying" && (
          <button type="button" style={buttonStyle} onClick={() => nav(signedIn ? "/join" : "/login")}>
            {signedIn ? "Continue" : "Go to Sign In"}
          </button>
        )}
      </div>
    </div>
  );
};

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background:
    "radial-gradient(circle at top, rgba(220,38,38,0.18), transparent 42%), linear-gradient(180deg, #080808 0%, #161616 100%)",
  color: "#fff",
  padding: "32px 20px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 480,
  background: "rgba(12, 12, 12, 0.84)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 24,
  padding: 32,
  boxShadow: "0 30px 80px rgba(0,0,0,0.38)",
};

const buttonStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 22,
  padding: "15px 16px",
  background: "linear-gradient(90deg, #dc2626 0%, #f97316 100%)",
  color: "#fff",
  border: "none",
  borderRadius: 14,
  fontWeight: 700,
  fontSize: 15,
  cursor: "pointer",
};

export default VerifyEmailPage;
