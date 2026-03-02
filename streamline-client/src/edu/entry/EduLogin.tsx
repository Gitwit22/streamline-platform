import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { apiFetch, apiFetchAuth, clearAuthStorage } from "../../lib/api";
import { firebaseSendPasswordReset, firebaseSignInWithCustomToken, isFirebaseWebConfigured } from "../../lib/firebaseClient";
import { setEduBypassEnabled, setEduLane } from "../state/eduMode";
import { fetchOnboardingConfig } from "../api/onboarding";

function ModalShell({ title, body, onContinue, onCancel }: { title: string; body: string; onContinue: () => void; onCancel: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" onClick={onCancel} className="absolute inset-0 bg-black/60" aria-label="Close" />
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-900 to-slate-900/40 p-6">
        <div className="text-lg font-semibold text-white">{title}</div>
        <div className="mt-2 text-sm text-slate-300">{body}</div>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-slate-700 bg-slate-900/30 px-4 py-2 text-sm text-slate-200 hover:border-slate-600 hover:bg-slate-800/40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="rounded-xl bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

function validateEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

export default function EduLogin() {
  const nav = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [showOnboardingWarn, setShowOnboardingWarn] = useState(false);
  const [canSelfServeOnboarding, setCanSelfServeOnboarding] = useState(false);

  const canShowBypass = useMemo(() => {
    if (import.meta.env.DEV) return true;
    try {
      const host = String(window.location.hostname || "").toLowerCase();
      return host === "localhost" || host === "127.0.0.1";
    } catch {
      return false;
    }
  }, []);

  const returnTo = useMemo(() => {
    try {
      const sp = new URLSearchParams(location.search || "");
      const rt = sp.get("returnTo") || "";
      if (!rt) return null;
      if (!rt.startsWith("/")) return null;
      if (rt.startsWith("//")) return null;
      return rt;
    } catch {
      return null;
    }
  }, [location.search]);

  useEffect(() => {
    setEduLane();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Default to hidden unless explicitly enabled (or dev/localhost).
        const isDevOrLocal = import.meta.env.DEV;
        const cfg = await fetchOnboardingConfig().catch(() => null);
        const allow = !!cfg?.systemState?.allowSelfServeOrgCreation;
        if (!cancelled) setCanSelfServeOnboarding(isDevOrLocal || allow);
      } catch {
        if (!cancelled) setCanSelfServeOnboarding(!!import.meta.env.DEV);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!validateEmail(email)) {
      setError("Please enter a valid email address.");
      setLoading(false);
      return;
    }

    try {
      if (!isFirebaseWebConfigured()) {
        const res = await apiFetch(
          "/api/auth/login",
          {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
          },
          { allowNonOk: true }
        );

        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            clearAuthStorage();
          }
          const ct = res.headers.get("content-type") || "";
          const errBody = ct.includes("application/json") ? await res.json().catch(() => ({})) : {};
          setError((errBody as any)?.error || "Invalid credentials");
          setLoading(false);
          return;
        }

        let loginBody: any = null;
        try {
          const ctLogin = res.headers.get("content-type") || "";
          loginBody = ctLogin.includes("application/json") ? await res.json() : null;
        } catch {
          loginBody = null;
        }

        const token = (loginBody as any)?.token as string | undefined;
        if (!token) {
          clearAuthStorage();
          setError("Login failed: missing token from server");
          setLoading(false);
          return;
        }

        try {
          localStorage.setItem("authToken", token);
        } catch {}
      } else {
        const res = await apiFetch(
          "/api/auth/legacy-login",
          {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
          },
          { allowNonOk: true }
        );

        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            clearAuthStorage();
          }
          const ct = res.headers.get("content-type") || "";
          const errBody = ct.includes("application/json") ? await res.json().catch(() => ({})) : {};
          const msg = (errBody as any)?.error || (res.status === 409 ? "Email conflict. Contact support." : "Invalid credentials");
          setError(msg);
          setLoading(false);
          return;
        }

        const payload = await res.json().catch(() => null as any);
        const customToken = String(payload?.customToken || "").trim();
        if (!customToken) {
          setError("Login failed: missing customToken");
          setLoading(false);
          return;
        }

        try {
          localStorage.removeItem("authToken");
        } catch {}

        await firebaseSignInWithCustomToken(customToken);
      }

      // Hydrate canonical /api/account/me; this is also what EDU route guards use.
      try {
        await apiFetchAuth("/api/account/me", { cache: "no-store" });
      } catch {
        // ignore
      }

      setLoading(false);
      nav(returnTo || "/streamline/edu/dashboard", { replace: true });
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Something went wrong. Try again.");
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setError("");
    if (!isFirebaseWebConfigured()) {
      setError("Password reset isn't available yet (Firebase not configured). Contact your admin.");
      return;
    }
    const emailNorm = String(email || "").trim().toLowerCase();
    if (!validateEmail(emailNorm)) {
      setError("Enter your email above, then click Forgot password.");
      return;
    }
    try {
      const continueUrl = String(import.meta.env.VITE_FIREBASE_CONTINUE_URL || "").trim();
      const actionCodeSettings = continueUrl
        ? { url: continueUrl, handleCodeInApp: false }
        : { url: window.location.origin + "/streamline/edu/login", handleCodeInApp: false };
      await firebaseSendPasswordReset(emailNorm, actionCodeSettings as any);
      setError("Password reset email sent (check your inbox).");
    } catch (err: any) {
      setError(String(err?.code || err?.message || "reset_failed"));
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <style>{`
        @keyframes slEduAmbientShift { 0%,100% { transform: translate(0,0) rotate(0deg) } 50% { transform: translate(2%,2%) rotate(1deg) } }
        @keyframes slEduTrainPass { 0% { left: -80px; opacity: 0 } 5% { opacity: 1 } 95% { opacity: 1 } 100% { left: calc(100% + 80px); opacity: 0 } }
        @keyframes slEduFadeRight { from { opacity: 0; transform: translateX(-30px) } to { opacity: 1; transform: translateX(0) } }
        @keyframes slEduFadeUp { from { opacity: 0; transform: translateY(30px) } to { opacity: 1; transform: translateY(0) } }
      `}</style>

      <div className="mx-auto grid min-h-screen max-w-6xl grid-cols-1 lg:grid-cols-2 overflow-hidden">
        {/* Left Panel - Branding */}
        <div className="relative hidden bg-slate-900 p-16 lg:flex" style={{ backgroundColor: "rgba(19, 28, 46, 1)" }}>
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse at 20% 30%, rgba(245, 158, 11, 0.08) 0%, transparent 50%), radial-gradient(ellipse at 80% 70%, rgba(124, 58, 237, 0.06) 0%, transparent 50%)",
              animation: "slEduAmbientShift 20s ease-in-out infinite",
            }}
          />

          {/* Tracks */}
          <div aria-hidden className="absolute inset-0 overflow-hidden opacity-40">
            {[20, 35, 50, 65, 80].map((topPct, idx) => (
              <div
                key={topPct}
                className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-slate-600 to-transparent"
                style={{ top: `${topPct}%` }}
              >
                <div
                  className="absolute top-[-1px] h-[3px] w-[60px] rounded bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 shadow-[0_0_20px_rgba(245,158,11,0.5)]"
                  style={{
                    animation: "slEduTrainPass 8s linear infinite",
                    animationDelay: idx === 0 ? "0s" : idx === 1 ? "1.5s" : idx === 2 ? "3s" : idx === 3 ? "0.5s" : "2s",
                    animationDuration: idx === 0 ? "8s" : idx === 1 ? "6s" : idx === 2 ? "7s" : idx === 3 ? "9s" : "5s",
                  }}
                />
              </div>
            ))}
          </div>

          <div className="relative z-10 flex w-full flex-col justify-center">
            <div className="mb-12" style={{ animation: "slEduFadeRight 0.8s ease-out" }}>
              <img src="/edu_logo.png" alt="StreamLine EDU" className="h-20 w-auto" />
            </div>

            <h1
              className="text-4xl font-bold tracking-tight"
              style={{ animation: "slEduFadeRight 0.8s ease-out 0.1s both" }}
            >
              School-safe
              <br />
              <span className="bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 bg-clip-text text-transparent">
                broadcasting
              </span>
            </h1>

            <ul className="mt-10 space-y-4 text-base text-slate-300">
              <li style={{ animation: "slEduFadeRight 0.8s ease-out 0.2s both" }} className="flex items-center gap-4">
                <span className="h-2 w-2 flex-none rounded-full bg-orange-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]" />
                HLS embed for school websites
              </li>
              <li style={{ animation: "slEduFadeRight 0.8s ease-out 0.3s both" }} className="flex items-center gap-4">
                <span className="h-2 w-2 flex-none rounded-full bg-orange-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]" />
                Role-based access (Faculty / Students)
              </li>
              <li style={{ animation: "slEduFadeRight 0.8s ease-out 0.4s both" }} className="flex items-center gap-4">
                <span className="h-2 w-2 flex-none rounded-full bg-orange-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]" />
                Automatic recording archive
              </li>
            </ul>

            <div className="mt-16 text-xs text-slate-500" style={{ animation: "slEduFadeRight 1s ease-out 0.6s both" }}>
              Powered by Nxt Lvl Technology Solutions
            </div>
          </div>
        </div>

        {/* Right Panel - Login Form */}
        <div className="relative flex items-center justify-center p-8">
          <div
            aria-hidden
            className="absolute left-0 top-[10%] hidden h-[80%] w-px bg-gradient-to-b from-transparent via-slate-700 to-transparent lg:block"
          />

          <div className="w-full max-w-[420px]" style={{ animation: "slEduFadeUp 0.8s ease-out" }}>
            <div className="mb-8 lg:hidden">
              <img src="/edu_logo.png" alt="StreamLine EDU" className="h-14 w-auto" />
            </div>

            <div className="mb-8 flex items-center justify-between">
              <Link to="/streamline/edu" className="group flex items-center gap-2 text-sm text-slate-400 hover:text-white">
                <svg
                  className="h-[18px] w-[18px] transition-transform group-hover:-translate-x-0.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M19 12H5" />
                  <path d="M12 19l-7-7 7-7" />
                </svg>
                Back
              </Link>

              <span className="rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1.5 font-mono text-[11px] tracking-[0.2em] text-orange-300">
                EDU LOGIN
              </span>
            </div>

            <div className="relative overflow-hidden rounded-3xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/60 p-10">
              <div aria-hidden className="absolute left-0 right-0 top-0 h-[3px] bg-gradient-to-r from-orange-500 via-red-600 to-violet-600" />

              <h1 className="text-3xl font-bold tracking-tight text-white">Sign in</h1>
              <div className="mt-1 text-sm text-slate-400">Faculty / Student access</div>

              {error && (
                <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-8">
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-300" htmlFor="edu-email">
                      Email
                    </label>
                    <input
                      id="edu-email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      type="email"
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-5 py-4 text-base text-white outline-none placeholder:text-slate-500 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/10"
                      placeholder="you@school.edu"
                      autoComplete="email"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300" htmlFor="edu-password">
                      Password
                    </label>
                    <input
                      id="edu-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      type="password"
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-5 py-4 text-base text-white outline-none placeholder:text-slate-500 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/10"
                      placeholder="••••••••"
                      autoComplete="current-password"
                    />

                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={handleForgotPassword}
                        disabled={loading || !isFirebaseWebConfigured()}
                        className="text-xs text-slate-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-slate-400"
                      >
                        Forgot password?
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="group relative w-full overflow-hidden rounded-xl bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 px-4 py-4 text-base font-semibold text-white shadow-none transition-transform hover:-translate-y-0.5 hover:shadow-[0_15px_30px_-10px_rgba(245,158,11,0.4)] disabled:opacity-60"
                  >
                    <span
                      aria-hidden
                      className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-500 group-hover:translate-x-full"
                    />
                    <span className="relative">{loading ? "Signing in…" : "Sign In"}</span>
                  </button>
                </div>

                <p className="mt-6 border-t border-slate-700 pt-6 text-center text-xs text-slate-500">
                  Tip: If you don’t have a school EDU role yet, ask your Faculty Admin.
                </p>
              </form>

              {canSelfServeOnboarding ? (
                <div className="mt-6">
                  <button
                    type="button"
                    onClick={() => setShowOnboardingWarn(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/30 px-4 py-3.5 text-sm font-medium text-slate-200 hover:border-slate-600 hover:bg-slate-800/40"
                  >
                    Set up a new school
                  </button>
                  <div className="mt-2 text-center text-[11px] text-slate-500">
                    Controlled provisioning: may require platform approval.
                  </div>
                </div>
              ) : null}

              {canShowBypass ? (
                <>
                  <div className="my-6 flex items-center gap-4">
                    <div className="h-px flex-1 bg-slate-700" />
                    <div className="text-[11px] font-semibold tracking-[0.2em] text-slate-500">OR</div>
                    <div className="h-px flex-1 bg-slate-700" />
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setEduBypassEnabled();
                      nav("/streamline/edu/dashboard", { replace: true });
                    }}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-600 bg-transparent px-4 py-3.5 text-sm font-medium text-slate-300 hover:border-slate-500 hover:bg-slate-800 hover:text-white"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[18px] w-[18px]">
                      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                      <polyline points="10 17 15 12 10 7" />
                      <line x1="15" y1="12" x2="3" y2="12" />
                    </svg>
                    Bypass login (demo admin)
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {showOnboardingWarn ? (
        <ModalShell
          title="Initialize a new school"
          body="This will clear demo data and initialize a new school. This action is tenant-scoped (no global wipes)."
          onCancel={() => setShowOnboardingWarn(false)}
          onContinue={() => {
            setShowOnboardingWarn(false);
            nav("/streamline/edu/onboarding?step=1");
          }}
        />
      ) : null}
    </div>
  );
}
