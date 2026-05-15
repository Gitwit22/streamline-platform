import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import "../corporate.css";
import { acceptCorporateInvite, validateCorporateInvite } from "../api/invites";
import { corporateLogin } from "../api/auth";

export default function CorporateInviteAccept() {
  const nav = useNavigate();
  const params = useParams();
  const token = String(params.token || "").trim();

  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [inviteInfo, setInviteInfo] = useState<any>(null);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    validateCorporateInvite(token)
      .then((data) => {
        if (!mounted) return;
        setInviteInfo(data);
        setEmail(String(data?.invite?.invitedEmail || ""));
      })
      .catch((err: any) => {
        if (!mounted) return;
        setError(String(err?.message || "Unable to validate invite."));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [token]);

  const handleCreateAndAccept = async (event: FormEvent) => {
    event.preventDefault();
    setAccepting(true);
    setError("");
    try {
      await acceptCorporateInvite({ token, name, email, password });
      const login = await corporateLogin({ email, password });
      try {
        localStorage.setItem("authToken", login.token);
        window.dispatchEvent(new CustomEvent("sl:auth-changed"));
      } catch {
        // no-op
      }
      nav("/corporate/dashboard", { replace: true });
    } catch (err: any) {
      setError(String(err?.message || "Could not accept invite."));
    } finally {
      setAccepting(false);
    }
  };

  const handleAcceptForLoggedInUser = async () => {
    setAccepting(true);
    setError("");
    try {
      await acceptCorporateInvite({ token });
      nav("/corporate/dashboard", { replace: true });
    } catch (err: any) {
      setError(String(err?.message || "Could not accept invite."));
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div id="login-page" className="page active">
      <div className="login-right" style={{ width: "100%" }}>
        <div className="login-form-box" style={{ maxWidth: 560 }}>
          <div className="lf-header">
            <h2 className="lf-title">Corporate Invite</h2>
            <p className="lf-sub">Join your StreamLine Corporate account.</p>
          </div>

          {loading ? <p>Validating invite...</p> : null}

          {!loading && inviteInfo?.usable ? (
            <>
              <div style={{ marginBottom: 14, fontSize: 14 }}>
                <div><strong>Organization:</strong> {inviteInfo.invite.corporateAccountName}</div>
                <div><strong>Role:</strong> {inviteInfo.invite.invitedRole}</div>
                <div><strong>Email:</strong> {inviteInfo.invite.invitedEmail}</div>
              </div>

              {error ? <div style={{ color: "#f87171", marginBottom: 10 }}>{error}</div> : null}

              <form onSubmit={handleCreateAndAccept}>
                <div className="form-group">
                  <label className="form-label" htmlFor="invite-name">Full Name</label>
                  <div className="input-wrap">
                    <input id="invite-name" className="form-input" value={name} onChange={(e) => setName(e.target.value)} required />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="invite-email">Email</label>
                  <div className="input-wrap">
                    <input id="invite-email" type="email" className="form-input" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="invite-password">Password</label>
                  <div className="input-wrap">
                    <input id="invite-password" type="password" className="form-input" value={password} onChange={(e) => setPassword(e.target.value)} required />
                  </div>
                </div>

                <button className="submit-btn" type="submit" disabled={accepting}>
                  {accepting ? "Accepting..." : "Create account and accept invite"}
                </button>
              </form>

              <div style={{ marginTop: 12 }}>
                <button className="submit-btn" type="button" onClick={handleAcceptForLoggedInUser} disabled={accepting}>
                  Accept invite as logged-in user
                </button>
              </div>
            </>
          ) : null}

          {!loading && !inviteInfo?.usable ? (
            <div>
              <p style={{ color: "#f87171" }}>This invite is not usable.</p>
              <p>Status: {inviteInfo?.status || "unknown"}</p>
            </div>
          ) : null}

          {error && !inviteInfo?.usable ? <div style={{ color: "#f87171" }}>{error}</div> : null}

          <p className="lf-footer-note" style={{ marginTop: 12 }}>
            <Link to="/corporate/login">Back to sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
