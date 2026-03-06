import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { setEduLane, setEduBypassEnabled } from "../state/eduMode";

export default function EduLanding() {
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
        @keyframes slEduFadeUp { from{opacity:0; transform:translateY(20px)} to{opacity:1; transform:translateY(0)} }
        @keyframes slEduFloat { 0%,100%{transform:translate(0,0)} 50%{transform:translate(50px,30px)} }
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

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6">
        {/* Logo + Title */}
        <div className="text-center" style={{ animation: "slEduFadeUp 0.8s ease-out" }}>
          <img
            src="/edu_logo.png"
            alt="StreamLine EDU"
            className="mx-auto mb-6 h-[80px] w-auto object-contain"
          />
          <h1 className="text-4xl font-extrabold tracking-tight md:text-5xl">
            StreamLine{" "}
            <span className="bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 bg-clip-text text-transparent">
              EDU
            </span>
          </h1>
          <p className="mx-auto mt-3 max-w-md text-lg text-slate-400">
            Secure broadcasting for schools — announcements, events, and recordings.
          </p>
        </div>

        {/* Action Buttons */}
        <div
          className="mt-12 flex flex-col items-center gap-4 sm:flex-row"
          style={{ animation: "slEduFadeUp 0.8s ease-out 0.2s both" }}
        >
          {/* Launch Demo */}
          <button
            type="button"
            onClick={handleDemo}
            className="group relative w-64 overflow-hidden rounded-xl bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 px-8 py-4 text-base font-semibold text-white shadow-none transition-transform hover:-translate-y-0.5 hover:shadow-[0_15px_30px_-10px_rgba(245,158,11,0.4)]"
          >
            <span
              aria-hidden
              className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-500 group-hover:translate-x-full"
            />
            <span className="relative flex items-center justify-center gap-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Launch Demo
            </span>
          </button>

          {/* Sign In */}
          <Link
            to="/streamline/edu/login"
            className="flex w-64 items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-800 px-8 py-4 text-base font-semibold text-white transition hover:bg-slate-700"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="15" y1="12" x2="3" y2="12" />
            </svg>
            Sign In
          </Link>

          {/* Onboard a School */}
          <Link
            to="/streamline/edu/onboarding?step=1"
            className="flex w-64 items-center justify-center gap-2 rounded-xl border border-orange-500/30 bg-orange-500/10 px-8 py-4 text-base font-semibold text-orange-300 transition hover:bg-orange-500/20"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            Onboard a School
          </Link>
        </div>

        {/* Demo helper text */}
        <p
          className="mt-4 max-w-sm text-center text-sm text-slate-500"
          style={{ animation: "slEduFadeUp 0.8s ease-out 0.35s both" }}
        >
          Explore the platform with sample school data.<br />
          All changes reset when the session ends.
        </p>

        {/* Student Login link */}
        <div className="mt-10" style={{ animation: "slEduFadeUp 0.8s ease-out 0.5s both" }}>
          <Link
            to="/streamline/edu/student-login"
            className="text-sm text-slate-400 hover:text-orange-300"
          >
            Student? Log in here →
          </Link>
        </div>

        {/* Back to main platform */}
        <div className="mt-4" style={{ animation: "slEduFadeUp 0.8s ease-out 0.6s both" }}>
          <Link to="/" className="text-xs text-slate-500 hover:text-slate-300">
            Not an EDU organization? Continue to the main platform. →
          </Link>
        </div>
      </div>
    </div>
  );
}
