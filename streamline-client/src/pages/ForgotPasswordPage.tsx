import React, { useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { apiFetch, clearAuthStorage } from "../lib/api";
import { RecoveryMethod } from "../lib/accountRecovery";
import { firebaseSignInWithCustomToken, isFirebaseWebConfigured } from "../lib/firebaseClient";
import { refreshAndPersistAccountMe } from "../lib/sessionUser";

type CheckResponse = {
  canReset?: boolean;
  message?: string;
  method?: RecoveryMethod;
  availableMethods?: RecoveryMethod[];
  recoveryQuestion?: {
    id: string;
    text: string;
  } | null;
};

export const ForgotPasswordPage: React.FC = () => {
  const nav = useNavigate();
  const location = useLocation();
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
  const [step, setStep] = useState<"lookup" | "reset">("lookup");
  const [availableMethods, setAvailableMethods] = useState<RecoveryMethod[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<RecoveryMethod | null>(null);
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
      if (!res.ok) {
        setError("Password reset check failed. Try again.");
        setLoading(false);
        return;
      }

      if (data.canReset) {
        const methods = Array.isArray(data.availableMethods) ? data.availableMethods : [];
        setStep("reset");
        setAvailableMethods(methods);
        setSelectedMethod((data.method as RecoveryMethod) || methods[0] || null);
        setRecoveryQuestion(data.recoveryQuestion || null);
        setMessage(data.message || "Reset enabled. Choose a new password.");
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
          }),
        },
        { allowNonOk: true }
      );

      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        setError(String(data?.error || "Password reset failed."));
        setLoading(false);
        return;
      }

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
    } catch (err) {
      console.error(err);
      setError("Password reset failed. Try again.");
      setLoading(false);
    }
  };

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
          <h1 style={{ fontSize: 30, margin: 0, marginBottom: 10 }}>Forgot Password</h1>
          <p style={{ color: "#a3a3a3", margin: 0, lineHeight: 1.5 }}>
            {step === "lookup"
                ? "Enter your login identifier. If reset options are available for your account, you can recover access here without email."
                : "Verify your identity, then choose your new password. Admin-enabled resets still require recovery setup immediately afterward."}
          </p>
        </div>

        <form onSubmit={step === "lookup" ? handleCheck : handleReset}>
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

              <label style={{ display: "block", fontSize: 13, color: "#d4d4d4", marginTop: 18, marginBottom: 8 }}>
                New password
              </label>
              <input
                type="password"
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
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Re-enter password"
                disabled={loading}
                style={inputStyle}
              />
            </>
          )}

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

          <button type="submit" disabled={loading} style={primaryButtonStyle}>
            {loading ? "Please wait..." : step === "lookup" ? "Continue" : "Set New Password"}
          </button>
        </form>
      </div>
    </div>
  );
};

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