import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { setEduLane, setEduBypassEnabled } from "../state/eduMode";

export default function EduGetStarted() {
  const nav = useNavigate();

  useEffect(() => {
    setEduLane();
  }, []);

  const handleDemo = () => {
    setEduLane();
    setEduBypassEnabled();
    nav("/streamline/edu/dashboard", { replace: true });
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-900 text-white">
      <style>{`
        @keyframes slEduFadeUp   { from{opacity:0; transform:translateY(20px)} to{opacity:1; transform:translateY(0)} }
        @keyframes slEduFadeRight { from{opacity:0; transform:translateX(-20px)} to{opacity:1; transform:translateX(0)} }
        @keyframes slEduFloat    { 0%,100%{transform:translate(0,0)} 50%{transform:translate(50px,30px)} }
        @keyframes slEduTrainPass { 0%{left:-60px} 100%{left:calc(100% + 60px)} }
      `}</style>

      {/* Floating gradients */}
      <div
        aria-hidden
        className="pointer-events-none fixed -right-48 -top-48 z-0 h-[600px] w-[600px] rounded-full bg-orange-500/20 blur-[120px]"
        style={{ animation: "slEduFloat 15s ease-in-out infinite" }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed -bottom-48 -left-48 z-0 h-[600px] w-[600px] rounded-full bg-violet-600/20 blur-[120px]"
        style={{ animation: "slEduFloat 18s ease-in-out infinite reverse" }}
      />

      <div className="relative z-10 grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
        {/* ── Left Panel — Branding ─────────────────────────────── */}
        <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-b from-slate-900 via-slate-800/80 to-slate-900 p-12 lg:flex">
          {/* Animated track lines */}
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

          <div className="relative z-10 flex w-full flex-col justify-center flex-1">
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
              <li style={{ animation: "slEduFadeRight 0.8s ease-out 0.5s both" }} className="flex items-center gap-4">
                <span className="h-2 w-2 flex-none rounded-full bg-orange-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]" />
                Events, scheduling & countdowns
              </li>
              <li style={{ animation: "slEduFadeRight 0.8s ease-out 0.6s both" }} className="flex items-center gap-4">
                <span className="h-2 w-2 flex-none rounded-full bg-orange-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]" />
                Room-based broadcast management
              </li>
            </ul>

            <div className="mt-16 text-xs text-slate-500" style={{ animation: "slEduFadeRight 1s ease-out 0.7s both" }}>
              Powered by Nxt Lvl Technology Solutions
            </div>
          </div>
        </div>

        {/* ── Right Panel — Login Paths ─────────────────────────── */}
        <div className="relative flex items-center justify-center p-8">
          <div
            aria-hidden
            className="absolute left-0 top-[10%] hidden h-[80%] w-px bg-gradient-to-b from-transparent via-slate-700 to-transparent lg:block"
          />

          <div className="w-full max-w-[440px]" style={{ animation: "slEduFadeUp 0.8s ease-out" }}>
            {/* Mobile logo */}
            <div className="mb-8 lg:hidden">
              <img src="/edu_logo.png" alt="StreamLine EDU" className="h-14 w-auto" />
            </div>

            {/* Back + badge */}
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
                EDU
              </span>
            </div>

            {/* Card */}
            <div className="relative overflow-hidden rounded-3xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/60 p-10">
              <div aria-hidden className="absolute left-0 right-0 top-0 h-[3px] bg-gradient-to-r from-orange-500 via-red-600 to-violet-600" />

              <h1 className="text-3xl font-bold tracking-tight text-white">Get Started</h1>
              <p className="mt-1 text-sm text-slate-400">
                Choose how you'd like to enter StreamLine EDU.
              </p>

              {/* ── Demo CTA (primary) ─────────────────────────────── */}
              <button
                type="button"
                onClick={handleDemo}
                className="group relative mt-8 w-full overflow-hidden rounded-xl bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 px-4 py-4 text-base font-semibold text-white shadow-none transition-transform hover:-translate-y-0.5 hover:shadow-[0_15px_30px_-10px_rgba(245,158,11,0.4)]"
              >
                <span
                  aria-hidden
                  className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-500 group-hover:translate-x-full"
                />
                <span className="relative flex items-center justify-center gap-2">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  Explore Demo
                </span>
              </button>
              <p className="mt-2 text-center text-xs text-slate-500">
                No account needed — browse with sample data, go live, and test every feature.
              </p>

              {/* ── Divider ────────────────────────────────────────── */}
              <div className="my-8 flex items-center gap-3">
                <div className="h-px flex-1 bg-slate-700" />
                <span className="text-xs text-slate-500">or sign in</span>
                <div className="h-px flex-1 bg-slate-700" />
              </div>

              {/* ── Faculty / Admin Sign In ─────────────────────────── */}
              <Link
                to="/streamline/edu/login"
                className="flex w-full items-center gap-4 rounded-xl border border-slate-600 bg-slate-800 px-5 py-4 text-left transition hover:border-slate-500 hover:bg-slate-700"
              >
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-gradient-to-br from-orange-500/20 to-red-600/20 text-orange-400">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                    <polyline points="10 17 15 12 10 7" />
                    <line x1="15" y1="12" x2="3" y2="12" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">Faculty / Admin Sign In</div>
                  <div className="text-xs text-slate-400">Sign in with your school credentials</div>
                </div>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ml-auto h-4 w-4 text-slate-500">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>

              {/* ── Student Sign In ─────────────────────────────────── */}
              <Link
                to="/streamline/edu/student-login"
                className="mt-3 flex w-full items-center gap-4 rounded-xl border border-slate-600 bg-slate-800 px-5 py-4 text-left transition hover:border-slate-500 hover:bg-slate-700"
              >
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/20 to-blue-600/20 text-violet-400">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
                    <path d="M4.26 10.147a60.436 60.436 0 0 0-.491 6.347A48.627 48.627 0 0 1 12 20.904a48.627 48.627 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a23.838 23.838 0 0 0-1.012 5.434 48.677 48.677 0 0 1 6.249 1.263m-5.237-6.697A48.236 48.236 0 0 1 12 4.118a48.18 48.18 0 0 1 7.74 3.029m0 3a23.839 23.839 0 0 1 1.012 5.434 48.677 48.677 0 0 0-6.249 1.263" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">Student Sign In</div>
                  <div className="text-xs text-slate-400">Log in with your school code</div>
                </div>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ml-auto h-4 w-4 text-slate-500">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>

              {/* ── Onboard a School ────────────────────────────────── */}
              <Link
                to="/streamline/edu/onboarding?step=1"
                className="mt-3 flex w-full items-center gap-4 rounded-xl border border-orange-500/20 bg-orange-500/5 px-5 py-4 text-left transition hover:border-orange-500/40 hover:bg-orange-500/10"
              >
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-gradient-to-br from-orange-500/20 to-amber-600/20 text-orange-400">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    <polyline points="9 22 9 12 15 12 15 22" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-semibold text-orange-300">Onboard a School</div>
                  <div className="text-xs text-slate-400">Set up a new school on the platform</div>
                </div>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ml-auto h-4 w-4 text-slate-500">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>

              <p className="mt-6 text-center text-[11px] text-slate-500">
                Tip: If you don't have a school EDU role yet, ask your Faculty Admin.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
