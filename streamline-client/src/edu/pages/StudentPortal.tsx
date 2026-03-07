import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetchAuth } from "../../lib/api";
import { computeEduEventStatus, listEduEvents } from "../state/eduEvents";

type TabId = "live" | "upcoming" | "recordings" | "rooms" | "media";

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export default function StudentPortal() {
  const nav = useNavigate();
  const [tab, setTab] = useState<TabId>("live");
  const [schoolName, setSchoolName] = useState("Your School");

  /* ── Fetch live data ──────────────────────────────────── */
  const [liveBroadcasts, setLiveBroadcasts] = useState<{ id: string; title: string; viewers: number; status: string }[]>([]);
  const [recordings, setRecordings] = useState<{ id: string; title: string; duration: string; date: string }[]>([]);
  const [rooms, setRooms] = useState<{ id: string; name: string; description: string; isLive: boolean }[]>([]);

  useEffect(() => {
    Promise.allSettled([
      apiFetchAuth("/api/edu/broadcasts?status=live").then((r) => r.json()),
      apiFetchAuth("/api/edu/recordings?limit=20").then((r) => r.json()),
      apiFetchAuth("/api/edu/rooms").then((r) => r.json()),
      apiFetchAuth("/api/edu/org").then((r) => r.json()),
    ]).then(([bRes, rRes, rmRes, orgRes]) => {
      if (bRes.status === "fulfilled") setLiveBroadcasts(bRes.value?.broadcasts ?? []);
      if (rRes.status === "fulfilled") {
        setRecordings(
          (rRes.value?.recordings ?? []).map((r: any) => ({
            id: r.id,
            title: r.title || "Untitled",
            duration: r.duration || "",
            date: r.recordedAt || r.createdAt || "",
          })),
        );
      }
      if (rmRes.status === "fulfilled") setRooms(rmRes.value?.rooms ?? []);
      if (orgRes.status === "fulfilled" && orgRes.value?.org?.name) setSchoolName(orgRes.value.org.name);
    });
  }, []);

  const [upcomingEvents, setUpcomingEvents] = useState<{ id: string; title: string; date: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    listEduEvents().then((all) => {
      if (cancelled) return;
      setUpcomingEvents(
        all
          .filter((e) => {
            const s = computeEduEventStatus(e);
            return s !== "ended" && s !== "canceled";
          })
          .slice(0, 5)
          .map((e) => ({
            id: e.id,
            title: e.title,
            date: new Date(e.startsAt).toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            }),
          })),
      );
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const tabs: { id: TabId; label: string }[] = [
    { id: "live", label: "Live Broadcasts" },
    { id: "upcoming", label: "Upcoming Events" },
    { id: "recordings", label: "Past Recordings" },
    { id: "rooms", label: "Class Rooms" },
    { id: "media", label: "Media Programs" },
  ];

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Top bar */}
      <header className="border-b border-slate-700 bg-slate-900/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <img src="/edu_logo.png" alt="EDU" className="h-8 w-8 object-contain" />
            <div>
              <div className="text-sm font-bold text-white">{schoolName}</div>
              <div className="text-[11px] text-slate-500">Student Portal</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => nav("/streamline/edu")}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
            >
              Exit
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Tabs */}
        <div className="mb-8 flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                tab === t.id
                  ? "bg-blue-500/15 text-blue-300 border border-blue-500/30"
                  : "border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Live */}
        {tab === "live" && (
          <div>
            <h2 className="mb-4 text-xl font-bold">Live Now</h2>
            {liveBroadcasts.length === 0 ? (
              <div className="rounded-2xl border border-slate-700 bg-slate-800/50 p-12 text-center">
                <div className="text-4xl">📡</div>
                <div className="mt-3 text-lg font-semibold text-slate-300">No Live Broadcasts</div>
                <div className="mt-1 text-sm text-slate-500">Check back later or look at upcoming events.</div>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {liveBroadcasts.map((b) => (
                  <div key={b.id} className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
                      <span className="text-xs font-semibold text-red-400">LIVE</span>
                    </div>
                    <div className="mt-2 text-lg font-bold">{b.title}</div>
                    <div className="mt-1 text-sm text-slate-400">{b.viewers} viewers</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Upcoming */}
        {tab === "upcoming" && (
          <div>
            <h2 className="mb-4 text-xl font-bold">Upcoming Events</h2>
            {upcomingEvents.length === 0 ? (
              <div className="rounded-2xl border border-slate-700 bg-slate-800/50 p-12 text-center text-slate-400">
                No upcoming events scheduled.
              </div>
            ) : (
              <div className="space-y-3">
                {upcomingEvents.map((e) => (
                  <div key={e.id} className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-800/50 p-5">
                    <div>
                      <div className="font-semibold text-white">{e.title}</div>
                      <div className="mt-1 text-sm text-orange-400">{e.date}</div>
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-700/50">
                      <svg className="h-5 w-5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Recordings */}
        {tab === "recordings" && (
          <div>
            <h2 className="mb-4 text-xl font-bold">Past Recordings</h2>
            <div className="space-y-3">
              {recordings.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-800/50 p-5">
                  <div>
                    <div className="font-semibold text-white">{r.title}</div>
                    <div className="mt-1 flex items-center gap-3 text-sm text-slate-400">
                      <span>{r.duration}</span>
                      <span>•</span>
                      <span>{formatDate(r.date)}</span>
                    </div>
                  </div>
                  <button className="rounded-lg bg-slate-700/60 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700">
                    Watch
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Rooms */}
        {tab === "rooms" && (
          <div>
            <h2 className="mb-4 text-xl font-bold">Class Rooms</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {rooms.map((r) => (
                <div key={r.id} className="rounded-2xl border border-slate-700 bg-slate-800/50 p-6">
                  <div className="flex items-center gap-2">
                    {r.isLive && <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />}
                    <div className="font-semibold text-white">{r.name}</div>
                  </div>
                  <div className="mt-2 text-sm text-slate-400">{r.description}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Media Programs */}
        {tab === "media" && (
          <div>
            <h2 className="mb-4 text-xl font-bold">Media Programs</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10 text-blue-300">
                  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" />
                  </svg>
                </div>
                <div className="text-lg font-bold">Media Club</div>
                <div className="mt-1 text-sm text-slate-400">Student-run broadcasting program. Produce shows, cover events, and build your media skills.</div>
                <div className="mt-3 text-xs text-slate-500">5 members • 12 episodes</div>
              </div>
              <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500/10 text-orange-300">
                  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
                  </svg>
                </div>
                <div className="text-lg font-bold">Morning News</div>
                <div className="mt-1 text-sm text-slate-400">Daily school announcements broadcast. Selected students anchor, produce, and direct the show.</div>
                <div className="mt-3 text-xs text-slate-500">Monday-Friday • 8:00 AM</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
