import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { apiFetchAuth, hasAuthSession } from "../lib/api";
import { getMeCached } from "../lib/meCache";

const DISMISS_KEY = "sl_emailVerifyReminderDismissed";

/**
 * Pages where a small corner reminder is safe. Never the live studio, viewer
 * or editor pages, where it could cover controls mid-broadcast.
 */
const SHOW_ON = ["/join", "/settings", "/content", "/projects"];

function isDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * "Confirm your email" reminder for signed-in users whose address isn't
 * confirmed yet. Informational only: nothing is gated on verification.
 */
export const EmailVerifyReminder: React.FC = () => {
  const location = useLocation();
  const [visible, setVisible] = useState(false);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState("");

  const onAllowedPage = SHOW_ON.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`));

  useEffect(() => {
    if (!onAllowedPage || isDismissed()) return;
    let cancelled = false;
    (async () => {
      try {
        if (!(await hasAuthSession())) return;
        const me = await getMeCached();
        if (cancelled) return;
        // Strict `=== false`: an older server that doesn't send the field shows nothing.
        setVisible(!!me && !!me.email && me.emailVerified === false && me.emailDeliveryAvailable === true);
      } catch {
        // A reminder is never worth an error state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onAllowedPage, location.pathname]);

  useEffect(() => {
    const onVerified = () => setVisible(false);
    window.addEventListener("sl:email-verified", onVerified);
    return () => window.removeEventListener("sl:email-verified", onVerified);
  }, []);

  if (!visible || !onAllowedPage) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
    setVisible(false);
  };

  const resend = async () => {
    setSending(true);
    setNote("");
    try {
      const res = await apiFetchAuth(
        "/api/auth/verify-email/resend",
        { method: "POST", body: JSON.stringify({}) },
        { allowNonOk: true, suppressAuthSideEffects: true }
      );
      const data = (await res.json().catch(() => ({}))) as { alreadyVerified?: boolean; sentTo?: string; message?: string };
      if (res.ok && data?.alreadyVerified) {
        setVisible(false);
        return;
      }
      if (res.ok) {
        setNote(`Sent to ${data?.sentTo || "your email"}. Check your inbox and spam folder.`);
        return;
      }
      setNote(
        res.status === 429
          ? "You've requested a few links already. Try again later."
          : String(data?.message || "We couldn't send the email. Try again in a few minutes.")
      );
    } catch {
      setNote("We couldn't send the email. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div role="status" style={cardStyle}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Confirm your email</div>
      <div style={{ color: "#d4d4d4", lineHeight: 1.45 }}>
        We sent you a link when you signed up. Confirming lets you reset your password by email.
      </div>
      {note && <div style={{ marginTop: 8, color: "#fde68a" }}>{note}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button type="button" onClick={resend} disabled={sending} style={primaryStyle}>
          {sending ? "Sending…" : "Resend link"}
        </button>
        <button type="button" onClick={dismiss} style={secondaryStyle}>
          Not now
        </button>
      </div>
    </div>
  );
};

const cardStyle: React.CSSProperties = {
  position: "fixed",
  right: 16,
  bottom: 16,
  left: "auto",
  zIndex: 9000,
  width: "min(360px, calc(100vw - 32px))",
  padding: "14px 16px",
  borderRadius: 14,
  background: "rgba(17, 17, 17, 0.96)",
  border: "1px solid rgba(249,115,22,0.45)",
  boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
  color: "#fff",
  fontSize: 13,
};

const primaryStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "none",
  background: "linear-gradient(90deg, #dc2626 0%, #f97316 100%)",
  color: "#fff",
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "transparent",
  color: "#fff",
  cursor: "pointer",
};

export default EmailVerifyReminder;
