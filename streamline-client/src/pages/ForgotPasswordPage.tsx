import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { apiFetch, clearAuthStorage } from "../lib/api";
import { RecoveryMethod } from "../lib/accountRecovery";
import { firebaseSignInWithCustomToken, isFirebaseWebConfigured } from "../lib/firebaseClient";
import { refreshAndPersistAccountMe } from "../lib/sessionUser";

type CheckResponse = {
  canReset?: boolean;
  message?: string;
  method?: RecoveryMethod | null;
  availableMethods?: RecoveryMethod[];
  recoveryQuestion?: {
    id: string;
    text: string;
  } | null;
  /** Server can email a reset link (config-level; same for every login). */
  emailResetAvailable?: boolean;
};

/** Body of a successful (or failed) reset / reset-email request. */
type ResetResponse = {
  token?: string;
  customToken?: string | null;
  requiresRecoverySetup?: boolean;
  error?: string;
  message?: string;
};

/** "email" = ask the server to send a reset link (not a server-side recovery method). */
type UiMethod = RecoveryMethod | "email";

/** One-time token from an emailed /reset-password#token=… link (read only; no side effects). */
function readResetTokenFromUrl(): string | null {
  try {
    if (!window.location.pathname.startsWith("/reset-password")) return null;
    const token = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token");
    return token && token.trim() ? token.trim() : null;
  } catch {
    return null;
  }
}

export const ForgotPasswordPage: React.FC = () => {
  const nav = useNavigate();
  const location = useLocation();
  const isLinkMode = location.pathname.startsWith("/reset-password");
  const [linkToken] = useState<string | null>(() => readResetTokenFromUrl());

  // Drop the token from the address bar so it doesn't linger in history or screenshots.
  useEffect(() => {
    if (!isLinkMode || !window.location.hash) return;
    try {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    } catch {
      // ignore
    }
  }, [isLinkMode]);
  const [emailSent, setEmailSent] = useState(false);
  const [login, setLogin] = useState(() => {
    try {
      return new URLSearchParams(location.search).get("login") || "";
    } catch {
      return "";
    }
  });
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [answer, setAnswer] = useState("");
  const [emergencyCode, setEmergencyCode] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [step, setStep] = useState<"lookup" | "reset">("lookup");
  const [availableMethods, setAvailableMethods] = useState<UiMethod[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<UiMethod | null>(null);
  const [recoveryQuestion, setRecoveryQuestion] = useState<CheckResponse["recoveryQuestion"]>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const loginLabel = useMemo(() => "Email address", []);

  const handleCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const res = await apiFetch(
        "/api/auth/forgot-password/check",
        {
          method: "POST",
          body: JSON.stringify({ login }),
        },
        { allowNonOk: true }
      );
      const data = (await res.json().catch(() => ({}))) as CheckResponse;
      if (res.status === 429) {
        setError(rateLimitedMessage(res));
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError("Password reset check failed. Try again.");
        setLoading(false);
        return;
      }

      const emailOk = data.emailResetAvailable === true;
      setEmailSent(false);

      if (data.canReset) {
        const serverMethods = Array.isArray(data.availableMethods) ? data.availableMethods : [];
        const methods: UiMethod[] = emailOk ? [...serverMethods, "email"] : serverMethods;
        setStep("reset");
        setAvailableMethods(methods);
        setSelectedMethod((data.method as RecoveryMethod) || methods[0] || null);
        setRecoveryQuestion(data.recoveryQuestion || null);
        setMessage(data.message || "Reset enabled. Choose a new password.");
      } else if (emailOk) {
        setStep("reset");
        setAvailableMethods(["email"]);
        setSelectedMethod("email");
        setRecoveryQuestion(null);
        setMessage(data.message || "We can email you a link to reset your password.");
      } else {
        setAvailableMethods([]);
        setSelectedMethod(null);
        setRecoveryQuestion(null);
        setMessage(data.message || "Password reset is not currently available. Contact your administrator.");
      }
    } catch (err) {
      console.error(err);
      setError("Password reset check failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      clearAuthStorage();

      const res = await apiFetch(
        "/api/auth/forgot-password/reset",
        {
          method: "POST",
          body: JSON.stringify({
            login,
            method: selectedMethod,
            newPassword,
            confirmPassword,
            answer,
            emergencyCode,
            resetCode: selectedMethod === "admin" ? resetCode : undefined,
          }),
        },
        { allowNonOk: true }
      );

      const data = await res.json().catch(() => ({} as any));
      if (res.status === 429 && data?.error === "rate_limited") {
        setError(rateLimitedMessage(res));
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError(String(data?.error || "Password reset failed."));
        setLoading(false);
        return;
      }

      await finishSignIn(data);
    } catch (err) {
      console.error(err);
      setError("Password reset failed. Try again.");
      setLoading(false);
    }
  };

  /** Ask the server to email a reset link (same answer whether or not the account exists). */
  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const res = await apiFetch(
        "/api/auth/forgot-password/email",
        { method: "POST", body: JSON.stringify({ login }) },
        { allowNonOk: true }
      );
      const data = (await res.json().catch(() => ({}))) as ResetResponse;
      if (res.status === 429) {
        setError(rateLimitedMessage(res));
        return;
      }
      if (!res.ok) {
        setError(String(data?.message || data?.error || "We couldn't send the reset email. Try again."));
        return;
      }
      setEmailSent(true);
      setMessage(String(data?.message || "If an account exists for that email, we've sent a reset link."));
    } catch (err) {
      console.error(err);
      setError("We couldn't send the reset email. Try again.");
    } finally {
      setLoading(false);
    }
  };

  /** Redeem the emailed link: set the new password and sign in. */
  const handleLinkReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkToken) return;
    setLoading(true);
    setError("");
    setMessage("");

    try {
      clearAuthStorage();

      const res = await apiFetch(
        "/api/auth/reset-password/email",
        {
          method: "POST",
          body: JSON.stringify({ token: linkToken, newPassword, confirmPassword }),
        },
        { allowNonOk: true }
      );
      const data = (await res.json().catch(() => ({}))) as ResetResponse;
      if (res.status === 429) {
        setError(rateLimitedMessage(res));
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError(String(data?.error || "Password reset failed."));
        setLoading(false);
        return;
      }

      await finishSignIn(data);
    } catch (err) {
      console.error(err);
      setError("Password reset failed. Try again.");
      setLoading(false);
    }
  };

  /** Store the session returned by a successful reset and continue into the app. */
  const finishSignIn = async (data: ResetResponse) => {
    if (data?.token) {
      localStorage.setItem("authToken", data.token);
    }
    if (typeof document !== "undefined" && data?.token) {
      document.cookie = `token=${data.token}; path=/; max-age=${60 * 60 * 24 * 7}`;
    }

    if (data?.customToken && isFirebaseWebConfigured()) {
      try {
        await firebaseSignInWithCustomToken(String(data.customToken));
      } catch (err) {
        console.warn("[ForgotPassword] Firebase custom-token sign-in failed", err);
      }
    }

    try {
      await refreshAndPersistAccountMe();
    } catch (err) {
      console.warn("[ForgotPassword] Failed to refresh /api/account/me after reset", err);
      try {
        localStorage.removeItem("sl_user");
        localStorage.removeItem("sl_userId");
      } catch {
        // ignore
      }
    }

    try {
      window.dispatchEvent(new CustomEvent("sl:auth-changed"));
    } catch {
      // ignore
    }

    if (data?.requiresRecoverySetup) {
      window.location.assign("/account-recovery/setup?source=reset");
      return;
    }

    window.location.assign("/join");
  };

  const passwordFields = (
    <>
      <label style={{ display: "block", fontSize: 13, color: "#d4d4d4", marginTop: 18, marginBottom: 8 }}>
        New password
      </label>
      <input
        type="password"
        autoComplete="new-password"
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        placeholder="At least 6 characters"
        disabled={loading}
        style={inputStyle}
      />

      <label style={{ display: "block", fontSize: 13, color: "#d4d4d4", marginTop: 18, marginBottom: 8 }}>
        Confirm new password
      </label>
      <input
        type="password"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        placeholder="Re-enter password"
        disabled={loading}
        style={inputStyle}
      />
    </>
  );

  const onlyEmail = availableMethods.length === 1 && availableMethods[0] === "email";
  const description = isLinkMode
    ? "Choose a new password for your account. This link works once."
    : step === "lookup"
      ? "Enter your account email to see how you can reset your password."
      : onlyEmail
        ? "We'll email you a link to choose a new password."
        : "Verify your identity, then choose your new password. Admin-enabled resets still require recovery setup immediately afterward.";
  const onSubmit = isLinkMode
    ? handleLinkReset
    : step === "lookup"
      ? handleCheck
      : selectedMethod === "email"
        ? handleSendEmail
        : handleReset;
  const submitLabel = loading
    ? "Please wait..."
    : isLinkMode
      ? "Set New Password"
      : step === "lookup"
        ? "Continue"
        : selectedMethod === "email"
          ? emailSent
            ? "Send Again"
            : "Email Me a Reset Link"
          : "Set New Password";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at top, rgba(220,38,38,0.18), transparent 42%), linear-gradient(180deg, #080808 0%, #161616 100%)",
        color: "#fff",
        padding: "32px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 480,
          background: "rgba(12, 12, 12, 0.84)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 24,
          padding: 32,
          boxShadow: "0 30px 80px rgba(0,0,0,0.38)",
        }}
      >
        <div style={{ marginBottom: 24 }}>
          <button
            type="button"
            onClick={() => nav("/login")}
            style={{
              border: "none",
              background: "transparent",
              color: "#fca5a5",
              cursor: "pointer",
              padding: 0,
              marginBottom: 18,
            }}
          >
            Back to sign in
          </button>
          <h1 style={{ fontSize: 30, margin: 0, marginBottom: 10 }}>
            {isLinkMode ? "Choose a New Password" : "Forgot Password"}
          </h1>
          <p style={{ color: "#a3a3a3", margin: 0, lineHeight: 1.5 }}>{description}</p>
        </div>

        <form onSubmit={onSubmit}>
          {!isLinkMode && (
            <>
              <label style={{ display: "block", fontSize: 13, color: "#d4d4d4", marginBottom: 8 }}>
                {loginLabel}
              </label>
              <input
                type="email"
                value={login}
                onChange={(event) => setLogin(event.target.value)}
                placeholder="you@example.com"
                disabled={loading || step === "reset"}
                style={inputStyle}
              />
            </>
          )}

          {isLinkMode && !linkToken && (
            <div style={{ ...infoBoxStyle, color: "#fecaca", border: "1px solid rgba(248,113,113,0.35)" }}>
              This reset link is incomplete. Open the link from your email again, or request a new one.
            </div>
          )}

          {step === "reset" && (
            <>
              {availableMethods.length > 1 && (
                <div style={{ marginTop: 18 }}>
                  <div style={{ display: "block", fontSize: 13, color: "#d4d4d4", marginBottom: 10 }}>
                    Recovery method
                  </div>
                  <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
                    {availableMethods.map((method) => (
                      <button
                        key={method}
                        type="button"
                        onClick={() => setSelectedMethod(method)}
                        style={{
                          padding: "12px 14px",
                          borderRadius: 14,
                          border:
                            selectedMethod === method
                              ? "1px solid rgba(249,115,22,0.7)"
                              : "1px solid rgba(255,255,255,0.08)",
                          background:
                            selectedMethod === method
                              ? "rgba(249,115,22,0.14)"
                              : "rgba(255,255,255,0.03)",
                          color: "#fff",
                          cursor: "pointer",
                          textTransform: "capitalize",
                        }}
                      >
                        {method === "code"
                          ? "Emergency Code"
                          : method === "question"
                            ? "Security Question"
                            : method === "email"
                              ? "Email Link"
                              : "Admin Reset"}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {selectedMethod === "question" && recoveryQuestion && (
                <>
                  <div
                    style={{
                      marginTop: 18,
                      padding: "12px 14px",
                      borderRadius: 14,
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      color: "#e5e5e5",
                      lineHeight: 1.5,
                    }}
                  >
                    {recoveryQuestion.text}
                  </div>
                  <label style={{ display: "block", fontSize: 13, color: "#d4d4d4", marginTop: 18, marginBottom: 8 }}>
                    Security answer
                  </label>
                  <input
                    type="text"
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    placeholder="Enter your answer"
                    disabled={loading}
                    style={inputStyle}
                  />
                </>
              )}

              {selectedMethod === "admin" && (
                <>
                  <label style={{ display: "block", fontSize: 13, color: "#d4d4d4", marginTop: 18, marginBottom: 8 }}>
                    Reset code from your administrator
                  </label>
                  <input
                    type="text"
                    autoComplete="one-time-code"
                    autoCapitalize="characters"
                    spellCheck={false}
                    value={resetCode}
                    onChange={(event) => setResetCode(event.target.value)}
                    placeholder="XXXXX-XXXXX"
                    disabled={loading}
                    style={{ ...inputStyle, letterSpacing: "0.08em", fontFamily: "monospace" }}
                  />
                </>
              )}

              {selectedMethod === "code" && (
                <>
                  <label style={{ display: "block", fontSize: 13, color: "#d4d4d4", marginTop: 18, marginBottom: 8 }}>
                    Emergency recovery code
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    value={emergencyCode}
                    onChange={(event) => setEmergencyCode(event.target.value)}
                    placeholder="Enter your 6-digit code"
                    disabled={loading}
                    style={inputStyle}
                  />
                </>
              )}

              {selectedMethod === "email" && (
                <div style={infoBoxStyle}>
                  {emailSent
                    ? "Open the link in the email to choose a new password. Didn't get it? Check spam, or send it again."
                    : "We'll email a one-time link to this address. It expires in 60 minutes."}
                </div>
              )}

              {selectedMethod !== "email" && passwordFields}
            </>
          )}

          {isLinkMode && linkToken && passwordFields}

          {(error || message) && (
            <div
              style={{
                marginTop: 18,
                padding: "12px 14px",
                borderRadius: 14,
                background: error ? "rgba(127, 29, 29, 0.45)" : "rgba(20, 83, 45, 0.35)",
                border: error ? "1px solid rgba(248,113,113,0.35)" : "1px solid rgba(74,222,128,0.25)",
                color: error ? "#fecaca" : "#bbf7d0",
                fontSize: 14,
                lineHeight: 1.5,
              }}
            >
              {error || message}
            </div>
          )}

          {isLinkMode && !linkToken ? (
            <button type="button" onClick={() => nav("/forgot-password")} style={primaryButtonStyle}>
              Request a New Link
            </button>
          ) : (
            <button type="submit" disabled={loading} style={primaryButtonStyle}>
              {submitLabel}
            </button>
          )}
        </form>
      </div>
    </div>
  );
};

function rateLimitedMessage(res: Response): string {
  const seconds = Number(res.headers.get("Retry-After") || "");
  if (Number.isFinite(seconds) && seconds > 0) {
    const minutes = Math.ceil(seconds / 60);
    return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }
  return "Too many attempts. Please wait a few minutes and try again.";
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "14px 16px",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 14,
  color: "#fff",
  fontSize: 15,
  outline: "none",
};

const infoBoxStyle: React.CSSProperties = {
  marginTop: 18,
  padding: "12px 14px",
  borderRadius: 14,
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  color: "#e5e5e5",
  lineHeight: 1.5,
  fontSize: 14,
};

const primaryButtonStyle: React.CSSProperties = {
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

export default ForgotPasswordPage;