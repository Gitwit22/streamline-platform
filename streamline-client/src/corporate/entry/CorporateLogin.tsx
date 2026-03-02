import { useMemo, useState } from 'react';
import { Link, useNavigate } from "react-router-dom";
import '../corporate.css';
import { setCorporateBypassEnabled, setCorporateLane } from '../state/corporateMode';

export default function CorporateLogin() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const canShowBypass = useMemo(() => {
    if (import.meta.env.DEV) return true;
    try {
      const host = String(window.location.hostname || "").toLowerCase();
      return host === "localhost" || host === "127.0.0.1";
    } catch {
      return false;
    }
  }, []);

  return (
    <div id="login-page" className="page active">
      <div className="login-left">
        <div className="ll-bg">
          <div className="ll-grid"></div>
        </div>
        <div className="ll-content">
          <img src="/corp_logo.png" alt="StreamLine Logo" className="ll-logo" />
          <h1 className="ll-headline">
            The operating system for <em>enterprise communication</em>.
          </h1>
          <p className="ll-sub">
            Secure, scalable, and fully integrated video infrastructure for the world's most demanding organizations.
          </p>
          <div className="ll-features">
            <div className="llf-item">
              <div className="llf-icon">{/* SVG */}</div>
              <div>
                <h3 className="llf-title">Global Scale</h3>
                <p className="llf-desc">Reach up to 1 million concurrent viewers with sub-second latency.</p>
              </div>
            </div>
            <div className="llf-item">
              <div className="llf-icon">{/* SVG */}</div>
              <div>
                <h3 className="llf-title">Bank-Grade Security</h3>
                <p className="llf-desc">E2EE, SSO, and granular permissions ensure your data is protected.</p>
              </div>
            </div>
          </div>
          <div className="ll-footer">
            <a href="#">© 2026 Nxt Lvl Technology Solutions</a>
            <a href="#">Terms of Service</a>
            <a href="#">Privacy Policy</a>
          </div>
        </div>
      </div>
      <div className="login-right">
        <div className="lr-orb"></div>
        <div className="login-form-box">
          <div className="lf-header">
            <h2 className="lf-title">Welcome Back</h2>
            <p className="lf-sub">Sign in to your corporate account.</p>
          </div>
          <button className="sso-btn">
            <span className="sso-icon sso-microsoft">M</span>
            Sign in with Microsoft
          </button>
          <button className="sso-btn">
            <span className="sso-icon sso-okta">Okta</span>
            Sign in with Okta
          </button>
          <div className="or-divider">OR</div>
          <form>
            <div className="form-group">
              <label className="form-label" htmlFor="email">Work Email</label>
              <div className="input-wrap">
                <input
                  type="email"
                  id="email"
                  className="form-input"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="password">
                <span>Password</span>
                <a href="#">Forgot?</a>
              </label>
              <div className="input-wrap">
                <input
                  type="password"
                  id="password"
                  className="form-input"
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>
            <div className="form-check">
              <input type="checkbox" id="remember" />
              <label htmlFor="remember">Remember me</label>
            </div>
            <button type="submit" className="submit-btn">Sign In</button>
          </form>

          {canShowBypass && (
            <>
              <div className="or-divider">OR</div>
              <button
                type="button"
                className="sso-btn"
                onClick={() => {
                  setCorporateLane();
                  setCorporateBypassEnabled();
                  nav("/streamline/corporate/dashboard", { replace: true });
                }}
                style={{
                  borderColor: 'var(--blue)',
                  background: 'rgba(91,196,245,0.08)',
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                  <polyline points="10 17 15 12 10 7" />
                  <line x1="15" y1="12" x2="3" y2="12" />
                </svg>
                Bypass login (demo admin)
              </button>
            </>
          )}

          <p className="lf-footer">
            Need access? <a href="mailto:nxtlvl@gmail.com?subject=StreamLine%20Corporate%20Access%20Request">Contact us</a>
          </p>
          <div className="security-badges">
            <div className="sec-badge">
              {/* SVG */}
              <span>SOC 2 Type II</span>
            </div>
            <div className="sec-badge">
              {/* SVG */}
              <span>GDPR Compliant</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
