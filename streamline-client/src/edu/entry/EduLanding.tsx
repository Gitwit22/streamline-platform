import { useEffect } from "react";
import { Link } from "react-router-dom";
import { setEduLane } from "../state/eduMode";

/* ── Feature data for the showcase grid ─────────────────────────── */
const features = [
  {
    title: "Broadcast Studio",
    desc: "Go live to your entire school with one click — multi-camera, screen-share, and pre-recorded media support.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-7 w-7">
        <path d="M15.75 10.5l4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9A2.25 2.25 0 0 0 13.5 5.25h-9A2.25 2.25 0 0 0 2.25 7.5v9A2.25 2.25 0 0 0 4.5 18.75z" />
      </svg>
    ),
  },
  {
    title: "Events & Scheduling",
    desc: "Create and manage upcoming events with countdowns, password protection, and auto-publish scheduling.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-7 w-7">
        <path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
      </svg>
    ),
  },
  {
    title: "Room Management",
    desc: "Organize broadcasts into dedicated rooms — assign staff, manage access, and launch streams from any room.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-7 w-7">
        <path d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
      </svg>
    ),
  },
  {
    title: "Media Library",
    desc: "Automatic recording archive with search, playback, and bulk management for every broadcast and upload.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-7 w-7">
        <path d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 0 1-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-2.625 0V5.625m0 12.75v-12.75m18 12.75V5.625m0 12.75h-1.5c-.621 0-1.125-.504-1.125-1.125m2.625 0h.375a.375.375 0 0 0 .375-.375V5.625m-21 0H2.25a.375.375 0 0 1 .375.375v12.75M21.75 5.625H21a.375.375 0 0 0-.375.375v12.75m-17.25-12.75h17.25" />
      </svg>
    ),
  },
  {
    title: "Student Portal",
    desc: "Students log in with a school code to watch live streams, view recordings, and access shared media.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-7 w-7">
        <path d="M4.26 10.147a60.436 60.436 0 0 0-.491 6.347A48.627 48.627 0 0 1 12 20.904a48.627 48.627 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a23.838 23.838 0 0 0-1.012 5.434 48.677 48.677 0 0 1 6.249 1.263m-5.237-6.697A48.236 48.236 0 0 1 12 4.118a48.18 48.18 0 0 1 7.74 3.029m0 3a23.839 23.839 0 0 1 1.012 5.434 48.677 48.677 0 0 0-6.249 1.263M12 2.25l.056.012.08.018" />
      </svg>
    ),
  },
  {
    title: "Website Embed",
    desc: "Generate an HLS embed player for your school website — live streams and recordings accessible to anyone.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-7 w-7">
        <path d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
      </svg>
    ),
  },
  {
    title: "People & Roles",
    desc: "Manage staff and students with role-based access — Faculty Admins, Teachers, and Student Producers.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-7 w-7">
        <path d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0z" />
      </svg>
    ),
  },
  {
    title: "Admin Settings",
    desc: "School-level configuration — org details, storage quotas, audit logs, and platform administration.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-7 w-7">
        <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 0 1 0 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
        <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
      </svg>
    ),
  },
];

export default function EduLanding() {
  useEffect(() => {
    setEduLane();
  }, []);

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

      <div className="relative z-10 flex min-h-screen flex-col items-center px-6 py-16">
        {/* ── Back to lane selector ─────────────────────────────── */}
        <div className="w-full max-w-5xl" style={{ animation: "slEduFadeUp 0.6s ease-out" }}>
          <Link to="/" className="group inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
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
        </div>

        {/* ── Hero ──────────────────────────────────────────────── */}
        <div className="mt-12 text-center" style={{ animation: "slEduFadeUp 0.8s ease-out" }}>
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
          <p className="mx-auto mt-3 max-w-lg text-lg text-slate-400">
            The all-in-one school broadcasting platform — live streams, events,
            recordings, and role-based access for faculty and students.
          </p>
        </div>

        {/* ── Primary CTAs ─────────────────────────────────────── */}
        <div
          className="mt-10 flex flex-col items-center gap-4 sm:flex-row"
          style={{ animation: "slEduFadeUp 0.8s ease-out 0.15s both" }}
        >
          {/* Get Started */}
          <Link
            to="/streamline/edu/get-started"
            className="group relative w-64 overflow-hidden rounded-xl bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 px-8 py-4 text-center text-base font-semibold text-white shadow-none transition-transform hover:-translate-y-0.5 hover:shadow-[0_15px_30px_-10px_rgba(245,158,11,0.4)]"
          >
            <span
              aria-hidden
              className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-500 group-hover:translate-x-full"
            />
            <span className="relative flex items-center justify-center gap-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                <path d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
              Get Started
            </span>
          </Link>

          {/* Learn More */}
          <Link
            to="/streamline/edu/learn-more"
            className="flex w-64 items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-800 px-8 py-4 text-base font-semibold text-white transition hover:bg-slate-700"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path d="M11.25 11.25l.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            Learn More
          </Link>

        </div>

        {/* ── Feature Grid ─────────────────────────────────────── */}
        <div
          className="mt-16 grid w-full max-w-5xl grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4"
          style={{ animation: "slEduFadeUp 0.8s ease-out 0.35s both" }}
        >
          {features.map((f) => (
            <div
              key={f.title}
              className="group rounded-2xl border border-slate-700/60 bg-slate-800/50 p-6 transition hover:border-orange-500/30 hover:bg-slate-800"
            >
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500/20 to-violet-600/20 text-orange-400 transition group-hover:from-orange-500/30 group-hover:to-violet-600/30">
                {f.icon}
              </div>
              <h3 className="text-sm font-semibold text-white">{f.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{f.desc}</p>
            </div>
          ))}
        </div>

        {/* ── Footer links ─────────────────────────────────────── */}
        <div className="mt-16 text-center" style={{ animation: "slEduFadeUp 0.8s ease-out 0.5s both" }}>
          <p className="text-xs text-slate-600">
            Powered by Nxt Lvl Technology Solutions
          </p>
        </div>
      </div>
    </div>
  );
}
