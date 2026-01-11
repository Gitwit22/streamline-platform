import React, { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";


// Email validation function
function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.com$/;
  return re.test(email);
}

/**
 * STREAMLINE LOGIN PAGE - REDESIGNED
 * 
 * CRITICAL STYLING RULES:
 * - Background: Pure black with animated red gradients
 * - Theme: Glassmorphism with red accents
 * - All styles are inline and explicit
 * - Logo must be visible
 */

export const LoginPage = () => {
  const nav = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

  const nextUrl = useMemo(() => {
    try {
      const sp = new URLSearchParams(location.search || "");
      const next = sp.get("next") || "";
      // Only allow internal relative paths
      if (!next || typeof next !== "string") return null;
      if (!next.startsWith("/")) return null;
      if (next.startsWith("//")) return null;
      return next;
    } catch {
      return null;
    }
  }, [location.search]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    // Validate email format
    if (!validateEmail(email)) {
      setError("Please enter a valid email address.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const ct = res.headers.get("content-type") || "";
        const err = ct.includes("application/json")
          ? await res.json().catch(() => ({}))
          : { error: "Login failed: backend returned non-JSON (check API base / server)" };
        setError(err?.error || "Invalid credentials");
        setLoading(false);
        return;
      }

      // ✅ LOGIN SUCCEEDED — cookie is now set
      // Hydrate user from /me
      const meRes = await fetch(`${API_BASE}/api/auth/me`, {
        credentials: "include",
      });

      if (!meRes.ok) {
        setError("Logged in, but failed to load profile");
        setLoading(false);
        return;
      }

      const ctMe = meRes.headers.get("content-type") || "";
      if (!ctMe.includes("application/json")) {
        setError("Profile load returned non-JSON. Verify backend URL and CORS.");
        setLoading(false);
        return;
      }
      const me = await meRes.json();

      // Optional: store user for UI convenience
      localStorage.setItem("sl_user", JSON.stringify(me));

      setLoading(false);
      if (typeof document !== "undefined") {
        console.log('[Login] Cookies after login:', document.cookie);
      }
      nav(nextUrl || "/join"); // or /dashboard
    } catch (err) {
      console.error(err);
      setError("Something went wrong. Try again.");
      setLoading(false);
    }
  };

  return (
    <div 
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#000000',
        color: '#ffffff',
        padding: '24px',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      
      {/* ANIMATED BACKGROUND */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
        <div 
          style={{
            position: 'absolute',
            top: '10%',
            right: '20%',
            width: '600px',
            height: '600px',
            background: 'rgba(220, 38, 38, 0.15)',
            borderRadius: '50%',
            filter: 'blur(120px)',
            animation: 'pulse 4s ease-in-out infinite'
          }}
        />
        <div 
          style={{
            position: 'absolute',
            bottom: '10%',
            left: '20%',
            width: '500px',
            height: '500px',
            background: 'rgba(239, 68, 68, 0.1)',
            borderRadius: '50%',
            filter: 'blur(150px)',
            animation: 'pulse 4s ease-in-out infinite',
            animationDelay: '2s'
          }}
        />
      </div>

      {/* MAIN CONTENT */}
      <div style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: '420px' }}>
        
        {/* LOGO */}
        <div style={{ marginBottom: '32px', textAlign: 'center' }}>
          <img
            src="/logosmall.png"
            alt="StreamLine Logo"
            style={{
              width: '80px',
              height: '80px',
              margin: '0 auto',
              filter: 'drop-shadow(0 0 25px rgba(220, 38, 38, 0.5))'
            }}
          />
        </div>

        {/* TITLE */}
        <div style={{ marginBottom: '32px', textAlign: 'center' }}>
          <h1 
            style={{
              fontSize: '32px',
              fontWeight: 700,
              marginBottom: '8px',
              background: 'linear-gradient(to right, #ffffff, #fecaca, #ffffff)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}
          >
            Welcome Back
          </h1>
          <p style={{ fontSize: '16px', color: '#9ca3af' }}>
            Sign in to continue streaming
          </p>
        </div>

        {/* FORM CONTAINER */}
        <div
          style={{
            background: 'rgba(15, 15, 15, 0.7)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '20px',
            padding: '32px',
            marginBottom: '24px'
          }}
        >
          <form onSubmit={handleSubmit}>
            {/* EMAIL INPUT */}
            <div style={{ marginBottom: '20px' }}>
              <label 
                style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: '#9ca3af',
                  marginBottom: '8px'
                }}
              >
                Email Address
              </label>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  background: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '12px',
                  color: '#ffffff',
                  fontSize: '15px',
                  outline: 'none',
                  transition: 'all 0.3s ease'
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(220, 38, 38, 0.5)';
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(220, 38, 38, 0.1)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
            </div>

            {/* PASSWORD INPUT */}
            <div style={{ marginBottom: '24px' }}>
              <label 
                style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: '#9ca3af',
                  marginBottom: '8px'
                }}
              >
                Password
              </label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  background: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '12px',
                  color: '#ffffff',
                  fontSize: '15px',
                  outline: 'none',
                  transition: 'all 0.3s ease'
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(220, 38, 38, 0.5)';
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(220, 38, 38, 0.1)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
            </div>

            {/* ERROR MESSAGE */}
            {error && (
              <div 
                style={{
                  padding: '12px 16px',
                  background: 'rgba(220, 38, 38, 0.15)',
                  border: '1px solid rgba(220, 38, 38, 0.3)',
                  borderRadius: '10px',
                  marginBottom: '20px',
                  fontSize: '14px',
                  color: '#fca5a5'
                }}
              >
                {error}
              </div>
            )}

            {/* SUBMIT BUTTON */}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '16px',
                background: loading ? 'rgba(220, 38, 38, 0.5)' : 'linear-gradient(to right, #dc2626, #ef4444)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '12px',
                fontSize: '16px',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                boxShadow: '0 8px 32px rgba(220, 38, 38, 0.3)',
                transition: 'all 0.3s ease'
              }}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.currentTarget.style.background = 'linear-gradient(to right, #ef4444, #f87171)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 12px 40px rgba(220, 38, 38, 0.4)';
                }
              }}
              onMouseLeave={(e) => {
                if (!loading) {
                  e.currentTarget.style.background = 'linear-gradient(to right, #dc2626, #ef4444)';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 8px 32px rgba(220, 38, 38, 0.3)';
                }
              }}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          {/* FORGOT PASSWORD LINK */}
          <div style={{ marginTop: '16px', textAlign: 'center' }}>
            <a
              href="#"
              style={{
                fontSize: '13px',
                color: '#9ca3af',
                textDecoration: 'none',
                transition: 'color 0.3s ease'
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
              onMouseLeave={(e) => e.currentTarget.style.color = '#9ca3af'}
            >
              Forgot password?
            </a>
          </div>
        </div>

        {/* SIGN UP LINK */}
        <div style={{ textAlign: 'center' }}>
          <span style={{ fontSize: '14px', color: '#9ca3af' }}>
            Don't have an account?{' '}
          </span>
          <button
            onClick={() => nav("/signup")}
            style={{
              fontSize: '14px',
              color: '#ef4444',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              textDecoration: 'underline',
              transition: 'color 0.3s ease'
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#f87171'}
            onMouseLeave={(e) => e.currentTarget.style.color = '#ef4444'}
          >
            Create account
          </button>
        </div>

        {/* BACK TO HOME */}
        <div style={{ marginTop: '24px', textAlign: 'center' }}>
          <button
            onClick={() => nav("/")}
            style={{
              fontSize: '13px',
              color: '#6b7280',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              textDecoration: 'none',
              transition: 'color 0.3s ease'
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#9ca3af'}
            onMouseLeave={(e) => e.currentTarget.style.color = '#6b7280'}
          >
            ← Back to home
          </button>
        </div>
      </div>

      {/* CSS ANIMATIONS */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.15; transform: scale(1); }
          50% { opacity: 0.25; transform: scale(1.05); }
        }

        input::placeholder {
          color: #6b7280;
        }
      `}</style>
    </div>
  );
};
