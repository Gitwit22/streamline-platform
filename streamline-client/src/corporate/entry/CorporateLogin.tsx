import { FormEvent, useMemo, useState } from 'react';
import { useLocation, useNavigate } from "react-router-dom";
import '../corporate.css';
import { setCorporateBypassEnabled, setCorporateLane } from '../state/corporateMode';
import { apiFetch, apiFetchAuth, clearAuthStorage } from '../../lib/api';
import { firebaseSignInWithCustomToken, isFirebaseWebConfigured, firebaseSendPasswordReset } from '../../lib/firebaseClient';

type AuthTab = 'login' | 'signup';

export default function CorporateLogin() {
  const nav = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);
  const [authTab, setAuthTab] = useState<AuthTab>('login');

  const returnTo = useMemo(() => {
    try {
      const sp = new URLSearchParams(location.search || '');
      const rt = sp.get('returnTo') || '';
      if (!rt || !rt.startsWith('/') || rt.startsWith('//')) return null;
      return rt;
    } catch {
      return null;
    }
  }, [location.search]);

  const handleDemo = () => {
    setCorporateLane();
    setCorporateBypassEnabled();
    nav('/streamline/corporate/dashboard', { replace: true });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.');
      setLoading(false);
      return;
    }

    try {
      if (!isFirebaseWebConfigured()) {
        // Legacy token-based login
        const res = await apiFetch(
          '/api/auth/login',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          },
          { allowNonOk: true },
        );

        if (!res.ok) {
          if (res.status === 401 || res.status === 403) clearAuthStorage();
          const ct = res.headers.get('content-type') || '';
          const errBody = ct.includes('application/json') ? await res.json().catch(() => ({})) : {};
          setError((errBody as any)?.error || 'Invalid credentials');
          setLoading(false);
          return;
        }

        let loginBody: any = null;
        try {
          const ct = res.headers.get('content-type') || '';
          loginBody = ct.includes('application/json') ? await res.json() : null;
        } catch { loginBody = null; }

        const token = (loginBody as any)?.token as string | undefined;
        if (!token) {
          clearAuthStorage();
          setError('Login failed: missing token from server');
          setLoading(false);
          return;
        }
        try { localStorage.setItem('authToken', token); } catch {}
      } else {
        // Firebase custom-token login
        const res = await apiFetch(
          '/api/auth/legacy-login',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          },
          { allowNonOk: true },
        );

        if (!res.ok) {
          if (res.status === 401 || res.status === 403) clearAuthStorage();
          const ct = res.headers.get('content-type') || '';
          const errBody = ct.includes('application/json') ? await res.json().catch(() => ({})) : {};
          const msg = (errBody as any)?.error || (res.status === 409 ? 'Email conflict. Contact support.' : 'Invalid credentials');
          setError(msg);
          setLoading(false);
          return;
        }

        const payload = await res.json().catch(() => null as any);
        const customToken = String(payload?.customToken || '').trim();
        if (!customToken) {
          setError('Login failed: missing customToken');
          setLoading(false);
          return;
        }

        try { localStorage.removeItem('authToken'); } catch {}
        await firebaseSignInWithCustomToken(customToken);
      }

      // Hydrate /api/account/me so lane guards have orgType.
      try {
        const meRes = await apiFetchAuth('/api/account/me', { cache: 'no-store' });
        const me = await meRes.json();
        try { localStorage.setItem('sl_user', JSON.stringify(me)); } catch {}
        try { window.dispatchEvent(new CustomEvent('sl:auth-changed')); } catch {}
      } catch { /* non-fatal */ }

      setCorporateLane();
      setLoading(false);
      nav(returnTo || '/streamline/corporate/dashboard', { replace: true });
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Something went wrong. Try again.');
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setError('');
    if (!isFirebaseWebConfigured()) {
      setError('Password reset isn\u2019t available yet (Firebase not configured). Contact your admin.');
      return;
    }
    const emailNorm = String(email || '').trim().toLowerCase();
    if (!emailNorm || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
      setError('Enter your work email above, then click Forgot.');
      return;
    }
    try {
      const continueUrl = String(import.meta.env.VITE_FIREBASE_CONTINUE_URL || '').trim();
      const settings = continueUrl
        ? { url: continueUrl, handleCodeInApp: false }
        : { url: window.location.origin + '/streamline/corporate/login', handleCodeInApp: false };
      await firebaseSendPasswordReset(emailNorm, settings as any);
      setError('Password reset email sent (check your inbox).');
    } catch (err: any) {
      setError(String(err?.code || err?.message || 'reset_failed'));
    }
  };

  /* ── Signup handler ── */
  const handleSignup = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const emailNorm = email.trim().toLowerCase();
    const pw = password.trim();
    const name = displayName.trim();

    if (!emailNorm || !pw) {
      setError('Email and password are required.');
      setLoading(false);
      return;
    }
    if (pw.length < 6) {
      setError('Password must be at least 6 characters.');
      setLoading(false);
      return;
    }

    try {
      const res = await apiFetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailNorm,
          password: pw,
          displayName: name || emailNorm.split('@')[0],
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago',
          tosAccepted: true,
        }),
      }, { allowNonOk: true });

      if (!res.ok) {
        const ct = res.headers.get('content-type') || '';
        const body = ct.includes('application/json') ? await res.json().catch(() => ({})) : {};
        setError((body as any)?.error || 'Signup failed');
        setLoading(false);
        return;
      }

      const loginBody = await res.json().catch(() => ({} as any));
      const token = (loginBody as any)?.token as string | undefined;
      if (token) {
        try { localStorage.setItem('authToken', token); } catch {}
      }

      setCorporateLane();
      setLoading(false);
      // After signup, redirect to join-org page (user has no org yet)
      nav('/streamline/corporate/join', { replace: true });
    } catch (err: any) {
      setError(err?.message || 'Signup failed. Try again.');
      setLoading(false);
    }
  };

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
            <h2 className="lf-title">StreamLine Corporate</h2>
            <p className="lf-sub">Explore the platform or sign in with your corporate credentials.</p>
          </div>

          {/* ── Demo button (primary CTA) ── */}
          <button
            type="button"
            className="sso-btn"
            onClick={handleDemo}
            style={{
              background: 'linear-gradient(135deg, rgba(91,196,245,0.15), rgba(91,196,245,0.05))',
              borderColor: 'var(--blue)',
              fontWeight: 600,
              fontSize: '15px',
              padding: '14px 20px',
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 20, height: 20 }}>
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Explore Demo
          </button>
          <p style={{ textAlign: 'center', fontSize: '12px', color: 'rgba(255,255,255,0.35)', marginTop: '6px' }}>
            No account needed — browse with sample data, go live, and test every feature.
          </p>

          {/* ── Credentials toggle ── */}
          <div className="or-divider" style={{ cursor: 'pointer' }} onClick={() => setShowCredentials(!showCredentials)}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14, transition: 'transform 0.2s', transform: showCredentials ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
              Sign in or create an account
            </span>
          </div>

          {showCredentials && (<>
          {/* ── Login / Signup tabs ── */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
            <button
              type="button"
              onClick={() => { setAuthTab('login'); setError(''); }}
              style={{
                flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
                background: authTab === 'login' ? 'var(--surface2)' : 'transparent',
                color: authTab === 'login' ? 'var(--blue)' : 'var(--text3)',
                borderBottom: authTab === 'login' ? '2px solid var(--blue)' : '2px solid transparent',
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setAuthTab('signup'); setError(''); }}
              style={{
                flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
                background: authTab === 'signup' ? 'var(--surface2)' : 'transparent',
                color: authTab === 'signup' ? 'var(--green)' : 'var(--text3)',
                borderBottom: authTab === 'signup' ? '2px solid var(--green)' : '2px solid transparent',
              }}
            >
              Create Account
            </button>
          </div>

          {authTab === 'login' && (<>
          <button className="sso-btn">
            <span className="sso-icon sso-microsoft">M</span>
            Sign in with Microsoft
          </button>
          <button className="sso-btn">
            <span className="sso-icon sso-okta">Okta</span>
            Sign in with Okta
          </button>
          <div className="or-divider">OR</div>
          <form onSubmit={handleSubmit}>
            {error && (
              <div style={{ color: '#f87171', fontSize: 13, marginBottom: 8, background: 'rgba(248,113,113,0.08)', padding: '8px 12px', borderRadius: 8 }}>
                {error}
              </div>
            )}
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
                <button type="button" onClick={handleForgotPassword} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 'inherit', textDecoration: 'underline', padding: 0 }}>Forgot?</button>
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
            <button type="submit" className="submit-btn" disabled={loading}>
              {loading ? 'Signing in\u2026' : 'Sign In'}
            </button>
          </form>
          </>)}

          {authTab === 'signup' && (
          <form onSubmit={handleSignup}>
            {error && (
              <div style={{ color: '#f87171', fontSize: 13, marginBottom: 8, background: 'rgba(248,113,113,0.08)', padding: '8px 12px', borderRadius: 8 }}>
                {error}
              </div>
            )}
            <div className="form-group">
              <label className="form-label" htmlFor="signup-name">Display Name</label>
              <div className="input-wrap">
                <input
                  type="text"
                  id="signup-name"
                  className="form-input"
                  placeholder="Your full name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="signup-email">Email</label>
              <div className="input-wrap">
                <input
                  type="email"
                  id="signup-email"
                  className="form-input"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="signup-password">Password</label>
              <div className="input-wrap">
                <input
                  type="password"
                  id="signup-password"
                  className="form-input"
                  placeholder="6+ characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>
              By creating an account you agree to the Terms of Service and Privacy Policy.
            </p>
            <button type="submit" className="submit-btn" disabled={loading} style={{ background: 'var(--green)', color: '#04090f' }}>
              {loading ? 'Creating account\u2026' : 'Create Account'}
            </button>
          </form>
          )}
          </>)}


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
