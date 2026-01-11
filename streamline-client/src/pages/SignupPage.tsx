import React, { useState, useEffect } from "react";
import { PLAN_IDS, PlanId, isPlanId } from "../lib/planIds";
import { logAuthDebugContext } from "../lib/logAuthDebug";
import { useNavigate } from "react-router-dom";

// Use relative paths - Vite proxy forwards /api/* to http://localhost:5137
import { API_BASE } from "../services/apiBase";

// Email validation function
function validateEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

export const SignupPage = () => {
  const nav = useNavigate();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [timeZone, setTimeZone] = useState("");

  // Streaming defaults (user choices)
  const [defaultResolution, setDefaultResolution] = useState("720p");
  const [defaultDestinations, setDefaultDestinations] = useState({
    youtube: false,
    facebook: false,
    twitch: false,
  });
  const [defaultPrivacy, setDefaultPrivacy] = useState("public");
  const [skipOnboarding, setSkipOnboarding] = useState(false);

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

  const toggleDestination = (platform: "youtube" | "facebook" | "twitch") => {
    setDefaultDestinations((prev) => ({
      ...prev,
      [platform]: !prev[platform],
    }));
  };

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

    try {
      const body: Record<string, any> = {
        displayName: displayName.trim(),
        email: email.trim().toLowerCase(),
        password,
        timeZone: timeZone || "America/Chicago",
        skipOnboarding,
      };

      if (!skipOnboarding) {
        body.defaultResolution = defaultResolution;
        body.defaultDestinations = defaultDestinations;
        body.defaultPrivacy = defaultPrivacy;
      }

      console.log("📤 Sending signup request:", { email, displayName });

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

      console.log("✅ Signup successful:", data);

      // Store user data and token in localStorage
      localStorage.setItem("sl_user", JSON.stringify(data.user));

      localStorage.setItem("sl_token", data.token);
      localStorage.setItem("sl_userId", data.user.id || data.user.uid);
      localStorage.setItem("sl_displayName", data.user.displayName);
      // Fallback: Set JWT as a non-httpOnly cookie for backend auth (for local dev)
      if (typeof document !== "undefined" && data.token) {
        document.cookie = `token=${data.token}; path=/; max-age=${60 * 60 * 24 * 7}`;
        // Debug: Log cookies after setting
        console.log('[Signup] Cookies after signup:', document.cookie);
      }

      setLoading(false);
      // Log auth/user info after signup
      logAuthDebugContext("After Signup Success");

      // After signup, send users to Streaming settings first (unless they explicitly
      // skipped onboarding). From there they can configure destinations/keys and
      // then navigate to Join or Dashboard.
      if (!skipOnboarding) {
        nav("/settings/billing?tab=destinations");
        return;
      }

      // If onboarding was skipped, fall back to the existing plan/billing flow.
      let planIdRaw = data.user.planId || "free";
      let selectedPlan: PlanId = "free";
      if (planIdRaw === "starter_paid" || planIdRaw === "starter_trial") {
        selectedPlan = "starter";
      } else if (isPlanId(planIdRaw)) {
        selectedPlan = planIdRaw;
      }
      if (selectedPlan === "starter" || selectedPlan === "pro") {
        try {
          const billingRes = await fetch(`${API_BASE}/api/billing/checkout`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (billingRes.ok) {
            const billingData = await billingRes.json();
            if (billingData.url) {
              window.location.href = billingData.url;
              return;
            }
          }
          // If billing fails, fallback to dashboard
          nav("/dashboard");
        } catch (err) {
          nav("/dashboard");
        }
      } else {
        // Free plan: continue to join page
        nav("/join");
      }
    } catch (err: any) {
      console.error("❌ Signup error:", err);
      setLoading(false);
      setError(err?.message || "Something went wrong. Try again.");
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#000000',
      color: '#ffffff',
      padding: '1.5rem',
      textAlign: 'center',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Animated Background Orbs */}
      <div style={{
        position: 'absolute',
        top: '15%',
        left: '10%',
        width: '250px',
        height: '250px',
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #dc2626, #ef4444)',
        opacity: 0.1,
        filter: 'blur(40px)',
        animation: 'float 6s ease-in-out infinite'
      }} />
      <div style={{
        position: 'absolute',
        bottom: '20%',
        right: '15%',
        width: '200px',
        height: '200px',
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #ef4444, #dc2626)',
        opacity: 0.08,
        filter: 'blur(30px)',
        animation: 'float 8s ease-in-out infinite reverse'
      }} />
      
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-20px) rotate(180deg); }
        }
      `}</style>

      <h2 style={{
        fontSize: '1.875rem',
        fontWeight: 'bold',
        marginBottom: '1.5rem',
        position: 'relative',
        zIndex: 1
      }}>Create Your StreamLine Account</h2>

      <form
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          maxWidth: '420px',
          gap: '1.5rem',
          textAlign: 'left',
          background: 'rgba(39, 39, 42, 0.5)',
          padding: '2rem',
          borderRadius: '1rem',
          border: '1px solid rgba(63, 63, 70, 0.8)',
          backdropFilter: 'blur(20px)',
          position: 'relative',
          zIndex: 1
        }}
      >
        {/* STEP 1 – Basic profile */}
        <div>
          <h3 style={{
            fontSize: '1.125rem',
            fontWeight: '600',
            marginBottom: '0.5rem',
            color: '#dc2626'
          }}>
            Step 1 – Basic Profile
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem' }}>Display name</label>
              <input
                type="text"
                placeholder="What should we call you?"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  background: 'rgba(31, 41, 55, 0.8)',
                  color: '#ffffff',
                  border: '1px solid rgba(75, 85, 99, 0.5)',
                  outline: 'none',
                  transition: 'all 0.3s ease',
                  backdropFilter: 'blur(10px)'
                }}
                onFocus={(e) => (e.target as HTMLInputElement).style.borderColor = '#dc2626'}
                onBlur={(e) => (e.target as HTMLInputElement).style.borderColor = 'rgba(75, 85, 99, 0.5)'}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem' }}>Email</label>
              <input
                type="email"
                placeholder="you@example.com"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  background: 'rgba(31, 41, 55, 0.8)',
                  color: '#ffffff',
                  border: '1px solid rgba(75, 85, 99, 0.5)',
                  outline: 'none',
                  transition: 'all 0.3s ease',
                  backdropFilter: 'blur(10px)'
                }}
                onFocus={(e) => (e.target as HTMLInputElement).style.borderColor = '#dc2626'}
                onBlur={(e) => (e.target as HTMLInputElement).style.borderColor = 'rgba(75, 85, 99, 0.5)'}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem' }}>Password</label>
              <input
                type="password"
                placeholder="At least 6 characters"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  background: 'rgba(31, 41, 55, 0.8)',
                  color: '#ffffff',
                  border: '1px solid rgba(75, 85, 99, 0.5)',
                  outline: 'none',
                  transition: 'all 0.3s ease',
                  backdropFilter: 'blur(10px)'
                }}
                onFocus={(e) => (e.target as HTMLInputElement).style.borderColor = '#dc2626'}
                onBlur={(e) => (e.target as HTMLInputElement).style.borderColor = 'rgba(75, 85, 99, 0.5)'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>
        </div>

        {/* Plan info display (read-only, always starts as free) */}
        <div>
          <h3 style={{
            fontSize: '1.125rem',
            fontWeight: '600',
            marginBottom: '0.5rem',
            color: '#dc2626'
          }}>
            Your Plan
          </h3>
          <div style={{
            padding: '0.75rem',
            borderRadius: '0.5rem',
            background: 'rgba(31, 41, 55, 0.5)',
            border: '1px solid rgba(34, 197, 94, 0.3)',
            backdropFilter: 'blur(10px)'
          }}>
            <div style={{ fontWeight: '500', color: '#22c55e', marginBottom: '0.25rem' }}>
              Free Plan
            </div>
            <div style={{ fontSize: '0.75rem', color: 'rgba(156, 163, 175, 0.8)' }}>
              Perfect for getting started with StreamLine. You can upgrade anytime—just head to Settings → Billing when you're ready.
            </div>
          </div>
        </div>

        {/* Skip onboarding checkbox */}
        <div>
          <label style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.5rem',
            fontSize: '0.875rem',
            cursor: 'pointer',
            padding: '0.5rem',
            borderRadius: '0.375rem',
            background: 'rgba(31, 41, 55, 0.3)'
          }}>
            <input
              type="checkbox"
              checked={skipOnboarding}
              onChange={(e) => setSkipOnboarding(e.target.checked)}
              style={{ marginTop: '0.125rem', accentColor: '#dc2626' }}
            />
            <span>Skip streaming setup for now (you can set this up later)</span>
          </label>
        </div>

        {/* STEP 2 – Streaming defaults */}
        {!skipOnboarding && (
          <>
            <div>
              <h3 style={{
                fontSize: '1.125rem',
                fontWeight: '600',
                marginBottom: '0.5rem',
                color: '#dc2626'
              }}>
                Step 2 – Streaming Defaults (optional)
              </h3>

              <p style={{
                fontSize: '0.875rem',
                color: 'rgba(156, 163, 175, 0.85)',
                marginBottom: '0.75rem'
              }}>
                Add your stream keys once here—they're saved for future streams, so you can go live faster next time.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                    Default resolution
                  </label>
                  <select
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      borderRadius: '0.5rem',
                      background: 'rgba(31, 41, 55, 0.8)',
                      color: '#ffffff',
                      border: '1px solid rgba(75, 85, 99, 0.5)',
                      outline: 'none',
                      backdropFilter: 'blur(10px)'
                    }}
                    value={defaultResolution}
                    onChange={(e) => setDefaultResolution(e.target.value)}
                  >
                    <option value="720p">720p</option>
                    <option value="1080p">1080p</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                    Default destinations
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.875rem' }}>
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.5rem',
                      borderRadius: '0.375rem',
                      background: 'rgba(31, 41, 55, 0.3)',
                      cursor: 'pointer'
                    }}>
                      <input
                        type="checkbox"
                        checked={defaultDestinations.youtube}
                        onChange={() => toggleDestination("youtube")}
                        style={{ accentColor: '#dc2626' }}
                      />
                      <span>Use YouTube by default when I go live</span>
                    </label>
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.5rem',
                      borderRadius: '0.375rem',
                      background: 'rgba(31, 41, 55, 0.3)',
                      cursor: 'pointer'
                    }}>
                      <input
                        type="checkbox"
                        checked={defaultDestinations.facebook}
                        onChange={() => toggleDestination("facebook")}
                        style={{ accentColor: '#dc2626' }}
                      />
                      <span>Use Facebook by default when I go live</span>
                    </label>
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.5rem',
                      borderRadius: '0.375rem',
                      background: 'rgba(31, 41, 55, 0.3)',
                      cursor: 'pointer'
                    }}>
                      <input
                        type="checkbox"
                        checked={defaultDestinations.twitch}
                        onChange={() => toggleDestination("twitch")}
                        style={{ accentColor: '#dc2626' }}
                      />
                      <span>Use Twitch by default when I go live</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                    Default YouTube privacy (optional)
                  </label>
                  <select
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      borderRadius: '0.5rem',
                      background: 'rgba(31, 41, 55, 0.8)',
                      color: '#ffffff',
                      border: '1px solid rgba(75, 85, 99, 0.5)',
                      outline: 'none',
                      backdropFilter: 'blur(10px)'
                    }}
                    value={defaultPrivacy}
                    onChange={(e) => setDefaultPrivacy(e.target.value)}
                  >
                    <option value="public">Public</option>
                    <option value="unlisted">Unlisted</option>
                  </select>
                </div>
              </div>
            </div>
          </>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '0.75rem',
            borderRadius: '0.75rem',
            background: loading ? 'rgba(75, 85, 99, 0.5)' : 'linear-gradient(135deg, #dc2626, #ef4444)',
            color: '#ffffff',
            fontWeight: '600',
            border: 'none',
            cursor: loading ? 'not-allowed' : 'pointer',
            width: '100%',
            transition: 'all 0.3s ease',
            opacity: loading ? 0.6 : 1
          }}
          onMouseEnter={(e) => {
            if (!loading) {
              (e.target as HTMLButtonElement).style.background = 'linear-gradient(135deg, #b91c1c, #dc2626)';
              (e.target as HTMLButtonElement).style.boxShadow = '0 0 20px rgba(220, 38, 38, 0.4)';
            }
          }}
          onMouseLeave={(e) => {
            if (!loading) {
              (e.target as HTMLButtonElement).style.background = 'linear-gradient(135deg, #dc2626, #ef4444)';
              (e.target as HTMLButtonElement).style.boxShadow = 'none';
            }
          }}
        >
          {loading ? "Creating account..." : "Create account"}
        </button>
      </form>

      {error && (
        <p style={{
          marginTop: '1rem',
          color: '#ef4444',
          fontSize: '0.875rem',
          background: 'rgba(239, 68, 68, 0.1)',
          padding: '0.75rem',
          borderRadius: '0.5rem',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          backdropFilter: 'blur(10px)',
          position: 'relative',
          zIndex: 1
        }}>
          {error}
        </p>
      )}

      <p style={{
        marginTop: '1rem',
        fontSize: '0.875rem',
        color: 'rgba(255, 255, 255, 0.7)',
        position: 'relative',
        zIndex: 1
      }}>
        Already have an account?{' '}
        <a
          href="/login"
          style={{
            color: '#dc2626',
            textDecoration: 'none',
            fontWeight: '600'
          }}
          onMouseEnter={(e) => (e.target as HTMLAnchorElement).style.textDecoration = 'underline'}
          onMouseLeave={(e) => (e.target as HTMLAnchorElement).style.textDecoration = 'none'}
        >
          Sign in
        </a>
      </p>
    </div>
  );
};