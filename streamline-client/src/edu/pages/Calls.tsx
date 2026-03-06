import { useEffect, useState, useCallback, useRef } from "react";
import { useEduMe } from "../layout/EduProtectedRoute";
import {
  fetchEduCalls,
  createEduCall,
  updateEduCall,
  type EduCall,
} from "../api/calls";

/* ── Tabs ──────────────────────────────────────────────────────── */

const tabs = ["Active Calls", "Scheduled", "Recordings"] as const;
type Tab = (typeof tabs)[number];

/* ── Helpers ────────────────────────────────────────────────────── */

function formatTime(ms: number | null) {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* ── Component ─────────────────────────────────────────────────── */

export default function EduCalls() {
  const me = useEduMe();

  const [activeTab, setActiveTab] = useState<Tab>("Active Calls");
  const [calls, setCalls] = useState<EduCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [showNew, setShowNew] = useState(false);

  // Call controls state
  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [recording, setRecording] = useState(false);

  // Elapsed time ticker
  const [tick, setTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Add participant
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [newParticipant, setNewParticipant] = useState("");

  const activeCall = calls.find((c) => c.status === "active");

  // Tick for elapsed time when there's an active call
  useEffect(() => {
    if (activeCall?.startedAt) {
      tickRef.current = setInterval(() => setTick((t) => t + 1), 1000);
      return () => {
        if (tickRef.current) clearInterval(tickRef.current);
      };
    }
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [activeCall?.id, activeCall?.startedAt]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchEduCalls({ limit: 50 });
      setCalls(data);
    } catch {
      setCalls([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const c = await createEduCall({ title: newTitle.trim() });
      setCalls((prev) => [c, ...prev]);
      setNewTitle("");
      setShowNew(false);
    } finally {
      setCreating(false);
    }
  };

  const handleJoinCall = async (c: EduCall) => {
    // Reset controls when joining
    setMicMuted(false);
    setCamOff(false);
    setScreenSharing(false);
    setRecording(false);
    setShowAddParticipant(false);
    setNewParticipant("");

    const updated = await updateEduCall(c.id, { status: "active" });
    setCalls((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
    // Switch to Active Calls tab so the user sees the call UI
    setActiveTab("Active Calls");
  };

  const handleEndCall = async (c: EduCall) => {
    const updated = await updateEduCall(c.id, { status: "completed" });
    setCalls((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
    // Reset controls
    setMicMuted(false);
    setCamOff(false);
    setScreenSharing(false);
    setRecording(false);
  };

  const handleAddParticipant = () => {
    if (!newParticipant.trim() || !activeCall) return;
    const initials = newParticipant.trim().split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2);
    setCalls((prev) =>
      prev.map((x) =>
        x.id === activeCall.id
          ? { ...x, participants: [...x.participants, initials] }
          : x,
      ),
    );
    setNewParticipant("");
    setShowAddParticipant(false);
  };

  const filtered = calls.filter((c) => {
    if (activeTab === "Active Calls") return c.status === "active";
    if (activeTab === "Scheduled") return c.status === "scheduled";
    if (activeTab === "Recordings") return c.hasRecording;
    return true;
  });

  const elapsed = activeCall?.startedAt ? formatElapsed(Date.now() - activeCall.startedAt) : "0:00";
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void tick; // used to trigger re-render

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
            {tab === "Active Calls" && activeCall ? (
              <span className="ml-1.5 inline-flex h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            ) : null}
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
            {/* Live indicator & elapsed */}
            <div className="absolute left-4 top-4 flex items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-lg bg-red-600/90 px-2.5 py-1 text-xs font-bold text-white">
                <span className="inline-flex h-2 w-2 rounded-full bg-white animate-pulse" />
                LIVE
              </div>
              <div className="rounded-lg bg-slate-800/80 px-2.5 py-1 font-mono text-xs text-slate-300">
                {elapsed}
              </div>
              {recording && (
                <div className="flex items-center gap-1 rounded-lg bg-red-500/20 px-2 py-1 text-xs text-red-300">
                  <span className="inline-flex h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                  REC
                </div>
              )}
              {screenSharing && (
                <div className="rounded-lg bg-blue-500/20 px-2 py-1 text-xs text-blue-300">
                  Sharing Screen
                </div>
              )}
            </div>

            <div className="text-center">
              <div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-orange-500/30 to-red-600/30 text-2xl font-bold text-orange-300">
                {activeCall.title.charAt(0)}
              </div>
              <p className="font-semibold text-white">{activeCall.title}</p>
              <p className="mt-1 text-sm text-slate-400">
                {activeCall.participants.length} participant{activeCall.participants.length !== 1 ? "s" : ""}
                {activeCall.startedAt ? ` · Started ${formatTime(activeCall.startedAt)}` : ""}
              </p>
            </div>
            {/* Participant avatars */}
            <div className="absolute right-4 top-4 flex flex-col gap-2">
              {activeCall.participants.slice(0, 4).map((p, i) => (
                <div
                  key={i}
                  className="flex h-12 w-12 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-xs font-bold text-slate-300"
                >
                  {typeof p === "string" ? p.slice(0, 2).toUpperCase() : "?"}
                </div>
              ))}
              {activeCall.participants.length > 4 && (
                <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-[10px] font-medium text-slate-400">
                  +{activeCall.participants.length - 4}
                </div>
              )}
              {/* Add participant button */}
              <button
                onClick={() => setShowAddParticipant(!showAddParticipant)}
                className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-slate-600 bg-slate-900/50 text-slate-400 transition hover:border-orange-500/40 hover:text-orange-300"
                title="Add participant"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </div>

            {/* Add participant popover */}
            {showAddParticipant && (
              <div className="absolute right-20 top-4 z-10 rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-xl">
                <div className="text-xs font-medium text-slate-300 mb-2">Add Participant</div>
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={newParticipant}
                    onChange={(e) => setNewParticipant(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddParticipant()}
                    placeholder="Name…"
                    className="w-32 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white outline-none focus:border-orange-500 placeholder:text-slate-500"
                  />
                  <button
                    onClick={handleAddParticipant}
                    disabled={!newParticipant.trim()}
                    className="rounded-lg bg-orange-500 px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}
          </div>
          {/* Call controls */}
          <div className="flex items-center justify-center gap-3 border-t border-slate-700 bg-slate-900 py-4">
            {/* Mic toggle */}
            <button
              onClick={() => setMicMuted(!micMuted)}
              className={`flex h-10 w-10 items-center justify-center rounded-lg border transition ${
                micMuted
                  ? "border-red-500/40 bg-red-500/20 text-red-400"
                  : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
              }`}
              title={micMuted ? "Unmute" : "Mute"}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                {micMuted ? (
                  <>
                    <path d="M1 1l22 22M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .56-.06 1.1-.18 1.62M12 19v4m-4 0h8" />
                  </>
                ) : (
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
                )}
              </svg>
            </button>
            {/* Camera toggle */}
            <button
              onClick={() => setCamOff(!camOff)}
              className={`flex h-10 w-10 items-center justify-center rounded-lg border transition ${
                camOff
                  ? "border-red-500/40 bg-red-500/20 text-red-400"
                  : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
              }`}
              title={camOff ? "Turn Camera On" : "Turn Camera Off"}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                {camOff ? (
                  <>
                    <path d="M1 1l22 22" />
                    <path d="M15.75 10.5l4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72" />
                    <path d="M2.25 7.5A2.25 2.25 0 0 1 4.5 5.25h6.75" />
                    <path d="M15.75 16.5v.25A2.25 2.25 0 0 1 13.5 19H4.5a2.25 2.25 0 0 1-2.25-2.25v-4.5" />
                  </>
                ) : (
                  <path d="M15.75 10.5l4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9A2.25 2.25 0 0 0 13.5 5.25h-9A2.25 2.25 0 0 0 2.25 7.5v9A2.25 2.25 0 0 0 4.5 18.75z" />
                )}
              </svg>
            </button>
            {/* Screen share toggle */}
            <button
              onClick={() => setScreenSharing(!screenSharing)}
              className={`flex h-10 w-10 items-center justify-center rounded-lg border transition ${
                screenSharing
                  ? "border-blue-500/40 bg-blue-500/20 text-blue-400"
                  : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
              }`}
              title={screenSharing ? "Stop Sharing" : "Share Screen"}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
            </button>
            {/* Record toggle */}
            <button
              onClick={() => setRecording(!recording)}
              className={`flex h-10 w-10 items-center justify-center rounded-lg border transition ${
                recording
                  ? "border-red-500/40 bg-red-500/20 text-red-400"
                  : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
              }`}
              title={recording ? "Stop Recording" : "Start Recording"}
            >
              <svg viewBox="0 0 24 24" fill={recording ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                <circle cx="12" cy="12" r="10" />
                {recording && <circle cx="12" cy="12" r="4" fill="currentColor" />}
              </svg>
            </button>
            {/* End call */}
            <button
              onClick={() => handleEndCall(activeCall)}
              className="flex h-10 items-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-500"
              title="End Call"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
              End
            </button>
          </div>
          {/* Control labels */}
          <div className="flex items-center justify-center gap-3 border-t border-slate-800/50 bg-slate-900/50 px-4 py-2">
            <span className={`text-[10px] ${micMuted ? "text-red-400" : "text-slate-500"}`}>{micMuted ? "Muted" : "Mic On"}</span>
            <span className="text-slate-700">·</span>
            <span className={`text-[10px] ${camOff ? "text-red-400" : "text-slate-500"}`}>{camOff ? "Cam Off" : "Cam On"}</span>
            <span className="text-slate-700">·</span>
            <span className={`text-[10px] ${screenSharing ? "text-blue-400" : "text-slate-500"}`}>{screenSharing ? "Sharing" : "Not Sharing"}</span>
            <span className="text-slate-700">·</span>
            <span className={`text-[10px] ${recording ? "text-red-400" : "text-slate-500"}`}>{recording ? "Recording" : "Not Recording"}</span>
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
                  onClick={() => handleJoinCall(c)}
                  className="rounded-lg bg-gradient-to-r from-orange-500 to-red-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:opacity-90"
                >
                  Join
                </button>
              )}
              {c.status === "completed" && c.hasRecording && (
                <span className="rounded-full border border-orange-500/20 bg-orange-500/10 px-2 py-0.5 text-[10px] font-medium text-orange-300">
                  Recording
                </span>
              )}
              {c.status === "completed" && !c.hasRecording && (
                <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                  Completed
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
