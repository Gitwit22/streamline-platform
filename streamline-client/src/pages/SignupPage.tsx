import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { API_BASE } from "../services/apiBase";
import { apiFetchAuth } from "../lib/api";

// Email validation function
function validateEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

export const SignupPage = () => {
  const nav = useNavigate();
  const location = useLocation();

  const nextUrl = (() => {
    try {
      const sp = new URLSearchParams(location.search || "");
      const next = sp.get("next") || "";
      if (!next || typeof next !== "string") return null;
      if (!next.startsWith("/")) return null;
      if (next.startsWith("//")) return null;
      return next;
    } catch {
      return null;
    }
  })();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [timeZone, setTimeZone] = useState("");

  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setTimeZone(tz || "");
    } catch {
      // ignore
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!validateEmail(email)) {
      setError("Please enter a valid email address.");
      setLoading(false);
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      setLoading(false);
      return;
    }

    if (!termsAccepted) {
      setError("You must agree to the Terms of Service to create an account.");
      setLoading(false);
      return;
    }

    try {
      const body: Record<string, unknown> = {
        displayName: displayName.trim(),
        email: email.trim().toLowerCase(),
        password,
        timeZone: timeZone || "America/Chicago",
        tosAccepted: true,
      };

      const res = await fetch(`${API_BASE}/api/auth/signup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Signup failed");
        setLoading(false);
        return;
      }

      if (!data?.token) {
        setError("Signup failed: missing token from server");
        setLoading(false);
        return;
      }

      // Store user data and token in localStorage
      localStorage.setItem("sl_user", JSON.stringify(data.user));
      localStorage.setItem("authToken", data.token);
      localStorage.setItem("sl_userId", data.user.id || data.user.uid);
      localStorage.setItem("sl_displayName", data.user.displayName);

      // Notify hooks (useEffectiveEntitlements) that auth state changed
      try {
        window.dispatchEvent(new CustomEvent("sl:auth-changed"));
      } catch {}

      // Fallback: Set JWT as a non-httpOnly cookie for backend auth (for local dev)
      if (typeof document !== "undefined" && data.token) {
        document.cookie = `token=${data.token}; path=/; max-age=${60 * 60 * 24 * 7}`;
      }

      // Initialize canonical account document with plan + stream defaults.
      try {
        await apiFetchAuth("/api/account/init", { method: "POST" });
      } catch (initErr) {
        console.warn("[Signup] account init failed", initErr);
      }

      // Redirect to next URL or dashboard
      nav(nextUrl || "/");
    } catch (err) {
      console.error("Signup error:", err);
      setError("An unexpected error occurred. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem 1rem",
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)",
        color: "#ffffff",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Background decoration */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at 50% 0%, rgba(220, 38, 38, 0.1) 0%, transparent 50%)",
          pointerEvents: "none",
        }}
      />

      <form
        onSubmit={handleSubmit}
        style={{
          width: "100%",
          maxWidth: "420px",
          display: "flex",
          flexDirection: "column",
          gap: "1.25rem",
          background: "rgba(15, 23, 42, 0.8)",
          padding: "2rem",
          borderRadius: "1rem",
          border: "1px solid rgba(248, 113, 113, 0.2)",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
          backdropFilter: "blur(20px)",
          position: "relative",
          zIndex: 1,
        }}
      >
        <h2
          style={{
            fontSize: "1.75rem",
            fontWeight: "700",
            textAlign: "center",
            marginBottom: "0.5rem",
            background: "linear-gradient(135deg, #ffffff, #f87171)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Create your account
        </h2>

        {/* Account info fields */}
        <div>
          <h3
            style={{
              fontSize: "1.125rem",
              fontWeight: "600",
              marginBottom: "0.75rem",
              color: "#dc2626",
            }}
          >
            Account Info
          </h3>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div>
              <label
                style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.25rem" }}
              >
                Display name
              </label>
              <input
                type="text"
                placeholder="Your name (optional)"
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  borderRadius: "0.5rem",
                  background: "rgba(31, 41, 55, 0.8)",
                  color: "#ffffff",
                  border: "1px solid rgba(75, 85, 99, 0.5)",
                  outline: "none",
                  transition: "all 0.3s ease",
                  backdropFilter: "blur(10px)",
                }}
                onFocus={(e) =>
                  ((e.target as HTMLInputElement).style.borderColor = "#dc2626")
                }
                onBlur={(e) =>
                  ((e.target as HTMLInputElement).style.borderColor =
                    "rgba(75, 85, 99, 0.5)")
                }
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>

            <div>
              <label
                style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.25rem" }}
              >
                Email
              </label>
              <input
                type="email"
                placeholder="you@example.com"
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  borderRadius: "0.5rem",
                  background: "rgba(31, 41, 55, 0.8)",
                  color: "#ffffff",
                  border: "1px solid rgba(75, 85, 99, 0.5)",
                  outline: "none",
                  transition: "all 0.3s ease",
                  backdropFilter: "blur(10px)",
                }}
                onFocus={(e) =>
                  ((e.target as HTMLInputElement).style.borderColor = "#dc2626")
                }
                onBlur={(e) =>
                  ((e.target as HTMLInputElement).style.borderColor =
                    "rgba(75, 85, 99, 0.5)")
                }
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div>
              <label
                style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.25rem" }}
              >
                Password
              </label>
              <input
                type="password"
                placeholder="At least 6 characters"
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  borderRadius: "0.5rem",
                  background: "rgba(31, 41, 55, 0.8)",
                  color: "#ffffff",
                  border: "1px solid rgba(75, 85, 99, 0.5)",
                  outline: "none",
                  transition: "all 0.3s ease",
                  backdropFilter: "blur(10px)",
                }}
                onFocus={(e) =>
                  ((e.target as HTMLInputElement).style.borderColor = "#dc2626")
                }
                onBlur={(e) =>
                  ((e.target as HTMLInputElement).style.borderColor =
                    "rgba(75, 85, 99, 0.5)")
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>
        </div>

        {/* Plan info display (read-only, always starts as free) */}
        <div>
          <h3
            style={{
              fontSize: "1.125rem",
              fontWeight: "600",
              marginBottom: "0.5rem",
              color: "#dc2626",
            }}
          >
            Your Plan
          </h3>
          <div
            style={{
              padding: "0.75rem",
              borderRadius: "0.5rem",
              background: "rgba(31, 41, 55, 0.5)",
              border: "1px solid rgba(34, 197, 94, 0.3)",
              backdropFilter: "blur(10px)",
            }}
          >
            <div
              style={{ fontWeight: "500", color: "#22c55e", marginBottom: "0.25rem" }}
            >
              Free Plan
            </div>
            <div style={{ fontSize: "0.75rem", color: "rgba(156, 163, 175, 0.8)" }}>
              Everyone starts on the Free plan. You can upgrade anytime in Settings →
              Billing.
            </div>
          </div>
        </div>

        {/* Terms of Service agreement (required) */}
        <div>
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "0.5rem",
              fontSize: "0.8rem",
              cursor: "pointer",
              padding: "0.5rem",
              borderRadius: "0.375rem",
              background: "rgba(31, 41, 55, 0.3)",
              lineHeight: 1.4,
            }}
          >
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              style={{ marginTop: "0.1rem", accentColor: "#dc2626" }}
              required
            />
            <span>
              I agree to the{" "}
              <button
                type="button"
                onClick={() => setShowTermsModal(true)}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  margin: 0,
                  color: "#dc2626",
                  fontWeight: 600,
                  textDecoration: "underline",
                  cursor: "pointer",
                }}
              >
                Terms of Service
              </button>
              .
            </span>
          </label>
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "0.75rem",
            borderRadius: "0.75rem",
            background: loading
              ? "rgba(75, 85, 99, 0.5)"
              : "linear-gradient(135deg, #dc2626, #ef4444)",
            color: "#ffffff",
            fontWeight: "600",
            border: "none",
            cursor: loading ? "not-allowed" : "pointer",
            width: "100%",
            transition: "all 0.3s ease",
            opacity: loading ? 0.6 : 1,
          }}
          onMouseEnter={(e) => {
            if (!loading) {
              (e.target as HTMLButtonElement).style.background =
                "linear-gradient(135deg, #b91c1c, #dc2626)";
              (e.target as HTMLButtonElement).style.boxShadow =
                "0 0 20px rgba(220, 38, 38, 0.4)";
            }
          }}
          onMouseLeave={(e) => {
            if (!loading) {
              (e.target as HTMLButtonElement).style.background =
                "linear-gradient(135deg, #dc2626, #ef4444)";
              (e.target as HTMLButtonElement).style.boxShadow = "none";
            }
          }}
        >
          {loading ? "Creating account..." : "Create account"}
        </button>

        {/* Next steps note */}
        <div
          style={{
            marginTop: "0.5rem",
            fontSize: "0.75rem",
            color: "rgba(148, 163, 184, 0.9)",
            textAlign: "left",
          }}
        >
          <div style={{ fontWeight: 500, marginBottom: "0.15rem" }}>Next steps:</div>
          <div>
            After creating your account, head to Settings to review your stream
            preferences and add any stream keys you plan to use. You can start a stream
            right away, or set things up first — it's up to you.
          </div>
        </div>
      </form>

      {/* Terms modal */}
      {showTermsModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 40,
          }}
          onClick={() => setShowTermsModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: "720px",
              maxHeight: "80vh",
              background: "#020617",
              borderRadius: "1rem",
              border: "1px solid rgba(248,113,113,0.4)",
              boxShadow: "0 24px 60px rgba(0,0,0,0.8)",
              padding: "1.5rem",
              color: "#f9fafb",
              overflowY: "auto",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "0.75rem",
              }}
            >
              <h2 style={{ fontSize: "1.25rem", fontWeight: 700 }}>Terms of Service</h2>
              <button
                type="button"
                onClick={() => setShowTermsModal(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#9ca3af",
                  fontSize: "1.25rem",
                  cursor: "pointer",
                }}
              >
                ×
              </button>
            </div>

            <p
              style={{ fontSize: "0.85rem", color: "#d1d5db", marginBottom: "0.75rem" }}
            >
              By creating a StreamLine account you agree to our Terms of Service. This is
              a summary; the full legal text is available on the dedicated Terms page.
            </p>

            <ul
              style={{
                fontSize: "0.8rem",
                color: "#9ca3af",
                paddingLeft: "1.1rem",
                marginBottom: "0.75rem",
              }}
            >
              <li>Use StreamLine only for lawful, authorized content and activity.</li>
              <li>You are responsible for your account and any activity under it.</li>
              <li>
                Paid plans, if enabled, are billed on a recurring basis and may have
                usage limits.
              </li>
              <li>
                We may suspend or terminate accounts that violate these terms or abuse
                the service.
              </li>
            </ul>

            <p
              style={{ fontSize: "0.8rem", color: "#9ca3af", marginBottom: "0.75rem" }}
            >
              For full details, including acceptable use, billing, and limitations of
              liability, review the complete Terms of Service.
            </p>

            <a
              href="/terms"
              target="_blank"
              rel="noreferrer"
              style={{
                display: "inline-block",
                marginTop: "0.25rem",
                fontSize: "0.8rem",
                color: "#fecaca",
                textDecoration: "underline",
              }}
            >
              Open full Terms of Service in a new tab
            </a>
          </div>
        </div>
      )}

      {error && (
        <p
          style={{
            marginTop: "1rem",
            color: "#ef4444",
            fontSize: "0.875rem",
            background: "rgba(239, 68, 68, 0.1)",
            padding: "0.75rem",
            borderRadius: "0.5rem",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            backdropFilter: "blur(10px)",
            position: "relative",
            zIndex: 1,
            maxWidth: "420px",
            width: "100%",
          }}
        >
          {error}
        </p>
      )}

      <p
        style={{
          marginTop: "1rem",
          fontSize: "0.875rem",
          color: "rgba(255, 255, 255, 0.7)",
          position: "relative",
          zIndex: 1,
        }}
      >
        Already have an account?{" "}
        <a
          href="/login"
          style={{
            color: "#dc2626",
            textDecoration: "none",
            fontWeight: "600",
          }}
          onMouseEnter={(e) =>
            ((e.target as HTMLAnchorElement).style.textDecoration = "underline")
          }
          onMouseLeave={(e) =>
            ((e.target as HTMLAnchorElement).style.textDecoration = "none")
          }
        >
          Sign in
        </a>
      </p>
    </div>
  );
};