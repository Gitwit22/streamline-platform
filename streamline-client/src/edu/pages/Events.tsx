import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useEduMe } from "../layout/EduProtectedRoute";
import { createEduSavedEmbed } from "../api/savedEmbeds";
import { fetchDestinations, type DestinationItem } from "../../services/destinations";
import {
  cancelEduEvent,
  computeEduEventStatus,
  createEduEvent,
  duplicateEduEvent,
  isInStartWindow,
  listEduEvents,
  type EduEvent,
  type EduEventType,
  upsertEduEvent,
} from "../state/eduEvents";

type TabId = "upcoming" | "past";

function formatDateTime(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function typeLabel(t: EduEventType) {
  if (t === "concert") return "Concert";
  if (t === "game") return "Game";
  if (t === "assembly") return "Assembly";
  return "Address";
}

function typeBadgeClass(t: EduEventType) {
  if (t === "concert") return "bg-purple-500/20 text-purple-300";
  if (t === "game") return "bg-blue-500/20 text-blue-300";
  if (t === "assembly") return "bg-emerald-500/20 text-emerald-300";
  return "bg-amber-500/20 text-amber-300";
}

function statusBadge(status: ReturnType<typeof computeEduEventStatus>) {
  if (status === "ready") return { label: "Ready", cls: "border-emerald-500/20 bg-emerald-500/15 text-emerald-300" };
  if (status === "live") return { label: "Live", cls: "border-red-500/20 bg-red-500/15 text-red-300" };
  if (status === "ended") return { label: "Ended", cls: "border-slate-700/30 bg-slate-800/50 text-slate-300" };
  if (status === "canceled") return { label: "Canceled", cls: "border-slate-700/30 bg-slate-800/30 text-slate-400" };
  return { label: "Scheduled", cls: "border-slate-700/30 bg-slate-800/30 text-slate-300" };
}

async function safeCopy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function IconWebsite() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 21a9 9 0 100-18 9 9 0 000 18z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.6 9h16.8M3.6 15h16.8" />
    </svg>
  );
}

function IconRecord() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  );
}

function IconYouTube() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.5 6.2a3 3 0 00-2.1-2.1C19.6 3.6 12 3.6 12 3.6s-7.6 0-9.4.5A3 3 0 00.5 6.2 31.5 31.5 0 000 12a31.5 31.5 0 00.5 5.8 3 3 0 002.1 2.1c1.8.5 9.4.5 9.4.5s7.6 0 9.4-.5a3 3 0 002.1-2.1A31.5 31.5 0 0024 12a31.5 31.5 0 00-.5-5.8zM9.6 15.5V8.5L15.8 12l-6.2 3.5z" />
    </svg>
  );
}

function DotsMenu({
  onEdit,
  onDuplicate,
  onCancel,
  disabledCancel,
}: {
  onEdit: () => void;
  onDuplicate: () => void;
  onCancel: () => void;
  disabledCancel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!ref.current) return;
      if (ref.current.contains(t)) return;
      setOpen(false);
    }
    if (!open) return;
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg border border-transparent p-2 text-slate-400 hover:border-slate-700/60 hover:bg-slate-900/60 hover:text-white"
        aria-label="More"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 7a2 2 0 110-4 2 2 0 010 4zm0 7a2 2 0 110-4 2 2 0 010 4zm0 7a2 2 0 110-4 2 2 0 010 4z" />
        </svg>
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900 shadow-lg">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-800/60"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onDuplicate();
            }}
            className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-800/60"
          >
            Duplicate
          </button>
          <button
            type="button"
            disabled={!!disabledCancel}
            onClick={() => {
              setOpen(false);
              onCancel();
            }}
            className={`w-full px-4 py-2 text-left text-sm hover:bg-slate-800/60 ${
              disabledCancel ? "cursor-not-allowed text-slate-600" : "text-red-300"
            }`}
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" onClick={onClose} className="absolute inset-0 bg-black/60" aria-label="Close" />
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-900 to-slate-900/40 p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="text-lg font-semibold text-white">{title}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-900 hover:text-white">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DrawerShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" onClick={onClose} className="absolute inset-0 bg-black/60" aria-label="Close" />
      <div className="absolute right-0 top-0 h-full w-full max-w-xl overflow-y-auto border-l border-slate-700/60 bg-slate-900">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-700/60 bg-slate-900/80 p-5 backdrop-blur-xl">
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold text-white">{title}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-900 hover:text-white">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export default function Events() {
  const nav = useNavigate();
  const me = useEduMe();

  const roleRaw = String(me?.orgRole || me?.role || "viewer");
  const isFacultyAdmin = roleRaw === "faculty_admin";
  const isStudentProducer = roleRaw === "student_producer" || roleRaw === "student_producer_assigned";

  const [tab, setTab] = useState<TabId>("upcoming");
  const [query, setQuery] = useState<string>("");
  const [eventsVersion, setEventsVersion] = useState(0);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const events = useMemo(() => {
    void eventsVersion;
    const all = listEduEvents();
    const q = query.trim().toLowerCase();
    const filtered = q ? all.filter((e) => e.title.toLowerCase().includes(q)) : all;
    const now = Date.now();
    const upcoming = filtered.filter((e) => {
      const status = computeEduEventStatus(e);
      if (status === "ended" || status === "canceled") return false;
      if (status === "live") return true;
      const start = new Date(e.startsAt).getTime();
      return !Number.isFinite(start) || start >= now - 60 * 60_000;
    });
    const past = filtered.filter((e) => {
      const status = computeEduEventStatus(e);
      return status === "ended" || status === "canceled";
    });
    return { upcoming, past };
  }, [eventsVersion, query]);

  function refreshEvents() {
    setEventsVersion((x) => x + 1);
  }

  const selectedEvent = useMemo(() => {
    if (!detailId) return null;
    return listEduEvents().find((e) => e.id === detailId) || null;
  }, [detailId, eventsVersion]);

  const canStartFromEvent = (ev: EduEvent) => {
    if (computeEduEventStatus(ev) === "canceled") return false;
    if (computeEduEventStatus(ev) === "ended") return false;
    if (!isInStartWindow(ev)) return false;

    if (isFacultyAdmin) return true;
    if (!isStudentProducer) return false;
    if (!ev.studentProducerCanStart) return false;
    const displayName = String(me?.displayName || "").trim().toLowerCase();
    const producerName = String(ev.producerName || "").trim().toLowerCase();
    if (!displayName || !producerName) return false;
    return displayName === producerName;
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-2xl font-bold text-white">Events</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden md:block">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="w-64 rounded-xl border border-slate-700/60 bg-slate-950/40 px-4 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-orange-500/40 focus:ring-2 focus:ring-orange-500/20"
            />
          </div>
          <button
            type="button"
            onClick={() => setScheduleOpen(true)}
            className="rounded-xl bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:from-orange-400 hover:via-red-500 hover:to-violet-500"
          >
            Schedule Event
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-2">
        <button
          type="button"
          onClick={() => setTab("upcoming")}
          className={`flex-1 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
            tab === "upcoming" ? "bg-slate-900/70 text-white" : "text-slate-400 hover:bg-slate-900/40 hover:text-white"
          }`}
        >
          Upcoming
        </button>
        <button
          type="button"
          onClick={() => setTab("past")}
          className={`flex-1 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
            tab === "past" ? "bg-slate-900/70 text-white" : "text-slate-400 hover:bg-slate-900/40 hover:text-white"
          }`}
        >
          Past
        </button>
      </div>

      {/* Optional filter/search on mobile */}
      <div className="md:hidden">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          className="w-full rounded-xl border border-slate-700/60 bg-slate-950/40 px-4 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-orange-500/40 focus:ring-2 focus:ring-orange-500/20"
        />
      </div>

      {/* Event cards */}
      <div className="space-y-3">
        {(tab === "upcoming" ? events.upcoming : events.past).map((ev) => {
          const status = computeEduEventStatus(ev);
          const badge = statusBadge(status);
          const showYoutube = !!ev.outputs.youtube;

          const crewLine = ev.producerName ? "Producer assigned" : "No producer assigned";

          const canStart = canStartFromEvent(ev);

          return (
            <div key={ev.id} className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="truncate text-lg font-semibold text-white">{ev.title}</div>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${typeBadgeClass(ev.type)}`}>{typeLabel(ev.type)}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${badge.cls}`}>{badge.label}</span>
                  </div>
                  <div className="mt-1 text-sm text-slate-400">{formatDateTime(ev.startsAt)}</div>
                  <div className="mt-2 text-sm text-slate-300">
                    <span className="text-slate-400">Crew:</span> {crewLine}
                  </div>
                  <div className="mt-3 flex items-center gap-3 text-slate-400">
                    {ev.outputs.publishHls ? (
                      <div className="flex items-center gap-1 text-slate-300" title="Website (HLS)">
                        <IconWebsite />
                        <span className="text-xs">Website</span>
                      </div>
                    ) : null}
                    {ev.outputs.recordMp4 ? (
                      <div className="flex items-center gap-1 text-slate-300" title="Recording">
                        <IconRecord />
                        <span className="text-xs">Recording</span>
                      </div>
                    ) : null}
                    {showYoutube ? (
                      <div className="flex items-center gap-1 text-slate-300" title="YouTube">
                        <IconYouTube />
                        <span className="text-xs">YouTube</span>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
                  <button
                    type="button"
                    onClick={() => setDetailId(ev.id)}
                    className="rounded-xl border border-slate-800/50 bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900"
                  >
                    Open
                  </button>
                  {canStart ? (
                    <button
                      type="button"
                      onClick={() => nav(`/streamline/edu/broadcast?eventId=${encodeURIComponent(ev.id)}`)}
                      className="rounded-xl bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:from-orange-400 hover:via-red-500 hover:to-violet-500"
                    >
                      Start
                    </button>
                  ) : null}
                  <DotsMenu
                    onEdit={() => setDetailId(ev.id)}
                    onDuplicate={() => {
                      duplicateEduEvent(ev.id);
                      refreshEvents();
                    }}
                    onCancel={() => {
                      cancelEduEvent(ev.id);
                      refreshEvents();
                    }}
                    disabledCancel={status === "canceled" || status === "ended"}
                  />
                </div>
              </div>
            </div>
          );
        })}

        {(tab === "upcoming" ? events.upcoming : events.past).length === 0 ? (
          <div className="rounded-2xl border border-slate-800/50 bg-slate-900/50 p-6 text-slate-300">
            <div className="text-white font-semibold">No events</div>
            <div className="mt-1 text-sm text-slate-400">Schedule an event to get started.</div>
          </div>
        ) : null}
      </div>

      {/* Schedule Event modal */}
      {scheduleOpen ? (
        <ScheduleEventModal
          isFacultyAdmin={isFacultyAdmin}
          onClose={() => setScheduleOpen(false)}
          onCreated={async (ev) => {
            setScheduleOpen(false);
            refreshEvents();

            // Try to create a viewer embed for this event (best-effort)
            if (ev.outputs.publishHls) {
              try {
                const embed = await createEduSavedEmbed({
                  name: `${ev.title} (Viewer)`,
                  description: "Event viewer link",
                  hlsConfig: {
                    title: ev.title,
                    offlineMessage: "Off Air",
                    theme: "dark",
                    enabled: true,
                  },
                });
                upsertEduEvent({ ...ev, savedEmbedId: embed.embedId });
                refreshEvents();
              } catch {
                // ignore
              }
            }
          }}
        />
      ) : null}

      {/* Event detail drawer */}
      {selectedEvent ? (
        <EventDetailDrawer
          me={me}
          isFacultyAdmin={isFacultyAdmin}
          isStudentProducer={isStudentProducer}
          event={selectedEvent}
          onClose={() => setDetailId(null)}
          onChange={(next) => {
            upsertEduEvent(next);
            refreshEvents();
          }}
          onCancel={() => {
            cancelEduEvent(selectedEvent.id);
            refreshEvents();
            setDetailId(null);
          }}
          onStart={() => nav(`/streamline/edu/broadcast?eventId=${encodeURIComponent(selectedEvent.id)}`)}
          fetchYoutubeDestinations={isFacultyAdmin ? async () => {
            const res = await fetchDestinations({ platform: "youtube", includeDisabled: false });
            return Array.isArray((res as any)?.items) ? ((res as any).items as DestinationItem[]) : [];
          } : undefined}
        />
      ) : null}
    </div>
  );
}

function ScheduleEventModal({
  isFacultyAdmin,
  onClose,
  onCreated,
}: {
  isFacultyAdmin: boolean;
  onClose: () => void;
  onCreated: (ev: EduEvent) => void | Promise<void>;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [title, setTitle] = useState<string>("");
  const [type, setType] = useState<EduEventType>("concert");
  const [startsAtLocal, setStartsAtLocal] = useState<string>("");

  const [producerName, setProducerName] = useState<string>("");
  const [talentCsv, setTalentCsv] = useState<string>("");

  const [publishHls, setPublishHls] = useState(true);
  const [recordMp4, setRecordMp4] = useState(true);
  const [youtube, setYoutube] = useState(false);

  const [error, setError] = useState<string | null>(null);

  function toIsoFromLocal(dtLocal: string) {
    if (!dtLocal) return "";
    const d = new Date(dtLocal);
    if (!Number.isFinite(d.getTime())) return "";
    return d.toISOString();
  }

  const startsAtIso = useMemo(() => toIsoFromLocal(startsAtLocal), [startsAtLocal]);

  async function create() {
    setError(null);
    if (!title.trim()) {
      setError("Title is required");
      setStep(1);
      return;
    }
    if (!startsAtIso) {
      setError("Date/time is required");
      setStep(1);
      return;
    }
    const talent = talentCsv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const ev = createEduEvent({
      title: title.trim(),
      type,
      startsAt: startsAtIso,
      producerName: producerName.trim() || null,
      talent,
      studentProducerCanStart: false,
      outputs: {
        publishHls,
        recordMp4,
        youtube: isFacultyAdmin ? youtube : false,
      },
    });

    await onCreated(ev);
  }

  return (
    <ModalShell title="Schedule Event" onClose={onClose}>
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <div className={`rounded-full px-3 py-1 text-xs font-semibold ${step === 1 ? "bg-orange-500/20 text-orange-300" : "bg-slate-900 text-slate-400"}`}>1</div>
          <div className={`rounded-full px-3 py-1 text-xs font-semibold ${step === 2 ? "bg-orange-500/20 text-orange-300" : "bg-slate-900 text-slate-400"}`}>2</div>
          <div className={`rounded-full px-3 py-1 text-xs font-semibold ${step === 3 ? "bg-orange-500/20 text-orange-300" : "bg-slate-900 text-slate-400"}`}>3</div>
          <div className="text-sm text-slate-400">{step === 1 ? "Basics" : step === 2 ? "Crew" : "Outputs"}</div>
        </div>

        {error ? <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">{error}</div> : null}

        {step === 1 ? (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-200">Title (required)</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-800/50 bg-slate-950 px-4 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
                placeholder="Winter Concert"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-200">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as EduEventType)}
                className="mt-2 w-full rounded-xl border border-slate-800/50 bg-slate-950 px-4 py-2 text-sm text-white focus:outline-none"
              >
                <option value="concert">Concert</option>
                <option value="game">Game</option>
                <option value="assembly">Assembly</option>
                <option value="address">Address</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-200">Date/time</label>
              <input
                type="datetime-local"
                value={startsAtLocal}
                onChange={(e) => setStartsAtLocal(e.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-800/50 bg-slate-950 px-4 py-2 text-sm text-white focus:outline-none"
              />
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-200">Producer (optional at create)</label>
              <input
                value={producerName}
                onChange={(e) => setProducerName(e.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-800/50 bg-slate-950 px-4 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none"
                placeholder="Producer name"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-200">Talent (optional)</label>
              <input
                value={talentCsv}
                onChange={(e) => setTalentCsv(e.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-800/50 bg-slate-950 px-4 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none"
                placeholder="Comma-separated names"
              />
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-3">
            <label className="flex items-center justify-between rounded-xl border border-slate-800/50 bg-slate-900/50 p-4">
              <div>
                <div className="font-medium text-white">Publish to Website (HLS)</div>
                <div className="text-sm text-slate-400">Default ON</div>
              </div>
              <input type="checkbox" checked={publishHls} onChange={(e) => setPublishHls(e.target.checked)} />
            </label>
            <label className="flex items-center justify-between rounded-xl border border-slate-800/50 bg-slate-900/50 p-4">
              <div>
                <div className="font-medium text-white">Record to Archive</div>
                <div className="text-sm text-slate-400">Default ON</div>
              </div>
              <input type="checkbox" checked={recordMp4} onChange={(e) => setRecordMp4(e.target.checked)} />
            </label>
            <label className={`flex items-center justify-between rounded-xl border border-slate-800/50 bg-slate-900/50 p-4 ${!isFacultyAdmin ? "opacity-60" : ""}`}>
              <div>
                <div className="font-medium text-white">Stream to YouTube</div>
                <div className="text-sm text-slate-400">Advanced (faculty only) • Default OFF</div>
              </div>
              <input type="checkbox" checked={youtube} disabled={!isFacultyAdmin} onChange={(e) => setYoutube(e.target.checked)} />
            </label>
          </div>
        ) : null}

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => (step === 1 ? onClose() : setStep((s) => (s === 2 ? 1 : 2)))}
            className="rounded-xl border border-slate-800/50 bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900"
          >
            {step === 1 ? "Close" : "Back"}
          </button>
          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s === 1 ? 2 : 3))}
              className="rounded-xl bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:from-orange-400 hover:via-red-500 hover:to-violet-500"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void create()}
              className="rounded-xl bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:from-orange-400 hover:via-red-500 hover:to-violet-500"
            >
              Create Event
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

function EventDetailDrawer({
  me,
  isFacultyAdmin,
  isStudentProducer,
  event,
  onClose,
  onChange,
  onCancel,
  onStart,
  fetchYoutubeDestinations,
}: {
  me: any;
  isFacultyAdmin: boolean;
  isStudentProducer: boolean;
  event: EduEvent;
  onClose: () => void;
  onChange: (next: EduEvent) => void;
  onCancel: () => void;
  onStart: () => void;
  fetchYoutubeDestinations?: () => Promise<DestinationItem[]>;
}) {
  const [draft, setDraft] = useState<EduEvent>(event);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [destinations, setDestinations] = useState<DestinationItem[]>([]);
  const [destLoading, setDestLoading] = useState(false);

  useEffect(() => setDraft(event), [event]);

  const status = computeEduEventStatus(draft);
  const badge = statusBadge(status);

  useEffect(() => {
    if (!fetchYoutubeDestinations) return;
    if (!draft.outputs.youtube) return;
    setDestLoading(true);
    fetchYoutubeDestinations()
      .then((d) => setDestinations(d))
      .catch(() => setDestinations([]))
      .finally(() => setDestLoading(false));
  }, [fetchYoutubeDestinations, draft.outputs.youtube]);

  const studioUrl = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/streamline/edu/broadcast?eventId=${encodeURIComponent(draft.id)}`;
  }, [draft.id]);

  const viewerUrl = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    if (!draft.savedEmbedId) return "";
    return `${origin}/live/${encodeURIComponent(draft.savedEmbedId)}`;
  }, [draft.savedEmbedId]);

  const embedCode = useMemo(() => {
    if (!viewerUrl) return "";
    return `<iframe src=\"${viewerUrl}\" style=\"width:100%;height:100%;border:0;\" allow=\"autoplay; encrypted-media\" allowfullscreen></iframe>`;
  }, [viewerUrl]);

  const canStartFromDrawer = useMemo(() => {
    if (status === "canceled" || status === "ended") return false;
    if (!isInStartWindow(draft)) return false;
    if (isFacultyAdmin) return true;
    if (!isStudentProducer) return false;
    if (!draft.studentProducerCanStart) return false;
    const displayName = String(me?.displayName || "").trim().toLowerCase();
    const producerName = String(draft.producerName || "").trim().toLowerCase();
    return !!displayName && !!producerName && displayName === producerName;
  }, [draft, isFacultyAdmin, isStudentProducer, me, status]);

  async function doCopy(label: string, value: string) {
    if (!value) return;
    const ok = await safeCopy(value);
    setCopyMsg(ok ? `${label} copied` : `Copy failed`);
    window.setTimeout(() => setCopyMsg(null), 1200);
  }

  return (
    <DrawerShell title={draft.title} onClose={onClose}>
      <div className="space-y-6">
        {copyMsg ? <div className="rounded-xl border border-slate-800/50 bg-slate-900/50 p-3 text-sm text-slate-200">{copyMsg}</div> : null}

        {/* Status */}
        <div className={`rounded-xl border px-3 py-2 text-sm ${badge.cls}`}>Status: {badge.label}</div>

        {/* Section A — Summary */}
        <section className="rounded-2xl border border-slate-800/50 bg-slate-900/50 p-5">
          <div className="mb-3 text-sm font-semibold text-white">Summary</div>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-slate-200">Title</label>
              <input
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                className="mt-2 w-full rounded-xl border border-slate-800/50 bg-slate-950 px-4 py-2 text-sm text-white focus:outline-none"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-200">Date/time</label>
              <input
                value={new Date(draft.startsAt).toISOString().slice(0, 16)}
                onChange={(e) => {
                  const iso = new Date(e.target.value).toISOString();
                  setDraft((d) => ({ ...d, startsAt: iso }));
                }}
                type="datetime-local"
                className="mt-2 w-full rounded-xl border border-slate-800/50 bg-slate-950 px-4 py-2 text-sm text-white focus:outline-none"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-200">Type</label>
              <select
                value={draft.type}
                onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value as EduEventType }))}
                className="mt-2 w-full rounded-xl border border-slate-800/50 bg-slate-950 px-4 py-2 text-sm text-white focus:outline-none"
              >
                <option value="concert">Concert</option>
                <option value="game">Game</option>
                <option value="assembly">Assembly</option>
                <option value="address">Address</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-200">Notes (optional)</label>
              <textarea
                value={draft.notes || ""}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                className="mt-2 w-full rounded-xl border border-slate-800/50 bg-slate-950 px-4 py-2 text-sm text-white focus:outline-none"
                rows={3}
              />
            </div>
          </div>
        </section>

        {/* Section B — Crew */}
        <section className="rounded-2xl border border-slate-800/50 bg-slate-900/50 p-5">
          <div className="mb-3 text-sm font-semibold text-white">Crew</div>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-200">Producer (required for Ready)</label>
              <input
                value={draft.producerName || ""}
                onChange={(e) => setDraft((d) => ({ ...d, producerName: e.target.value.trim() ? e.target.value : null }))}
                className="mt-2 w-full rounded-xl border border-slate-800/50 bg-slate-950 px-4 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none"
                placeholder="Producer name"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-200">Talent (optional)</label>
              <TalentEditor
                value={draft.talent}
                onChange={(next) => setDraft((d) => ({ ...d, talent: next }))}
              />
            </div>
            <label className="flex items-center justify-between rounded-xl border border-slate-800/50 bg-slate-950/40 p-4">
              <div>
                <div className="font-medium text-white">Student producer can start</div>
                <div className="text-sm text-slate-400">Default OFF</div>
              </div>
              <input
                type="checkbox"
                checked={draft.studentProducerCanStart}
                onChange={(e) => setDraft((d) => ({ ...d, studentProducerCanStart: e.target.checked }))}
              />
            </label>
          </div>
        </section>

        {/* Section C — Outputs */}
        <section className="rounded-2xl border border-slate-800/50 bg-slate-900/50 p-5">
          <div className="mb-3 text-sm font-semibold text-white">Outputs</div>
          <div className="space-y-3">
            <label className="flex items-center justify-between rounded-xl border border-slate-800/50 bg-slate-950/40 p-4">
              <div>
                <div className="font-medium text-white">Publish to Website (HLS)</div>
                <div className="text-sm text-slate-400">Default ON</div>
              </div>
              <input
                type="checkbox"
                checked={draft.outputs.publishHls}
                onChange={(e) => setDraft((d) => ({ ...d, outputs: { ...d.outputs, publishHls: e.target.checked } }))}
              />
            </label>
            <label className="flex items-center justify-between rounded-xl border border-slate-800/50 bg-slate-950/40 p-4">
              <div>
                <div className="font-medium text-white">Record to Archive</div>
                <div className="text-sm text-slate-400">Default ON</div>
              </div>
              <input
                type="checkbox"
                checked={draft.outputs.recordMp4}
                onChange={(e) => setDraft((d) => ({ ...d, outputs: { ...d.outputs, recordMp4: e.target.checked } }))}
              />
            </label>

            <div className="rounded-xl border border-slate-800/50 bg-slate-950/40 p-4">
              <div className="font-medium text-white">Advanced (faculty only)</div>
              <div className="mt-3 space-y-3">
                <label className={`flex items-center justify-between rounded-xl border border-slate-800/50 bg-slate-900/50 p-4 ${!isFacultyAdmin ? "opacity-60" : ""}`}>
                  <div>
                    <div className="font-medium text-white">Stream to YouTube</div>
                    <div className="text-sm text-slate-400">Default OFF</div>
                  </div>
                  <input
                    type="checkbox"
                    disabled={!isFacultyAdmin}
                    checked={draft.outputs.youtube}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        outputs: {
                          ...d.outputs,
                          youtube: e.target.checked,
                          youtubeDestinationId: e.target.checked ? d.outputs.youtubeDestinationId : null,
                        },
                      }))
                    }
                  />
                </label>

                {draft.outputs.youtube ? (
                  <div>
                    <label className="text-sm font-medium text-slate-200">Destination</label>
                    <select
                      disabled={!isFacultyAdmin || destLoading}
                      value={draft.outputs.youtubeDestinationId || ""}
                      onChange={(e) => setDraft((d) => ({ ...d, outputs: { ...d.outputs, youtubeDestinationId: e.target.value || null } }))}
                      className="mt-2 w-full rounded-xl border border-slate-800/50 bg-slate-950 px-4 py-2 text-sm text-white focus:outline-none disabled:opacity-60"
                    >
                      <option value="">Select a saved destination</option>
                      {destinations.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name || d.id}
                        </option>
                      ))}
                    </select>
                    {!destLoading && destinations.length === 0 ? (
                      <div className="mt-2 text-sm text-slate-500">No saved YouTube destinations found.</div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        {/* Section D — Links */}
        <section className="rounded-2xl border border-slate-800/50 bg-slate-900/50 p-5">
          <div className="mb-3 text-sm font-semibold text-white">Links</div>
          <div className="space-y-3">
            <LinkRow label="Event Studio Link" value={studioUrl} onCopy={() => void doCopy("Studio link", studioUrl)} />
            <LinkRow
              label="Event Viewer Link"
              value={viewerUrl || "(not generated yet)"}
              onCopy={() => void doCopy("Viewer link", viewerUrl)}
              disabled={!viewerUrl}
            />
            <LinkRow
              label="Embed Code (iframe)"
              value={embedCode || "(not generated yet)"}
              onCopy={() => void doCopy("Embed code", embedCode)}
              disabled={!embedCode}
              multiline
            />
          </div>
        </section>

        {/* Section E — Actions */}
        <section className="rounded-2xl border border-slate-800/50 bg-slate-900/50 p-5">
          <div className="mb-3 text-sm font-semibold text-white">Actions</div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                onChange(draft);
                onClose();
              }}
              className="rounded-xl bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:from-orange-400 hover:via-red-500 hover:to-violet-500"
            >
              Save changes
            </button>
            <button
              type="button"
              disabled={!canStartFromDrawer}
              onClick={() => onStart()}
              className={`rounded-xl px-4 py-2 text-sm font-semibold text-white ${
                canStartFromDrawer ? "bg-slate-950 hover:bg-slate-900" : "cursor-not-allowed bg-slate-800 text-slate-500"
              }`}
            >
              Start broadcast
            </button>
            <button
              type="button"
              onClick={() => onCancel()}
              className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500"
            >
              Cancel event
            </button>
          </div>
        </section>
      </div>
    </DrawerShell>
  );
}

function LinkRow({
  label,
  value,
  onCopy,
  disabled,
  multiline,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  disabled?: boolean;
  multiline?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-800/50 bg-slate-950/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-slate-200">{label}</div>
        <button
          type="button"
          disabled={!!disabled}
          onClick={onCopy}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
            disabled ? "cursor-not-allowed bg-slate-800 text-slate-500" : "bg-slate-900 text-white hover:bg-slate-800"
          }`}
        >
          Copy
        </button>
      </div>
      <div className={`mt-2 text-sm text-slate-300 ${multiline ? "whitespace-pre-wrap break-words" : "truncate"}`}>{value}</div>
    </div>
  );
}

function TalentEditor({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [newName, setNewName] = useState<string>("");
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="flex-1 rounded-xl border border-slate-800/50 bg-slate-950 px-4 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none"
          placeholder="Add a name"
        />
        <button
          type="button"
          onClick={() => {
            const v = newName.trim();
            if (!v) return;
            onChange(Array.from(new Set([...(value || []), v])));
            setNewName("");
          }}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Add
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {(value || []).map((name) => (
          <span key={name} className="inline-flex items-center gap-2 rounded-full bg-slate-800/60 px-3 py-1 text-xs text-slate-200">
            {name}
            <button
              type="button"
              onClick={() => onChange((value || []).filter((x) => x !== name))}
              className="text-slate-400 hover:text-white"
              aria-label="Remove"
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
