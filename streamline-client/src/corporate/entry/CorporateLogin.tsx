import { FormEvent, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from "react-router-dom";
import '../corporate.css';
import { setCorporateLane } from '../state/corporateMode';
import { corporateLogin } from '../api/auth';
import BrandLogo from '../../components/BrandLogo';

export default function CorporateLogin() {
  const nav = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const payload = await corporateLogin({
        email: email.trim(),
        password,
      });

      try {
        localStorage.setItem('authToken', payload.token);
        window.dispatchEvent(new CustomEvent('sl:auth-changed'));
      } catch {
        // no-op
      }

      setCorporateLane();
      nav(returnTo || '/corporate/dashboard', { replace: true });
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Something went wrong. Try again.');
    } finally {
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
          <BrandLogo className="ll-logo" />
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
            <a href="#">(c) 2026 Nxt Lvl Technology Solutions</a>
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
            <p className="lf-sub">Sign in with your corporate credentials.</p>
          </div>

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
              <label className="form-label" htmlFor="password">Password</label>
              <div className="input-wrap">
                <input
                  type="password"
                  id="password"
                  className="form-input"
                  placeholder="************"
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
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <p className="lf-footer">
            Need access? <a href="mailto:nxtlvl@gmail.com?subject=StreamLine%20Corporate%20Access%20Request">Contact us</a>
            <br />
            New organization? <Link to="/corporate/create-account">Create account</Link>
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
