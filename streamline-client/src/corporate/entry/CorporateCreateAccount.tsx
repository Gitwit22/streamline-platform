import { FormEvent, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import "../corporate.css";
import { corporateRegister } from "../api/auth";

export default function CorporateCreateAccount() {
  const nav = useNavigate();
  const location = useLocation();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const inviteToken = useMemo(() => {
    const sp = new URLSearchParams(location.search || "");
    return String(sp.get("inviteToken") || "").trim();
  }, [location.search]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    if (!name.trim() || !email.trim() || !password || !confirmPassword) {
      setError("Please complete all required fields.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (!inviteToken && !companyName.trim()) {
      setError("Company name is required for account setup.");
      return;
    }

    setLoading(true);
    try {
      const payload = await corporateRegister({
        name: name.trim(),
        email: email.trim(),
        password,
        companyName: companyName.trim() || undefined,
        inviteToken: inviteToken || undefined,
      });

      try {
        localStorage.setItem("authToken", payload.token);
        window.dispatchEvent(new CustomEvent("sl:auth-changed"));
      } catch {
        // no-op
      }

      nav("/corporate/dashboard", { replace: true });
    } catch (err: any) {
      setError(String(err?.message || "Account creation failed."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="login-page" className="page active">
      <div className="login-right" style={{ width: "100%" }}>
        <div className="login-form-box" style={{ maxWidth: 560 }}>
          <div className="lf-header">
            <h2 className="lf-title">Create StreamLine Corporate Account</h2>
            <p className="lf-sub">Set up your organization and admin access.</p>
          </div>

          <form onSubmit={handleSubmit}>
            {error ? (
              <div style={{ color: "#f87171", fontSize: 13, marginBottom: 10 }}>{error}</div>
            ) : null}

            <div className="form-group">
              <label className="form-label" htmlFor="corp-name">Full Name</label>
              <div className="input-wrap">
                <input id="corp-name" className="form-input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="corp-email">Work Email</label>
              <div className="input-wrap">
                <input id="corp-email" type="email" className="form-input" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>

            {!inviteToken ? (
              <div className="form-group">
                <label className="form-label" htmlFor="corp-company">Company / Organization</label>
                <div className="input-wrap">
                  <input id="corp-company" className="form-input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
                </div>
              </div>
            ) : null}

            <div className="form-group">
              <label className="form-label" htmlFor="corp-password">Password</label>
              <div className="input-wrap">
                <input id="corp-password" type="password" className="form-input" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="corp-confirm">Confirm Password</label>
              <div className="input-wrap">
                <input id="corp-confirm" type="password" className="form-input" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              </div>
            </div>

            <button className="submit-btn" type="submit" disabled={loading}>
              {loading ? "Creating account..." : "Create account"}
            </button>
          </form>

          <p className="lf-footer-note" style={{ marginTop: 12 }}>
            Already have an account? <Link to="/corporate/login">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
