import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useAuthMe } from "../../hooks/useAuthMe";
import { setEduLane } from "../state/eduMode";

export default function EduLanding() {
  const { user } = useAuthMe();

  useEffect(() => {
    setEduLane();
  }, []);

  const pilotHref = useMemo(() => {
    const subject = "StreamLine EDU Pilot";
    const email = typeof user?.email === "string" ? user.email.trim() : "";
    const bodyLines = [
      "Hi StreamLine team,",
      "",
      "I’d like to request an EDU pilot.",
      "",
      `My email: ${email || ""}`,
      "",
      "School / Organization:",
      "",
      "Notes:",
      "",
    ];

    const qs = new URLSearchParams();
    qs.set("subject", subject);
    qs.set("body", bodyLines.join("\n"));
    return `mailto:nxtlvl@gmail.com?${qs.toString()}`;
  }, [user?.email]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-900 text-white">
      <style>{`
        @keyframes slEduTrackPulse { 0%,100%{opacity:.10} 50%{opacity:.40} }
        @keyframes slEduSpeedLine {
          0% { transform: translateX(-100%); opacity: 0; }
          10% { opacity: .8; }
          90% { opacity: .8; }
          100% { transform: translateX(calc(100vw + 100%)); opacity: 0; }
        }
        @keyframes slEduFadeDown { from{opacity:0; transform:translateY(-20px)} to{opacity:1; transform:translateY(0)} }
        @keyframes slEduFadeUp { from{opacity:0; transform:translateY(20px)} to{opacity:1; transform:translateY(0)} }
        @keyframes slEduFloat { 0%,100%{transform:translate(0,0)} 50%{transform:translate(50px,30px)} }
        @keyframes slEduTrainMove { 0%{right:-300px} 100%{right:calc(100% + 300px)} }
      `}</style>

      {/* Background canvas */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <div
          className="absolute top-[20%] h-[2px] w-full bg-gradient-to-r from-transparent via-slate-700/60 to-transparent"
          style={{ animation: "slEduTrackPulse 8s ease-in-out infinite" }}
        />
        <div
          className="absolute top-[40%] h-[2px] w-full bg-gradient-to-r from-transparent via-slate-700/60 to-transparent"
          style={{ animation: "slEduTrackPulse 8s ease-in-out infinite 2s" }}
        />
        <div
          className="absolute top-[60%] h-[2px] w-full bg-gradient-to-r from-transparent via-slate-700/60 to-transparent"
          style={{ animation: "slEduTrackPulse 8s ease-in-out infinite 4s" }}
        />
        <div
          className="absolute top-[80%] h-[2px] w-full bg-gradient-to-r from-transparent via-slate-700/60 to-transparent"
          style={{ animation: "slEduTrackPulse 8s ease-in-out infinite 6s" }}
        />

        <div
          className="absolute left-0 h-[2px] w-[100px] bg-gradient-to-r from-transparent via-orange-400 to-transparent opacity-0"
          style={{ top: "25%", animation: "slEduSpeedLine 3s linear infinite", animationDelay: "0s" }}
        />
        <div
          className="absolute left-0 h-[2px] w-[100px] bg-gradient-to-r from-transparent via-orange-400 to-transparent opacity-0"
          style={{ top: "45%", animation: "slEduSpeedLine 3s linear infinite", animationDelay: "1.5s" }}
        />
        <div
          className="absolute left-0 h-[2px] w-[100px] bg-gradient-to-r from-transparent via-orange-400 to-transparent opacity-0"
          style={{ top: "65%", animation: "slEduSpeedLine 3s linear infinite", animationDelay: "3s" }}
        />
        <div
          className="absolute left-0 h-[2px] w-[100px] bg-gradient-to-r from-transparent via-orange-400 to-transparent opacity-0"
          style={{ top: "85%", animation: "slEduSpeedLine 3s linear infinite", animationDelay: "4.5s" }}
        />
      </div>

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

      <div className="relative z-10 mx-auto max-w-[1400px] px-6">
        {/* Header */}
        <header
          className="flex items-center justify-between py-6"
          style={{ animation: "slEduFadeDown 0.8s ease-out" }}
        >
          <div className="flex items-center">
            <img src="/edu_logo.png" alt="StreamLine EDU" className="h-[70px] w-auto object-contain" />
          </div>

          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="inline-flex items-center rounded-full border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white"
            >
              Main StreamLine
            </Link>

            <div className="hidden items-center gap-2 rounded-full border border-slate-700 bg-slate-800 px-5 py-2.5 text-sm text-slate-300 md:flex">
              <span className="h-2 w-2 rounded-full bg-orange-500" style={{ animation: "slEduTrackPulse 2s ease-in-out infinite" }} />
              <span>EDU Lane</span>
              <span className="text-slate-500">•</span>
              <span>Login required</span>
            </div>
          </div>
        </header>

        {/* Hero */}
        <section className="relative py-24 pb-16 text-center">
          <div
            aria-hidden
            className="absolute right-[-100px] top-1/2 hidden h-[60px] w-[200px] -translate-y-1/2 rounded-[10px] bg-gradient-to-r from-orange-600 to-orange-400 opacity-10 md:block"
            style={{ animation: "slEduTrainMove 20s linear infinite" }}
          />

          <div
            className="mx-auto inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-4 py-2 font-mono text-xs text-orange-300"
            style={{ animation: "slEduFadeUp 0.8s ease-out 0.2s both" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            <span>BUILT FOR EDUCATION</span>
          </div>

          <h1
            className="mx-auto mt-8 max-w-4xl text-5xl font-extrabold leading-[0.95] tracking-tight md:text-7xl"
            style={{ animation: "slEduFadeUp 0.8s ease-out 0.3s both" }}
          >
            Broadcasting
            <br />
            <span className="bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 bg-clip-text text-transparent">
              for schools.
            </span>
          </h1>

          <p
            className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-400"
            style={{ animation: "slEduFadeUp 0.8s ease-out 0.4s both" }}
          >
            Secure streaming for announcements, events, and recordings — designed for school workflows.
          </p>

          <div
            className="mt-10 flex flex-wrap items-center justify-center gap-4"
            style={{ animation: "slEduFadeUp 0.8s ease-out 0.5s both" }}
          >
            <Link
              to="/streamline/edu/login"
              className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 px-8 py-4 text-base font-semibold text-white"
            >
              <span>Get Started</span>
              <svg
                className="h-5 w-5 transition-transform group-hover:translate-x-1"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M5 12h14" />
                <path d="M12 5l7 7-7 7" />
              </svg>
            </Link>


          </div>
        </section>

        {/* Features */}
        <section id="features" className="py-16">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div
              className="group relative overflow-hidden rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-8"
              style={{ animation: "slEduFadeUp 0.8s ease-out 0.6s both" }}
            >
              <div className="absolute left-0 right-0 top-0 h-[3px] origin-left scale-x-0 bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 transition-transform duration-300 group-hover:scale-x-100" />
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-300">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-7 w-7">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                </svg>
              </div>
              <h3 className="text-xl font-bold">Announcements</h3>
              <p className="mt-3 text-sm leading-relaxed text-slate-400">
                Go live with daily broadcasts and time-sensitive messages. Reach your entire campus instantly.
              </p>
            </div>

            <div
              className="group relative overflow-hidden rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-8"
              style={{ animation: "slEduFadeUp 0.8s ease-out 0.7s both" }}
            >
              <div className="absolute left-0 right-0 top-0 h-[3px] origin-left scale-x-0 bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 transition-transform duration-300 group-hover:scale-x-100" />
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-300">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-7 w-7">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <h3 className="text-xl font-bold">Events</h3>
              <p className="mt-3 text-sm leading-relaxed text-slate-400">
                Stream concerts, sports, graduations, and assemblies. Share special moments with your community.
              </p>
            </div>

            <div
              className="group relative overflow-hidden rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-8"
              style={{ animation: "slEduFadeUp 0.8s ease-out 0.8s both" }}
            >
              <div className="absolute left-0 right-0 top-0 h-[3px] origin-left scale-x-0 bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 transition-transform duration-300 group-hover:scale-x-100" />
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-300">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-7 w-7">
                  <circle cx="12" cy="12" r="10" />
                  <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
                </svg>
              </div>
              <h3 className="text-xl font-bold">Recordings</h3>
              <p className="mt-3 text-sm leading-relaxed text-slate-400">
                Archive broadcasts and share with your community. Build a library of school memories.
              </p>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-16">
          <div className="mb-12 text-center">
            <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-orange-500/20 bg-orange-500/5 px-4 py-2 font-mono text-xs text-orange-300">
              HOW IT WORKS
            </div>
            <h2 className="mt-6 text-3xl font-extrabold md:text-4xl">
              From set-up to <span className="bg-gradient-to-r from-orange-500 to-red-600 bg-clip-text text-transparent">go-live</span> in minutes.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-slate-400">
              StreamLine EDU is designed so any staff member can start a broadcast—no AV background required.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            {[
              { step: "01", title: "Create a Room", desc: "A faculty admin opens a new room, sets a title, and chooses who can produce (teachers, staff, student AV club)." },
              { step: "02", title: "Go Live", desc: "Producers join from any browser—no app install. Add cameras, screen-shares, or overlays with one click." },
              { step: "03", title: "Watch Anywhere", desc: "Viewers tune in via an embed on your school site or a direct link. HLS streaming means it works on every device." },
            ].map((item) => (
              <div key={item.step} className="relative rounded-2xl border border-slate-700 bg-slate-800/60 p-8">
                <span className="absolute -top-4 left-6 rounded-full bg-gradient-to-r from-orange-500 to-red-600 px-3 py-1 text-xs font-bold">{item.step}</span>
                <h3 className="mt-2 text-lg font-bold">{item.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-400">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Role-Based Access */}
        <section className="py-16">
          <div className="grid items-center gap-12 md:grid-cols-2">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-orange-500/20 bg-orange-500/5 px-4 py-2 font-mono text-xs text-orange-300">
                PERMISSIONS
              </div>
              <h2 className="mt-6 text-3xl font-extrabold md:text-4xl">
                Role-based access built for schools.
              </h2>
              <p className="mt-4 text-slate-400 leading-relaxed">
                Assign roles that mirror your school structure. Hosts control the broadcast, producers manage cameras and overlays, and viewers watch the stream—each with exactly the permissions they need.
              </p>
              <ul className="mt-6 space-y-3 text-sm text-slate-300">
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-500/20 text-orange-300 text-xs">✓</span>
                  <span><strong className="text-white">Faculty Admin</strong> — create rooms, invite staff, manage recordings</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-500/20 text-orange-300 text-xs">✓</span>
                  <span><strong className="text-white">Student Producer</strong> — join the greenroom, control camera &amp; mic, switch scenes</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-500/20 text-orange-300 text-xs">✓</span>
                  <span><strong className="text-white">Viewer</strong> — watch the live HLS stream, no login required</span>
                </li>
              </ul>
            </div>
            <div className="rounded-2xl border border-slate-700 bg-slate-800/40 p-8">
              <div className="space-y-4">
                {[
                  { role: "Faculty Admin", color: "bg-violet-500", perms: "Full control · Create rooms · Manage users" },
                  { role: "Student Producer", color: "bg-orange-500", perms: "Go live · Share screen · Manage overlays" },
                  { role: "Viewer", color: "bg-slate-500", perms: "Watch stream · No sign-in needed" },
                ].map((r) => (
                  <div key={r.role} className="flex items-center gap-4 rounded-xl border border-slate-700 bg-slate-800 p-4">
                    <div className={`h-3 w-3 rounded-full ${r.color}`} />
                    <div>
                      <div className="text-sm font-semibold">{r.role}</div>
                      <div className="text-xs text-slate-400">{r.perms}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Embed & Archive */}
        <section className="py-16">
          <div className="grid items-center gap-12 md:grid-cols-2">
            <div className="order-2 md:order-1 rounded-2xl border border-slate-700 bg-slate-800/40 p-8">
              <div className="rounded-lg border border-slate-600 bg-slate-900 p-4 font-mono text-xs text-slate-400">
                <span className="text-slate-500">{'<!-- Embed on your school website -->'}</span>
                <br />
                <span className="text-orange-300">{'<iframe'}</span>
                <br />
                <span className="pl-4 text-slate-300">{'src="https://streamline.app/live/abc123"'}</span>
                <br />
                <span className="pl-4 text-slate-300">{'width="100%" height="480"'}</span>
                <br />
                <span className="pl-4 text-slate-300">{'allow="autoplay; fullscreen"'}</span>
                <br />
                <span className="text-orange-300">{'></iframe>'}</span>
              </div>
              <p className="mt-4 text-center text-xs text-slate-500">Copy &amp; paste — one line to embed on any page.</p>
            </div>
            <div className="order-1 md:order-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-orange-500/20 bg-orange-500/5 px-4 py-2 font-mono text-xs text-orange-300">
                EMBED &amp; ARCHIVE
              </div>
              <h2 className="mt-6 text-3xl font-extrabold md:text-4xl">
                Stream on your site. <span className="bg-gradient-to-r from-orange-500 to-red-600 bg-clip-text text-transparent">Archive everything.</span>
              </h2>
              <p className="mt-4 leading-relaxed text-slate-400">
                Drop a one-line embed on your school website so parents and community members can watch live. Every broadcast is automatically recorded and saved to your media library for on-demand playback.
              </p>
              <ul className="mt-6 space-y-3 text-sm text-slate-300">
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-500/20 text-orange-300 text-xs">✓</span>
                  <span>HLS adaptive bitrate — works on phones, tablets, and desktops</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-500/20 text-orange-300 text-xs">✓</span>
                  <span>Recordings auto-saved to cloud storage</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-500/20 text-orange-300 text-xs">✓</span>
                  <span>Searchable archive of every past broadcast</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* Security */}
        <section className="py-16">
          <div className="mb-12 text-center">
            <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-orange-500/20 bg-orange-500/5 px-4 py-2 font-mono text-xs text-orange-300">
              SECURITY
            </div>
            <h2 className="mt-6 text-3xl font-extrabold md:text-4xl">
              Safe by default.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-slate-400">
              Every layer of StreamLine EDU is built with student safety and data privacy in mind.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {[
              { title: "Token-Gated Access", desc: "Every participant receives a scoped, time-limited JWT. No valid token, no entry." },
              { title: "No Student Data Stored", desc: "Viewer access requires no account and collects no PII. Fully COPPA/FERPA-friendly." },
              { title: "Admin Audit Logs", desc: "See who started, joined, and recorded every broadcast with timestamped logs." },
            ].map((s) => (
              <div key={s.title} className="rounded-2xl border border-slate-700 bg-slate-800/60 p-8">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10 text-orange-300">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Action Cards */}
        <section id="actions" className="py-12 pb-24">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <Link
              to="/streamline/edu/login"
              className="group relative overflow-hidden rounded-3xl bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 p-10 md:col-span-2"
              style={{ animation: "slEduFadeUp 0.8s ease-out 0.9s both" }}
            >
              <div className="relative z-10">
                <h3 className="text-2xl font-bold">Faculty / Student Sign In</h3>
                <p className="mt-2 text-sm text-white/90">Use your existing StreamLine account</p>
                <div className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-white">
                  <span>Enter</span>
                  <svg
                    className="h-5 w-5 transition-transform group-hover:translate-x-1"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M5 12h14" />
                    <path d="M12 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
              <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.18),transparent_55%)]" />
            </Link>

            <a
              href={pilotHref}
              className="group rounded-3xl border border-slate-700 bg-slate-800 p-10"
              style={{ animation: "slEduFadeUp 0.8s ease-out 1s both" }}
            >
              <h3 className="text-2xl font-bold">Request a Pilot</h3>
              <p className="mt-2 text-sm text-slate-400">Get your school onboarded with EDU access</p>
              {typeof user?.email === "string" && user.email.trim() ? (
                <div className="mt-3 text-xs text-slate-500">
                  Your email: <span className="font-mono text-slate-300">{user.email.trim()}</span>
                </div>
              ) : (
                <div className="mt-3 text-xs text-slate-500">Sign in to include your email automatically.</div>
              )}
              <div className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-orange-300">
                <span>Contact</span>
                <svg
                  className="h-5 w-5 transition-transform group-hover:translate-x-1"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M5 12h14" />
                  <path d="M12 5l7 7-7 7" />
                </svg>
              </div>
            </a>
          </div>

          <div className="mt-14 text-center" style={{ animation: "slEduFadeUp 0.8s ease-out 1.1s both" }}>
            <Link to="/" className="text-sm text-slate-400 hover:text-orange-300">
              Not an EDU organization? Continue to the main platform. →
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
