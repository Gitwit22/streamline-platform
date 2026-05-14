import { FormEvent, useMemo, useState } from 'react';
import { useLocation, useNavigate } from "react-router-dom";
import '../corporate.css';
import { setCorporateBypassEnabled, setCorporateLane } from '../state/corporateMode';
import { apiFetch, apiFetchAuth, clearAuthStorage } from '../../lib/api';
import { firebaseSignInWithCustomToken, isFirebaseWebConfigured, firebaseSendPasswordReset } from '../../lib/firebaseClient';

type AuthMode = 'signin' | 'signup';

export default function CorporateLogin() {
  const nav = useNavigate();
  const location = useLocation();
  const [authMode, setAuthMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [tosAccepted, setTosAccepted] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);

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

  const switchAuthMode = (mode: AuthMode) => {
    setAuthMode(mode);
    setError('');
  };

  const handleDemo = () => {
    setCorporateLane();
    setCorporateBypassEnabled();
    nav('/streamline/corporate/dashboard', { replace: true });
  };

  const finalizeAuthSuccess = async () => {
    // Hydrate /api/account/me so lane guards have orgType.
    try {
      const meRes = await apiFetchAuth('/api/account/me', { cache: 'no-store' });
      const me = await meRes.json();
      try { localStorage.setItem('sl_user', JSON.stringify(me)); } catch {}
      try { window.dispatchEvent(new CustomEvent('sl:auth-changed')); } catch {}
    } catch {
      // non-fatal
    }

    setCorporateLane();
    nav(returnTo || '/streamline/corporate/dashboard', { replace: true });
  };

  const handleSignIn = async (): Promise<boolean> => {
    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.');
      return false;
    }

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
        return false;
      }

      let loginBody: any = null;
      try {
        const ct = res.headers.get('content-type') || '';
        loginBody = ct.includes('application/json') ? await res.json() : null;
      } catch {
        loginBody = null;
      }

      const token = (loginBody as any)?.token as string | undefined;
      if (!token) {
        clearAuthStorage();
        setError('Login failed: missing token from server');
        return false;
      }
      try { localStorage.setItem('authToken', token); } catch {}
      return true;
    }

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
      return false;
    }

    const payload = await res.json().catch(() => null as any);
    const customToken = String(payload?.customToken || '').trim();
    if (!customToken) {
      setError('Login failed: missing customToken');
      return false;
    }

    try { localStorage.removeItem('authToken'); } catch {}
    await firebaseSignInWithCustomToken(customToken);
    return true;
  };

  const handleSignUp = async (): Promise<boolean> => {
    const emailNorm = String(email || '').trim().toLowerCase();
    if (!emailNorm || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
      setError('Enter a valid work email address.');
      return false;
    }

    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters.');
      return false;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return false;
    }

    if (!tosAccepted) {
      setError('Please accept the Terms of Service to continue.');
      return false;
    }

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const res = await apiFetch(
      '/api/auth/signup',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailNorm,
          password,
          displayName: displayName.trim() || undefined,
          timeZone: timeZone || undefined,
          tosAccepted: true,
        }),
      },
      { allowNonOk: true },
    );

    if (!res.ok) {
      const ct = res.headers.get('content-type') || '';
      const errBody = ct.includes('application/json') ? await res.json().catch(() => ({})) : {};
      const rawError = String((errBody as any)?.error || '').trim();
      if (res.status === 409) {
        setError('This email is already in use. Sign in instead.');
      } else if (rawError === 'tos_required') {
        setError('Please accept the Terms of Service to continue.');
      } else {
        setError(rawError || 'Could not create account. Please try again.');
      }
      return false;
    }

    const payload = await res.json().catch(() => null as any);
    const token = String(payload?.token || '').trim();
    if (!token) {
      clearAuthStorage();
      setError('Create account failed: missing token from server');
      return false;
    }

    try { localStorage.setItem('authToken', token); } catch {}
    return true;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const ok = authMode === 'signup' ? await handleSignUp() : await handleSignIn();
      if (ok) {
        await finalizeAuthSuccess();
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const submitLabel = loading
    ? (authMode === 'signup' ? 'Creating account…' : 'Signing in…')
    : (authMode === 'signup' ? 'Create Account' : 'Sign In');

  const handleForgotPassword = async () => {
    setError('');
    if (!isFirebaseWebConfigured()) {
      setError('Password reset isn’t available yet (Firebase not configured). Contact your admin.');
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
              {authMode === 'signup' ? 'Create an account' : 'Sign in with credentials'}
            </span>
          </div>

          {showCredentials && (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button
                  type="button"
                  className={`nav-tab ${authMode === 'signin' ? 'active-tab' : ''}`}
                  onClick={() => switchAuthMode('signin')}
                  style={{ flex: 1, border: '1px solid var(--border)' }}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  className={`nav-tab ${authMode === 'signup' ? 'active-tab' : ''}`}
                  onClick={() => switchAuthMode('signup')}
                  style={{ flex: 1, border: '1px solid var(--border)' }}
                >
                  Create account
                </button>
              </div>

              {authMode === 'signin' && (
                <>
                  <button className="sso-btn" type="button">
                    <span className="sso-icon sso-microsoft">M</span>
                    Sign in with Microsoft
                  </button>
                  <button className="sso-btn" type="button">
                    <span className="sso-icon sso-okta">Okta</span>
                    Sign in with Okta
                  </button>
                </>
              )}

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

                {authMode === 'signup' && (
                  <div className="form-group">
                    <label className="form-label" htmlFor="display-name">Full Name (optional)</label>
                    <div className="input-wrap">
                      <input
                        type="text"
                        id="display-name"
                        className="form-input"
                        placeholder="Jane Doe"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label" htmlFor="password">
                    <span>Password</span>
                    {authMode === 'signin' ? (
                      <button type="button" onClick={handleForgotPassword} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 'inherit', textDecoration: 'underline', padding: 0 }}>Forgot?</button>
                    ) : null}
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

                {authMode === 'signup' && (
                  <div className="form-group">
                    <label className="form-label" htmlFor="confirm-password">Confirm Password</label>
                    <div className="input-wrap">
                      <input
                        type="password"
                        id="confirm-password"
                        className="form-input"
                        placeholder="••••••••••••"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {authMode === 'signup' ? (
                  <div className="form-check">
                    <input
                      type="checkbox"
                      id="accept-tos"
                      checked={tosAccepted}
                      onChange={(e) => setTosAccepted(e.target.checked)}
                    />
                    <label htmlFor="accept-tos">
                      I agree to the{' '}
                      <a href="/terms" style={{ color: 'var(--blue)' }}>Terms</a>
                      {' '}and{' '}
                      <a href="/privacy" style={{ color: 'var(--blue)' }}>Privacy Policy</a>.
                    </label>
                  </div>
                ) : (
                  <div className="form-check">
                    <input type="checkbox" id="remember" />
                    <label htmlFor="remember">Remember me</label>
                  </div>
                )}

                <button type="submit" className="submit-btn" disabled={loading}>
                  {submitLabel}
                </button>
              </form>

              <p className="lf-footer" style={{ marginTop: 12 }}>
                {authMode === 'signup' ? (
                  <>Already have an account? <button type="button" onClick={() => switchAuthMode('signin')} style={{ background: 'none', border: 0, color: 'var(--blue)', cursor: 'pointer', fontWeight: 600, padding: 0 }}>Sign in</button></>
                ) : (
                  <>New here? <button type="button" onClick={() => switchAuthMode('signup')} style={{ background: 'none', border: 0, color: 'var(--blue)', cursor: 'pointer', fontWeight: 600, padding: 0 }}>Create account</button></>
                )}
              </p>
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
