import { Link } from "react-router-dom";

/* ─── Detailed platform sections ───────────────────────────────── */
const sections = [
  {
    heading: "Live Broadcasting",
    body: "Go live to your entire school district with a single click. StreamLine EDU supports multi-camera switching, screen sharing, pre-recorded media insertion, and real-time talent management — giving your broadcast team full control from one studio dashboard.",
    bullets: [
      "Multi-camera & screen-share with one-click go-live",
      "Pre-recorded media insertion during broadcasts",
      "Talent management for on-air guests and student producers",
      "Automatic HLS delivery for low-latency school-wide viewing",
    ],
    gradient: "from-orange-500 to-red-600",
  },
  {
    heading: "Events & Scheduling",
    body: "Plan and schedule school events — assemblies, ceremonies, sports broadcasts, or daily announcements. Set countdown timers, protect streams with passwords, and let students and parents know exactly when to tune in.",
    bullets: [
      "Event creation with date, time, and description",
      "Countdown displays for upcoming broadcasts",
      "Optional password protection for private events",
      "Auto-publish scheduling for hands-free streaming",
    ],
    gradient: "from-red-600 to-violet-600",
  },
  {
    heading: "Rooms & Organization",
    body: "Organize your broadcasting operation into dedicated rooms — one for morning announcements, another for sports, a third for student projects. Assign staff, manage room-level access, and launch streams from any room.",
    bullets: [
      "Create unlimited broadcast rooms by topic or department",
      "Assign staff and student producers per room",
      "Room-level access controls and permissions",
      "Quick-launch broadcasts from any room",
    ],
    gradient: "from-violet-600 to-blue-500",
  },
  {
    heading: "Media Library & Recordings",
    body: "Every broadcast is automatically recorded and archived. Search, browse, play back, and manage recordings from a single media library — with support for manual uploads too.",
    bullets: [
      "Automatic recording of every live broadcast",
      "Searchable archive with filters and bulk management",
      "In-browser playback with scrubbing and full-screen",
      "Manual media uploads for pre-recorded content",
    ],
    gradient: "from-blue-500 to-cyan-500",
  },
  {
    heading: "Student Portal",
    body: "Students log in with a school code and their credentials to access a curated portal of live streams, upcoming events, recordings, and shared media. Media club members can be promoted to student producers with broadcast access.",
    bullets: [
      "School-code-based student authentication",
      "Live streams, upcoming events, and recordings in one place",
      "Student producer role for hands-on broadcast experience",
      "Safe, school-controlled access — no public exposure",
    ],
    gradient: "from-cyan-500 to-emerald-500",
  },
  {
    heading: "Website Embed",
    body: "Generate a lightweight HLS embed player to place live streams and recordings directly on your school or district website. Parents, community members, and anyone with the link can watch — no login required.",
    bullets: [
      "One-line embed code for any school website",
      "HLS adaptive-bitrate streaming for all devices",
      "Public or password-protected player options",
      "Countdown and event info displayed before go-live",
    ],
    gradient: "from-emerald-500 to-orange-500",
  },
  {
    heading: "People & Role Management",
    body: "Manage your entire school broadcasting team with granular roles. Faculty Admins control settings, Teachers manage rooms and broadcasts, and Student Producers get guided access to go live under supervision.",
    bullets: [
      "Faculty Admin, Teacher, Student Producer, and Student roles",
      "Per-user role assignment and permission control",
      "Staff directory and student list management",
      "Self-serve onboarding with admin approval flow",
    ],
    gradient: "from-orange-500 to-red-600",
  },
];

export default function EduLearnMore() {
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

      <div className="relative z-10 mx-auto max-w-4xl px-6 py-16">
        {/* ── Back ──────────────────────────────────────────────── */}
        <div style={{ animation: "slEduFadeUp 0.6s ease-out" }}>
          <Link
            to="/streamline/edu"
            className="group inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"
          >
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

        {/* ── Header ────────────────────────────────────────────── */}
        <div className="mt-10 text-center" style={{ animation: "slEduFadeUp 0.8s ease-out" }}>
          <span className="inline-block rounded-full border border-orange-500/20 bg-orange-500/10 px-4 py-1.5 font-mono text-[11px] tracking-[0.2em] text-orange-300">
            PLATFORM OVERVIEW
          </span>
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight md:text-5xl">
            Everything your school needs to{" "}
            <span className="bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 bg-clip-text text-transparent">
              broadcast
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-400">
            StreamLine EDU is a secure, all-in-one platform built for K-12 schools and
            districts. Manage live streams, events, recordings, and student access from
            a single dashboard.
          </p>
        </div>

        {/* ── Sections ──────────────────────────────────────────── */}
        <div className="mt-16 space-y-12">
          {sections.map((s, i) => (
            <div
              key={s.heading}
              className="rounded-2xl border border-slate-700/60 bg-slate-800/40 p-8"
              style={{ animation: `slEduFadeUp 0.7s ease-out ${0.1 + i * 0.08}s both` }}
            >
              <h2 className="text-xl font-bold text-white">{s.heading}</h2>
              <div className={`mt-1 h-1 w-16 rounded bg-gradient-to-r ${s.gradient}`} />
              <p className="mt-4 text-sm leading-relaxed text-slate-300">{s.body}</p>
              <ul className="mt-5 grid gap-2 sm:grid-cols-2">
                {s.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2 text-sm text-slate-400">
                    <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-orange-500" />
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* ── Bottom CTA ────────────────────────────────────────── */}
        <div
          className="mt-16 text-center"
          style={{ animation: `slEduFadeUp 0.8s ease-out ${0.1 + sections.length * 0.08}s both` }}
        >
          <Link
            to="/streamline/edu/get-started"
            className="group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 px-10 py-4 text-base font-semibold text-white shadow-none transition-transform hover:-translate-y-0.5 hover:shadow-[0_15px_30px_-10px_rgba(245,158,11,0.4)]"
          >
            <span
              aria-hidden
              className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-500 group-hover:translate-x-full"
            />
            <span className="relative flex items-center gap-2">
              Get Started
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                <path d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </span>
          </Link>
          <p className="mt-3 text-sm text-slate-500">
            Sign in, launch the demo, or onboard your school.
          </p>
        </div>
      </div>
    </div>
  );
}
