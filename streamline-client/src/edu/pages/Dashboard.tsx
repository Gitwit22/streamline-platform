import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { computeEduEventStatus, listEduEvents } from "../state/eduEvents";
import { useEduMe } from "../layout/EduProtectedRoute";
import { apiFetchAuth } from "../../lib/api";
import { useSchoolBranding } from "../state/schoolBranding";
import SchoolLogo from "../components/SchoolLogo";

export default function Dashboard() {
  const nav = useNavigate();
  const me = useEduMe();
  const { branding } = useSchoolBranding();
  const primary = branding.accentColor;
  const secondary = branding.secondaryColor;

  const role = String(me?.orgRole || me?.role || "faculty_admin");
  const isStudentProducer = role === "student_producer" || role === "student_producer_assigned";

  /* ── Data fetching ───────────────────────────────────── */
  const [stats, setStats] = useState<{
    rooms: number; students: number; mediaStudents: number;
    staff: number; recordings: number;
  }>({ rooms: 0, students: 0, mediaStudents: 0, staff: 0, recordings: 0 });
  const [statsLoaded, setStatsLoaded] = useState(false);

  /* ── "Don't show again" for the welcome banner ──── */
  const WELCOME_DISMISS_KEY = "sl_edu_welcome_dismissed";
  const [welcomeDismissed, setWelcomeDismissed] = useState(() => {
    try { return localStorage.getItem(WELCOME_DISMISS_KEY) === "1"; } catch { return false; }
  });
  const dismissWelcomeForever = () => {
    setWelcomeDismissed(true);
    try { localStorage.setItem(WELCOME_DISMISS_KEY, "1"); } catch { /* ignore */ }
  };

  const [recentRecordings, setRecentRecordings] = useState<
    { id: string; title: string; duration: string; date: string }[]
  >([]);

  useEffect(() => {
    Promise.allSettled([
      apiFetchAuth("/api/edu/rooms").then((r) => r.json()),
      apiFetchAuth("/api/edu/students").then((r) => r.json()),
      apiFetchAuth("/api/edu/people").then((r) => r.json()),
      apiFetchAuth("/api/edu/recordings").then((r) => r.json()),
    ]).then(([roomsRes, studentsRes, peopleRes, recordingsRes]) => {
      const rooms = roomsRes.status === "fulfilled" ? (roomsRes.value?.rooms ?? []) : [];
      const students = studentsRes.status === "fulfilled" ? (studentsRes.value?.students ?? []) : [];
      const people = peopleRes.status === "fulfilled" ? (peopleRes.value?.members ?? []) : [];
      const recordings = recordingsRes.status === "fulfilled" ? (recordingsRes.value?.recordings ?? []) : [];

      setStats({
        rooms: rooms.length,
        students: students.length,
        mediaStudents: students.filter((s: any) => s.mediaClub || s.role === "student_producer").length,
        staff: people.filter((p: any) => p.role === "faculty_admin" || p.role === "faculty_teacher").length,
        recordings: recordings.length,
      });

      setRecentRecordings(
        recordings.slice(0, 4).map((r: any) => {
          const sec = r.durationSec || 0;
          const min = Math.floor(sec / 60);
          const s = sec % 60;
          const duration = sec > 3600
            ? `${Math.floor(sec / 3600)}:${String(min % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`
            : `${min}:${String(s).padStart(2, "0")}`;
          const date = r.recordedAt || r.createdAt;
          return {
            id: r.id,
            title: r.title || "Untitled",
            duration,
            date: date ? new Date(date).toLocaleDateString([], { month: "short", day: "numeric" }) : "",
          };
        }),
      );
      setStatsLoaded(true);
    });
  }, []);

  const roomCount = stats.rooms;
  const studentCount = stats.students;
  const mediaStudents = stats.mediaStudents;
  const staffCount = stats.staff;
  const recordingCount = stats.recordings;

  /* Live broadcast status from API */
  const [liveBroadcasts, setLiveBroadcasts] = useState<
    { id: string; title: string; viewers: number }[]
  >([]);
  useEffect(() => {
    apiFetchAuth("/api/edu/broadcasts?status=live")
      .then((r) => r.json())
      .then((data) => setLiveBroadcasts(data?.broadcasts ?? []))
      .catch(() => setLiveBroadcasts([]));
  }, []);
  const isLive = liveBroadcasts.length > 0;

  /* Stop or delete a stuck broadcast */
  const stopBroadcast = async (id: string) => {
    try {
      // Try stop first, then delete as fallback
      const stopRes = await apiFetchAuth(`/api/edu/broadcasts/${id}/stop`, { method: "POST" });
      if (!stopRes.ok) {
        await apiFetchAuth(`/api/edu/broadcasts/${id}`, { method: "DELETE" });
      }
    } catch { /* ignore */ }
    setLiveBroadcasts((prev) => prev.filter((b) => b.id !== id));
  };

  /* True when the school is brand new — show getting-started prompts.
     Only evaluate after stats have loaded so the banner doesn't flash then vanish. */
  const isNewSchool = statsLoaded && !welcomeDismissed
    && roomCount + studentCount + staffCount + recordingCount <= 4 && staffCount <= 1;

  const [allEventsList, setAllEventsList] = useState<import("../state/eduEvents").EduEvent[]>([]);
  useEffect(() => {
    let cancelled = false;
    listEduEvents().then((all) => {
      if (!cancelled) setAllEventsList(all);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const upcomingEvents = useMemo(() => {
    return allEventsList.filter((e) => {
      const s = computeEduEventStatus(e);
      return s !== "ended" && s !== "canceled";
    }).slice(0, 3).map((e) => {
      const d = new Date(e.startsAt);
      return {
        id: e.id,
        title: e.title,
        time: d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        date: d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }),
        type: "event" as const,
        crew: [e.producerName].filter(Boolean) as string[],
      };
    });
  }, [allEventsList]);

  return (
    <div className="space-y-6">
      {/* ── School identity banner ────────────────────────── */}
      <div className="flex items-center gap-4 rounded-2xl border border-slate-700 bg-gradient-to-r from-slate-800 to-slate-800/50 px-6 py-4">
        <SchoolLogo size="lg" />
        <div>
          <h2 className="text-lg font-bold text-white">{me?.orgName || "Your School"}</h2>
          <p className="text-xs text-slate-400">Powered by StreamLine EDU</p>
        </div>
      </div>

      {/* ── Student Producer: simplified dashboard ──────────── */}
      {isStudentProducer ? (
        <>
          {/* Welcome banner */}
          <div className="rounded-2xl border border-slate-700 bg-gradient-to-r from-slate-800 to-slate-800/50 p-6">
            <h1 className="text-2xl font-bold text-white">Welcome to the Student Dashboard</h1>
            <p className="mt-2 text-sm text-slate-400">
              This is your hub for managing broadcasts, viewing recordings, and collaborating with other student producers.
            </p>
          </div>

          {/* Live banner */}
          {liveBroadcasts.length > 0 && (
            <div className="rounded-2xl border border-red-500/40 bg-gradient-to-r from-red-900/30 to-slate-900/50 p-4">
              <div className="flex items-center gap-3">
                <div className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
                <span className="font-semibold text-red-400">LIVE NOW</span>
                <span className="text-white">{liveBroadcasts[0].title}</span>
                <span className="text-sm text-slate-400">{liveBroadcasts[0].viewers} viewers</span>
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={() => nav("/streamline/edu/broadcast")} className="rounded-lg bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-500">
                    Watch
                  </button>
                  {!isStudentProducer && (
                    <button onClick={() => stopBroadcast(liveBroadcasts[0].id)} className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-1 text-sm font-medium text-white hover:bg-slate-600">
                      End
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Stat cards: Broadcast + Recordings + Students */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div
              className={`rounded-2xl border p-5 ${
                isLive
                  ? "border-red-500/30 bg-red-500/10"
                  : "border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50"
              }`}
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm text-slate-400">Broadcast Status</span>
                {isLive ? <div className="h-3 w-3 animate-pulse rounded-full bg-red-500" /> : null}
              </div>
              <div className={`text-2xl font-bold ${isLive ? "text-red-400" : "text-slate-500"}`}>{isLive ? "LIVE" : "OFF AIR"}</div>
            </div>

            <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-5">
              <div className="mb-3 text-sm text-slate-400">Recordings</div>
              <div className="text-2xl font-bold text-white">{recordingCount}</div>
              <div className="mt-1 text-sm text-emerald-400">this semester</div>
            </div>

            <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-5">
              <div className="mb-3 text-sm text-slate-400">Students</div>
              <div className="text-2xl font-bold text-white">{studentCount}</div>
              <div className="mt-1 text-sm text-slate-400">{mediaStudents} media club</div>
            </div>
          </div>

          {/* Quick actions: Broadcast + Recordings */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <button
              onClick={() => nav("/streamline/edu/broadcast")}
              className="group rounded-2xl p-6 text-left transition-transform hover:-translate-y-1"
              style={{ background: `linear-gradient(to right, ${primary}, ${secondary})` }}
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 transition-transform group-hover:scale-110">
                <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="text-xl font-bold text-white">Broadcast Studio</div>
              <div className="mt-1 text-sm text-white/85">Go live to your school network</div>
            </button>

            <button
              onClick={() => nav("/streamline/edu/media-library")}
              className="group rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6 text-left transition-transform hover:-translate-y-1"
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl transition-transform group-hover:scale-110" style={{ backgroundColor: `${primary}1a`, color: primary }}>
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                </svg>
              </div>
              <div className="text-xl font-bold text-white">Recordings</div>
              <div className="mt-1 text-sm text-slate-400">Browse past broadcasts</div>
            </button>
          </div>

          {/* Recent recordings */}
          <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Recent Recordings</h3>
              <button onClick={() => nav("/streamline/edu/media-library")} className="text-sm" style={{ color: primary }}>
                View All →
              </button>
            </div>
            <div className="space-y-3">
              {recentRecordings.map((recording) => (
                <div
                  key={recording.id}
                  className="flex items-center gap-4 rounded-xl border border-slate-700/60 bg-slate-900/40 p-4 transition-colors hover:bg-slate-900/60"
                >
                  <div className="flex h-10 w-16 items-center justify-center rounded-lg bg-slate-700">
                    <svg className="h-5 w-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-white">{recording.title}</div>
                    <div className="text-sm text-slate-400">{recording.duration} • {recording.date}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
      <>
      {/* ── Faculty / Admin: full dashboard ────────────────── */}

      {/* Getting-started guide for new schools */}
      {isNewSchool && (
        <div className="rounded-2xl border bg-gradient-to-br to-slate-900 p-6 relative" style={{ borderColor: `${primary}4d`, backgroundImage: `linear-gradient(to bottom right, ${primary}33, var(--tw-gradient-to, rgb(15 23 42)))` }}>
          {/* Dismiss forever */}
          <button
            onClick={dismissWelcomeForever}
            className="absolute top-3 right-3 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            title="Don't show this again"
          >
            Don&apos;t show again &times;
          </button>
          <h2 className="mb-1 text-xl font-bold text-white">Welcome to StreamLine!</h2>
          <p className="mb-4 text-sm text-slate-400">Complete these steps to get your school broadcasting.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { label: "Add a Staff Member", path: "/streamline/edu/people", icon: "M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" },
              { label: "Add a Student", path: "/streamline/edu/students", icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" },
              { label: "Schedule a Broadcast", path: "/streamline/edu/events", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
              { label: "Customize School Branding", path: "/streamline/edu/settings", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
              { label: "Copy Website Embed Code", path: "/streamline/edu/embed", icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" },
            ].map((step) => (
              <button
                key={step.label}
                onClick={() => nav(step.path)}
                className="flex items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-800/50 p-3 text-left transition-colors hover:bg-slate-800"
                style={{ ['--hover-border' as any]: `${primary}66` }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = `${primary}66`)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '')}
              >
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${primary}1a` }}>
                  <svg className="h-5 w-5" style={{ color: primary }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={step.icon} />
                  </svg>
                </div>
                <span className="text-sm font-medium text-white">{step.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Live banner when broadcasting */}
      {liveBroadcasts.length > 0 && (
        <div className="rounded-2xl border border-red-500/40 bg-gradient-to-r from-red-900/30 to-slate-900/50 p-4">
          <div className="flex items-center gap-3">
            <div className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
            <span className="font-semibold text-red-400">LIVE NOW</span>
            <span className="text-white">{liveBroadcasts[0].title}</span>
            <span className="text-sm text-slate-400">{liveBroadcasts[0].viewers} viewers</span>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => nav("/streamline/edu/broadcast")} className="rounded-lg bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-500">
                Watch
              </button>
              <button onClick={() => stopBroadcast(liveBroadcasts[0].id)} className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-1 text-sm font-medium text-white hover:bg-slate-600">
                End
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
        <div
          className={`rounded-2xl border p-5 ${
            isLive
              ? "border-red-500/30 bg-red-500/10"
              : "border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50"
          }`}
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm text-slate-400">Broadcast Status</span>
            {isLive ? <div className="h-3 w-3 animate-pulse rounded-full bg-red-500" /> : null}
          </div>
          <div className={`text-2xl font-bold ${isLive ? "text-red-400" : "text-slate-500"}`}>{isLive ? "LIVE" : "OFF AIR"}</div>
          {isLive && liveBroadcasts[0] ? <div className="mt-1 text-sm text-slate-400">{liveBroadcasts[0].viewers} viewers</div> : null}
        </div>

        <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-5">
          <div className="mb-3 text-sm text-slate-400">Rooms</div>
          <div className="text-2xl font-bold text-white">{roomCount}</div>
          <div className="mt-1 text-sm text-slate-400">broadcast rooms</div>
        </div>

        <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-5">
          <div className="mb-3 text-sm text-slate-400">Recordings</div>
          <div className="text-2xl font-bold text-white">{recordingCount}</div>
          <div className="mt-1 text-sm text-emerald-400">this semester</div>
        </div>

        <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-5">
          <div className="mb-3 text-sm text-slate-400">Students</div>
          <div className="text-2xl font-bold text-white">{studentCount}</div>
          <div className="mt-1 text-sm text-slate-400">{mediaStudents} media club</div>
        </div>

        <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-5">
          <div className="mb-3 text-sm text-slate-400">Staff</div>
          <div className="text-2xl font-bold text-white">{staffCount}</div>
          <div className="mt-1 text-sm text-slate-400">faculty &amp; admin</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <button
          onClick={() => nav("/streamline/edu/events")}
          className="group rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6 text-left transition-transform hover:-translate-y-1"
        >
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl transition-transform group-hover:scale-110" style={{ backgroundColor: `${primary}1a`, color: primary }}>
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
          <div className="text-xl font-bold text-white">Schedule Event</div>
          <div className="mt-1 text-sm text-slate-400">Plan upcoming broadcasts</div>
        </button>

        <button
          onClick={() => nav("/streamline/edu/embed")}
          className="group rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6 text-left transition-transform hover:-translate-y-1"
        >
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl transition-transform group-hover:scale-110" style={{ backgroundColor: `${primary}1a`, color: primary }}>
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
          </div>
          <div className="text-xl font-bold text-white">Website Embed</div>
          <div className="mt-1 text-sm text-slate-400">Get code for your site</div>
        </button>

        <button
          onClick={() => nav("/streamline/edu/broadcast")}
          className="group rounded-2xl p-6 text-left transition-transform hover:-translate-y-1"
          style={{ background: `linear-gradient(to right, ${primary}, ${secondary})` }}
        >
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 transition-transform group-hover:scale-110">
            <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="text-xl font-bold text-white">Start Broadcast</div>
          <div className="mt-1 text-sm text-white/85">Go live to your school network</div>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Upcoming Events</h3>
            <button onClick={() => nav("/streamline/edu/events")} className="text-sm" style={{ color: primary }}>
              View All →
            </button>
          </div>
          <div className="space-y-3">
            {upcomingEvents.map((event) => (
              <div key={event.id} className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-4 transition-colors hover:bg-slate-900/60">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-medium text-white">{event.title}</div>
                    <div className="mt-1 text-sm text-slate-400">
                      {event.date} • {event.time}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="rounded-full px-2 py-0.5 text-xs" style={{ backgroundColor: `${secondary}33`, color: secondary }}>Event</span>
                      <span className="text-xs text-slate-500">{event.crew.length ? "Producer assigned" : "No producer assigned"}</span>
                    </div>
                  </div>
                  <button className="rounded-xl border border-slate-700 bg-slate-800/40 p-2 text-slate-300 hover:bg-slate-800/70 hover:text-white">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Recent Recordings</h3>
            <button onClick={() => nav("/streamline/edu/recordings")} className="text-sm" style={{ color: primary }}>
              View All →
            </button>
          </div>
          <div className="space-y-3">
            {recentRecordings.map((recording) => (
              <div
                key={recording.id}
                className="flex items-center gap-4 rounded-xl border border-slate-700/60 bg-slate-900/40 p-4 transition-colors hover:bg-slate-900/60"
              >
                <div className="flex h-10 w-16 items-center justify-center rounded-lg bg-slate-700">
                  <svg className="h-5 w-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                    />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-white">{recording.title}</div>
                  <div className="text-sm text-slate-400">
                    {recording.duration} • {recording.date}
                  </div>
                </div>
                <button className="rounded-xl border border-slate-700 bg-slate-800/40 p-2 text-slate-300 hover:bg-slate-800/70 hover:text-white">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      </>
      )}
    </div>
  );
}
