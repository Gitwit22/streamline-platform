import { useEffect, useState, useCallback } from "react";
import { useEduMe } from "../layout/EduProtectedRoute";
import { isEduBypassEnabled } from "../state/eduMode";
import { demoSeedId, demoDocId, demoStorageKey } from "../../lib/demoPaths";
import {
  fetchEduCalls,
  createEduCall,
  updateEduCall,
  type EduCall,
} from "../api/calls";

/* ── Tabs ──────────────────────────────────────────────────────── */

const tabs = ["Active Calls", "Scheduled", "Recordings"] as const;
type Tab = (typeof tabs)[number];

/* ── Demo data ─────────────────────────────────────────────────── */

const demoCalls: EduCall[] = [
  {
    id: demoSeedId("edu", "call", 1),
    title: "Morning Broadcast Prep",
    status: "active",
    scheduledAt: Date.now() - 720_000,
    startedAt: Date.now() - 720_000,
    endedAt: null,
    duration: null,
    participants: ["PJ", "MC", "MR"],
    department: "Media Arts",
    hasRecording: true,
    hasTranscript: false,
    recordingUrl: demoStorageKey("edu", "recordings", "demo-admin", "call-1", "recording.mp4"),
    createdAt: Date.now(),
    createdBy: "",
  },
  {
    id: demoSeedId("edu", "call", 2),
    title: "Faculty Meeting",
    status: "scheduled",
    scheduledAt: Date.now() + 3_600_000,
    startedAt: null,
    endedAt: null,
    duration: null,
    participants: ["PJ", "MC", "MR", "DP", "LK", "JB"],
    department: "Administration",
    hasRecording: false,
    hasTranscript: false,
    recordingUrl: "",
    createdAt: Date.now(),
    createdBy: "",
  },
  {
    id: demoSeedId("edu", "call", 3),
    title: "Event Planning Sync",
    status: "scheduled",
    scheduledAt: Date.now() + 7_200_000,
    startedAt: null,
    endedAt: null,
    duration: null,
    participants: ["MC", "MR", "JT"],
    department: "Events",
    hasRecording: false,
    hasTranscript: false,
    recordingUrl: "",
    createdAt: Date.now(),
    createdBy: "",
  },
  {
    id: demoSeedId("edu", "call", 4),
    title: "Homecoming Broadcast Review",
    status: "completed",
    scheduledAt: Date.now() - 86400_000,
    startedAt: Date.now() - 86400_000,
    endedAt: Date.now() - 86400_000 + 2700_000,
    duration: 2700_000,
    participants: [],
    department: "Media Arts",
    hasRecording: true,
    hasTranscript: false,
    recordingUrl: demoStorageKey("edu", "recordings", "demo-admin", "call-4", "recording.mp4"),
    createdAt: Date.now() - 86400_000,
    createdBy: "",
  },
];

/* ── Helpers ────────────────────────────────────────────────────── */

function formatTime(ms: number | null) {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/* ── Component ─────────────────────────────────────────────────── */

export default function EduCalls() {
  const me = useEduMe();
  const isDemo = isEduBypassEnabled();

  const [activeTab, setActiveTab] = useState<Tab>("Active Calls");
  const [calls, setCalls] = useState<EduCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (isDemo) {
        setCalls(demoCalls);
      } else {
        const data = await fetchEduCalls({ limit: 50 });
        setCalls(data);
      }
    } catch {
      setCalls([]);
    } finally {
      setLoading(false);
    }
  }, [isDemo]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      if (isDemo) {
        setCalls((prev) => [
          {
            id: demoDocId("edu", "call"),
            title: newTitle.trim(),
            status: "scheduled",
            scheduledAt: Date.now() + 3600_000,
            startedAt: null,
            endedAt: null,
            duration: null,
            participants: [],
            department: "",
            hasRecording: false,
            hasTranscript: false,
            recordingUrl: "",
            createdAt: Date.now(),
            createdBy: "",
          },
          ...prev,
        ]);
      } else {
        const c = await createEduCall({ title: newTitle.trim() });
        setCalls((prev) => [c, ...prev]);
      }
      setNewTitle("");
      setShowNew(false);
    } finally {
      setCreating(false);
    }
  };

  const handleEndCall = async (c: EduCall) => {
    if (isDemo) {
      setCalls((prev) =>
        prev.map((x) => (x.id === c.id ? { ...x, status: "completed" as const, endedAt: Date.now() } : x)),
      );
    } else {
      const updated = await updateEduCall(c.id, { status: "completed" });
      setCalls((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
    }
  };

  const filtered = calls.filter((c) => {
    if (activeTab === "Active Calls") return c.status === "active";
    if (activeTab === "Scheduled") return c.status === "scheduled";
    if (activeTab === "Recordings") return c.hasRecording;
    return true;
  });

  const activeCall = calls.find((c) => c.status === "active");

  /* ── Render ──────────────────────────────────────────────── */

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex items-center gap-0.5 border-b border-slate-700">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`-mb-px border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === tab
                ? "border-orange-500 text-orange-300"
                : "border-transparent text-slate-400 hover:text-white"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Faculty Calls</h1>
          <p className="mt-1 text-sm text-slate-400">
            Video meetings for faculty — screen sharing, recording, and collaboration.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
          New Call
        </button>
      </div>

      {/* New call form */}
      {showNew && (
        <div className="flex items-center gap-3 rounded-2xl border border-orange-500/20 bg-slate-800/50 p-4">
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="Call title…"
            className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-orange-500 placeholder:text-slate-500"
          />
          <button
            disabled={creating || !newTitle.trim()}
            onClick={handleCreate}
            className="rounded-xl bg-gradient-to-r from-orange-500 to-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create"}
          </button>
          <button
            onClick={() => setShowNew(false)}
            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-slate-700"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Active call card */}
      {activeCall && activeTab === "Active Calls" && (
        <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-800/50">
          <div className="relative flex aspect-video max-h-[300px] items-center justify-center bg-slate-950">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-orange-500/30 to-red-600/30 text-2xl font-bold text-orange-300">
                {activeCall.title.charAt(0)}
              </div>
              <p className="font-semibold text-white">{activeCall.title}</p>
              <p className="mt-1 text-sm text-slate-400">
                {activeCall.participants.length} participants · {activeCall.startedAt ? formatTime(activeCall.startedAt) : ""}
              </p>
            </div>
            {/* Participant avatars */}
            <div className="absolute right-4 top-4 flex flex-col gap-2">
              {activeCall.participants.slice(0, 3).map((p, i) => (
                <div
                  key={i}
                  className="flex h-12 w-12 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-xs font-bold text-slate-300"
                >
                  {typeof p === "string" ? p.slice(0, 2).toUpperCase() : "?"}
                </div>
              ))}
            </div>
          </div>
          {/* Call controls */}
          <div className="flex items-center justify-center gap-3 border-t border-slate-700 bg-slate-900 py-4">
            {[
              { label: "Mic", d: "M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" },
              { label: "Camera", d: "M15.75 10.5l4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9A2.25 2.25 0 0 0 13.5 5.25h-9A2.25 2.25 0 0 0 2.25 7.5v9A2.25 2.25 0 0 0 4.5 18.75z" },
              { label: "Share", d: "M13 2.5V5c5.523 0 10 4.477 10 10 0 .727-.078 1.436-.225 2.118l-.002.007A10 10 0 0 1 13 22v2.5l-7-5 7-5V17a7.5 7.5 0 0 0 0-15z" },
              { label: "Record", d: "M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0-20 0" },
            ].map((ctrl) => (
              <button
                key={ctrl.label}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-300 transition hover:bg-slate-700 hover:text-white"
                title={ctrl.label}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                  <path d={ctrl.d} />
                </svg>
              </button>
            ))}
            <button
              onClick={() => handleEndCall(activeCall)}
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-600 text-white transition hover:bg-red-500"
              title="End Call"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div className="py-12 text-center text-sm text-slate-400">No {activeTab.toLowerCase()} found</div>
      )}

      {/* Call list */}
      {!loading && filtered.length > 0 && (activeTab !== "Active Calls" || !activeCall) && (
        <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-800/50">
          <div className="flex items-center justify-between border-b border-slate-700 px-5 py-3.5">
            <span className="text-sm font-semibold text-white">{activeTab}</span>
            <span className="font-mono text-xs text-slate-500">{filtered.length} items</span>
          </div>
          {filtered.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-3.5 border-b border-slate-700/50 px-5 py-3.5 transition-colors last:border-b-0 hover:bg-slate-800"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-orange-500/20 bg-orange-500/10">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4 text-orange-400">
                  <path d="M15.75 10.5l4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9A2.25 2.25 0 0 0 13.5 5.25h-9A2.25 2.25 0 0 0 2.25 7.5v9A2.25 2.25 0 0 0 4.5 18.75z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-white">{c.title}</div>
                <div className="mt-0.5 text-[11px] text-slate-400">
                  {c.department}
                  {c.department ? " · " : ""}
                  {c.participants.length} participant{c.participants.length !== 1 ? "s" : ""}
                  {c.duration ? ` · ${Math.round(c.duration / 60_000)}m` : ""}
                </div>
              </div>
              <span className="font-mono text-xs text-slate-500">{formatTime(c.scheduledAt)}</span>
              {c.status === "scheduled" && (
                <button
                  onClick={() => {
                    if (isDemo) {
                      setCalls((prev) =>
                        prev.map((x) =>
                          x.id === c.id ? { ...x, status: "active" as const, startedAt: Date.now() } : x,
                        ),
                      );
                    } else {
                      updateEduCall(c.id, { status: "active" }).then((u) =>
                        setCalls((prev) => prev.map((x) => (x.id === c.id ? u : x))),
                      );
                    }
                  }}
                  className="rounded-lg bg-gradient-to-r from-orange-500 to-red-600 px-3 py-1.5 text-[11px] font-semibold text-white"
                >
                  Join
                </button>
              )}
              {c.hasRecording && (
                <span className="rounded-full border border-orange-500/20 bg-orange-500/10 px-2 py-0.5 text-[10px] font-medium text-orange-300">
                  Recording
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
