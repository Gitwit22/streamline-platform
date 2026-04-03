import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetchAuth } from "../lib/api";
import { SECURITY_QUESTIONS, normalizeEmergencyCode } from "../lib/accountRecovery";
import { refreshAndPersistAccountMe } from "../lib/sessionUser";
import { useAuthMe } from "../hooks/useAuthMe";

export const RecoverySetupPage: React.FC = () => {
  const nav = useNavigate();
  const location = useLocation();
  const { user, loading } = useAuthMe();
  const [questionId, setQuestionId] = useState("");
  const [answer, setAnswer] = useState("");
  const [emergencyCode, setEmergencyCode] = useState("");
  const [confirmEmergencyCode, setConfirmEmergencyCode] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const nextPath = useMemo(() => {
    try {
      const sp = new URLSearchParams(location.search || "");
      const next = sp.get("next") || "";
      if (next.startsWith("/") && !next.startsWith("//") && next !== "/account-recovery/setup") {
        return next;
      }
    } catch {
      // ignore
    }
    return "/join";
  }, [location.search]);

  useEffect(() => {
    if (!loading && !user) {
      nav("/login?next=/account-recovery/setup", { replace: true });
    }
  }, [loading, nav, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    try {
      const res = await apiFetchAuth(
        "/api/auth/recovery/setup",
        {
          method: "POST",
          body: JSON.stringify({
            questionId,
            answer,
            emergencyCode,
            confirmEmergencyCode,
          }),
        },
        { allowNonOk: true }
      );

      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        setError(String(data?.error || "Failed to save recovery settings."));
        setSaving(false);
        return;
      }

      await refreshAndPersistAccountMe();
      try {
        window.dispatchEvent(new CustomEvent("sl:auth-changed"));
      } catch {
        // ignore
      }
      window.location.assign(nextPath);
    } catch (err) {
      console.error(err);
      setError("Failed to save recovery settings.");
      setSaving(false);
    }
  };

  if (loading || !user) {
    return null;
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #0b0b0b 0%, #151515 100%)",
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
          maxWidth: 560,
          padding: 32,
          borderRadius: 28,
          background: "linear-gradient(180deg, rgba(32,32,32,0.96) 0%, rgba(16,16,16,0.96) 100%)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 30px 100px rgba(0,0,0,0.4)",
        }}
      >
        <div style={{ marginBottom: 26 }}>
          <div style={{ color: "#fdba74", fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 12 }}>
            Required Before App Access
          </div>
          <h1 style={{ margin: 0, fontSize: 32, marginBottom: 10 }}>Set Up Account Recovery</h1>
          <p style={{ margin: 0, color: "#b3b3b3", lineHeight: 1.6 }}>
            Choose one security question and create a 6-digit emergency recovery code. This is required before you can continue using StreamLine.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Security question</label>
          <select value={questionId} onChange={(event) => setQuestionId(event.target.value)} style={fieldStyle}>
            <option value="">Select a question</option>
            {SECURITY_QUESTIONS.map((question) => (
              <option key={question.id} value={question.id}>
                {question.text}
              </option>
            ))}
          </select>

          <label style={{ ...labelStyle, marginTop: 18 }}>Answer</label>
          <input
            type="text"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="Enter your answer"
            style={fieldStyle}
          />

          <label style={{ ...labelStyle, marginTop: 18 }}>Emergency recovery code</label>
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={emergencyCode}
            onChange={(event) => setEmergencyCode(normalizeEmergencyCode(event.target.value).slice(0, 6))}
            placeholder="6 digits"
            style={fieldStyle}
          />

          <label style={{ ...labelStyle, marginTop: 18 }}>Confirm emergency recovery code</label>
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={confirmEmergencyCode}
            onChange={(event) => setConfirmEmergencyCode(normalizeEmergencyCode(event.target.value).slice(0, 6))}
            placeholder="Re-enter 6 digits"
            style={fieldStyle}
          />

          {error && (
            <div
              style={{
                marginTop: 18,
                padding: "12px 14px",
                borderRadius: 14,
                background: "rgba(127,29,29,0.45)",
                border: "1px solid rgba(248,113,113,0.35)",
                color: "#fecaca",
                fontSize: 14,
              }}
            >
              {error}
            </div>
          )}

          <button type="submit" disabled={saving} style={submitStyle}>
            {saving ? "Saving..." : "Save and Continue"}
          </button>
        </form>
      </div>
    </div>
  );
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  color: "#d4d4d4",
  marginBottom: 8,
};

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "14px 16px",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.04)",
  color: "#fff",
  fontSize: 15,
  outline: "none",
};

const submitStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 24,
  padding: "15px 16px",
  border: "none",
  borderRadius: 14,
  background: "linear-gradient(90deg, #ea580c 0%, #dc2626 100%)",
  color: "#fff",
  fontSize: 15,
  fontWeight: 700,
  cursor: "pointer",
};

export default RecoverySetupPage;