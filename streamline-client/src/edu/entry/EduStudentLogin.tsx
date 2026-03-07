import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch, clearAuthStorage } from "../../lib/api";
import { firebaseSignInWithCustomToken, isFirebaseWebConfigured } from "../../lib/firebaseClient";
import { setEduLane } from "../state/eduMode";

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function EduStudentLogin() {
  const nav = useNavigate();
  const [schoolCode, setSchoolCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "portal">("login");
  const [portalSlug, setPortalSlug] = useState("");

  useEffect(() => {
    setEduLane();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!schoolCode.trim()) {
      setError("Please enter your school code.");
      setLoading(false);
      return;
    }
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
            body: JSON.stringify({ email, password, schoolCode: schoolCode.trim() }),
          },
          { allowNonOk: true },
        );

        if (!res.ok) {
          if (res.status === 401 || res.status === 403) clearAuthStorage();
          const ct = res.headers.get("content-type") || "";
          const errBody = ct.includes("application/json") ? await res.json().catch(() => ({})) : {};
          setError((errBody as any)?.error || "Invalid credentials");
          setLoading(false);
          return;
        }

        const loginBody: any = await res.json().catch(() => null);
        const token = loginBody?.token as string | undefined;
        if (!token) {
          setError("Login failed: missing token");
          setLoading(false);
          return;
        }
        try { localStorage.setItem("authToken", token); } catch {}
      } else {
        const res = await apiFetch(
          "/api/auth/legacy-login",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
          },
          { allowNonOk: true },
        );

        if (!res.ok) {
          if (res.status === 401 || res.status === 403) clearAuthStorage();
          const ct = res.headers.get("content-type") || "";
          const errBody = ct.includes("application/json") ? await res.json().catch(() => ({})) : {};
          setError((errBody as any)?.error || "Invalid credentials");
          setLoading(false);
          return;
        }

        const payload: any = await res.json().catch(() => null);
        const customToken = String(payload?.customToken || "").trim();
        if (!customToken) {
          setError("Login failed: missing token");
          setLoading(false);
          return;
        }
        try { localStorage.removeItem("authToken"); } catch {}
        await firebaseSignInWithCustomToken(customToken);
      }

      setLoading(false);
      nav("/streamline/edu/student-portal", { replace: true });
    } catch (err: any) {
      setError(err?.message || "Something went wrong.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <style>{`
        @keyframes slEduFadeUp { from{opacity:0; transform:translateY(20px)} to{opacity:1; transform:translateY(0)} }
      `}</style>

      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-[440px]" style={{ animation: "slEduFadeUp 0.8s ease-out" }}>
          {/* Header */}
          <div className="mb-8 flex items-center justify-between">
            <Link to="/streamline/edu/get-started" className="group flex items-center gap-2 text-sm text-slate-400 hover:text-white">
              <svg className="h-[18px] w-[18px] transition-transform group-hover:-translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
              </svg>
              Back
            </Link>
            <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1.5 font-mono text-[11px] tracking-[0.2em] text-blue-300">
              STUDENT
            </span>
          </div>

          {/* Card */}
          <div className="relative overflow-hidden rounded-3xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/60 p-10">
            <div aria-hidden className="absolute left-0 right-0 top-0 h-[3px] bg-gradient-to-r from-blue-500 via-cyan-500 to-violet-500" />

            <h1 className="text-3xl font-bold tracking-tight">Student Login</h1>
            <p className="mt-1 text-sm text-slate-400">
              {mode === "login"
                ? "Sign in with your school credentials."
                : "Go to your school's portal to log in or activate your account."}
            </p>

            {/* Sign In / School Portal toggle */}
            <div className="mt-5 flex rounded-xl border border-slate-700 bg-slate-900 p-1">
              <button
                type="button"
                onClick={() => { setMode("login"); setError(""); }}
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                  mode === "login"
                    ? "bg-gradient-to-r from-blue-500/20 to-cyan-500/20 text-blue-300"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => { setMode("portal"); setError(""); }}
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                  mode === "portal"
                    ? "bg-gradient-to-r from-blue-500/20 to-cyan-500/20 text-blue-300"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                School Portal
              </button>
            </div>

            {error && (
              <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>
            )}

            {mode === "login" ? (
              <>
            {/* Login Form */}
            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-300" htmlFor="stu-code">School Code</label>
                <input
                  id="stu-code"
                  value={schoolCode}
                  onChange={(e) => setSchoolCode(e.target.value)}
                  type="text"
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-5 py-3.5 text-base text-white outline-none placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
                  placeholder="e.g. CENTRAL-HS"
                  autoComplete="off"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300" htmlFor="stu-email">Student Email</label>
                <input
                  id="stu-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-5 py-3.5 text-base text-white outline-none placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
                  placeholder="you@student.school.edu"
                  autoComplete="email"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300" htmlFor="stu-pass">Password</label>
                <input
                  id="stu-pass"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-5 py-3.5 text-base text-white outline-none placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-3.5 text-base font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60"
              >
                {loading ? "Signing in\u2026" : "Sign In"}
              </button>
            </form>

            <p className="mt-6 text-center text-xs text-slate-500">
              Don't have a student account? Ask your teacher or school admin.
            </p>
              </>
            ) : (
              /* ── School portal redirect ──────────────────── */
              <div className="mt-8 space-y-5">
                <div>
                  <label className="block text-sm font-medium text-slate-300" htmlFor="stu-portal-slug">
                    School Portal Name
                  </label>
                  <input
                    id="stu-portal-slug"
                    value={portalSlug}
                    onChange={(e) => setPortalSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-5 py-3.5 text-base text-white outline-none placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
                    placeholder="e.g. nxt-lvl-academy"
                    autoComplete="off"
                  />
                  <p className="mt-1.5 text-xs text-slate-500">
                    Ask your teacher for the school portal name.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={!portalSlug.trim()}
                  onClick={() => nav(`/streamline/edu/portal/${portalSlug.trim()}`)}
                  className="w-full rounded-xl bg-gradient-to-r from-blue-500 via-cyan-500 to-violet-500 px-4 py-3.5 text-base font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  Go to School Portal
                </button>

                <p className="text-center text-xs text-slate-500">
                  Your school's portal has login and account setup options.
                </p>
              </div>
            )}
          </div>

          {/* Staff link */}
          <div className="mt-6 text-center">
            <Link to="/streamline/edu/login" className="text-sm text-slate-400 hover:text-orange-300">
              Staff / Faculty? Sign in here →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
