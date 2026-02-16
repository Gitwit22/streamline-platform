import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { computeEduEventStatus, listEduEvents } from "../state/eduEvents";

export default function Dashboard() {
  const nav = useNavigate();
  const [isLive] = useState<boolean>(false);

  const upcomingEvents = useMemo(() => {
    const all = listEduEvents();
    const next = all.filter((e) => {
      const s = computeEduEventStatus(e);
      return s !== "ended" && s !== "canceled";
    });
    return next.slice(0, 3).map((e) => {
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
  }, []);

  const recentRecordings = useMemo(
    () => [
      { id: 1, title: "Morning Announcements - Dec 13", duration: "12:34", date: "2 hours ago" },
      { id: 2, title: "Band Practice Session", duration: "45:12", date: "Yesterday" },
      { id: 3, title: "Principal Address", duration: "8:45", date: "3 days ago" },
      { id: 4, title: "Fall Play - Act 1", duration: "1:23:45", date: "Dec 8" },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
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
          {isLive ? <div className="mt-1 text-sm text-slate-400">127 viewers • 12:34 elapsed</div> : null}
        </div>

        <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-5">
          <div className="mb-3 text-sm text-slate-400">Next Scheduled</div>
          <div className="text-xl font-bold text-white">School Network (Morning Announcements)</div>
          <div className="mt-1 text-sm text-orange-400">Tomorrow • 8:00 AM</div>
        </div>

        <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-5">
          <div className="mb-3 text-sm text-slate-400">Recordings This Month</div>
          <div className="text-2xl font-bold text-white">24</div>
          <div className="mt-1 text-sm text-emerald-400">↑ 8 from last month</div>
        </div>

        <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-5">
          <div className="mb-3 text-sm text-slate-400">Active Students</div>
          <div className="text-2xl font-bold text-white">12</div>
          <div className="mt-1 text-sm text-slate-400">3 producers • 9 talent</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <button
          onClick={() => nav("/streamline/edu/broadcast")}
          className="group rounded-2xl bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 p-6 text-left transition-transform hover:-translate-y-1"
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

        <button
          onClick={() => nav("/streamline/edu/events")}
          className="group rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6 text-left transition-transform hover:-translate-y-1"
        >
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500/10 text-orange-300 transition-transform group-hover:scale-110">
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
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500/10 text-orange-300 transition-transform group-hover:scale-110">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
          </div>
          <div className="text-xl font-bold text-white">Website Embed</div>
          <div className="mt-1 text-sm text-slate-400">Get code for your site</div>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Upcoming Events</h3>
            <button onClick={() => nav("/streamline/edu/events")} className="text-sm text-orange-400 hover:text-orange-300">
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
                      <span className="rounded-full bg-purple-500/20 px-2 py-0.5 text-xs text-purple-300">Event</span>
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
            <button onClick={() => nav("/streamline/edu/archive")} className="text-sm text-orange-400 hover:text-orange-300">
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

      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-amber-500/20">
            <svg className="h-5 w-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div>
            <div className="font-medium text-amber-300">Storage Notice</div>
            <div className="mt-1 text-sm text-slate-400">
              You&apos;ve used 78% of your recording storage this month. Consider archiving older recordings.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
