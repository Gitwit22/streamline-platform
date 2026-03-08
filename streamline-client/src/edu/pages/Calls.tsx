import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useEduMe } from "../layout/EduProtectedRoute";
import {
  fetchEduCalls,
  createEduCall,
  updateEduCall,
  type EduCall,
} from "../api/calls";
import { getEduCallTokenDM } from "../api/callToken";
import {
  fetchPendingStaff,
  type PendingStaffRecord,
} from "../api/schoolPortal";
import {
  listEduPeopleFromApi,
  type EduPerson,
} from "../api/people";
import type { Room as LkRoom } from "livekit-client";

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

  // New call user picker state
  const [newCallSearch, setNewCallSearch] = useState("");
  const [selectedCallUser, setSelectedCallUser] = useState<{ id: string; name: string; role: string } | null>(null);
  const [newCallUsersLoading, setNewCallUsersLoading] = useState(false);
  const [newCallUsers, setNewCallUsers] = useState<{ id: string; name: string; role: string; status: string }[]>([]);

  // Call controls state
  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [recording, setRecording] = useState(false);

  // LiveKit connection state
  const lkRoomRef = useRef<LkRoom | null>(null);
  const [lkConnected, setLkConnected] = useState(false);
  const [lkError, setLkError] = useState<string | null>(null);
  const [connectingLk, setConnectingLk] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  // Elapsed time ticker
  const [tick, setTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Add participant — staff picker
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [staffSearch, setStaffSearch] = useState("");
  const [staffList, setStaffList] = useState<{ id: string; name: string; role: string; status: string }[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [selectedStaffIds, setSelectedStaffIds] = useState<Set<string>>(new Set());

  const activeCall = calls.find((c) => c.status === "active");

  /* ── LiveKit connect / disconnect ─────────────────────────── */

  const connectToLiveKit = useCallback(async (targetUserId: string) => {
    setConnectingLk(true);
    setLkError(null);
    try {
      const { token, roomName, livekitUrl } = await getEduCallTokenDM(targetUserId);
      if (!livekitUrl) throw new Error("LiveKit URL not configured on server");

      const { Room: LkRoomClass, RoomEvent, Track } = await import("livekit-client");
      const lkRoom = new LkRoomClass({ adaptiveStream: true, dynacast: true });
      lkRoomRef.current = lkRoom;

      lkRoom.on(RoomEvent.Disconnected, () => {
        console.warn("[EduCalls] LiveKit disconnected");
        lkRoomRef.current = null;
        setLkConnected(false);
      });

      // Attach remote tracks
      lkRoom.on(RoomEvent.TrackSubscribed, (track, _pub, _participant) => {
        if (track.kind === Track.Kind.Video && remoteVideoRef.current) {
          track.attach(remoteVideoRef.current);
        } else if (track.kind === Track.Kind.Audio && remoteAudioRef.current) {
          track.attach(remoteAudioRef.current);
        }
      });

      lkRoom.on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach();
      });

      await lkRoom.connect(livekitUrl, token);

      // Enable camera + mic by default
      await lkRoom.localParticipant.setCameraEnabled(true);
      await lkRoom.localParticipant.setMicrophoneEnabled(true);

      // Attach local camera to preview
      const camPub = lkRoom.localParticipant.getTrackPublication(Track.Source.Camera);
      if (camPub?.track && localVideoRef.current) {
        camPub.track.attach(localVideoRef.current);
      }

      setLkConnected(true);
      setMicMuted(false);
      setCamOff(false);
      console.log("[EduCalls] Connected to LiveKit room:", roomName);
    } catch (err: any) {
      console.error("[EduCalls] LiveKit connect error:", err);
      setLkError(err?.message || "Failed to connect to call");
      lkRoomRef.current = null;
    } finally {
      setConnectingLk(false);
    }
  }, []);

  const disconnectLiveKit = useCallback(() => {
    if (lkRoomRef.current) {
      try { lkRoomRef.current.disconnect(); } catch { /* ignore */ }
      lkRoomRef.current = null;
    }
    setLkConnected(false);
    setMicMuted(false);
    setCamOff(false);
    setScreenSharing(false);
    setRecording(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (lkRoomRef.current) {
        try { lkRoomRef.current.disconnect(); } catch { /* ignore */ }
        lkRoomRef.current = null;
      }
    };
  }, []);

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

  // Load active users for the new-call picker
  const loadNewCallUsers = useCallback(async () => {
    setNewCallUsersLoading(true);
    try {
      const [staffRecords, people] = await Promise.all([
        fetchPendingStaff().catch(() => [] as PendingStaffRecord[]),
        listEduPeopleFromApi({ limit: 200 }).catch(() => [] as EduPerson[]),
      ]);
      const merged = new Map<string, { id: string; name: string; role: string; status: string }>();
      for (const s of staffRecords) {
        if (s.status === "active" && s.id !== me.uid) {
          merged.set(s.id, { id: s.id, name: s.fullName, role: s.positionTitle || s.role, status: s.status });
        }
      }
      for (const p of people) {
        if (p.status === "active" && !merged.has(p.id) && p.id !== me.uid) {
          merged.set(p.id, { id: p.id, name: p.name, role: p.role.replace(/_/g, " "), status: p.status });
        }
      }
      setNewCallUsers(Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name)));
    } catch {
      setNewCallUsers([]);
    } finally {
      setNewCallUsersLoading(false);
    }
  }, [me.uid]);

  // Filtered users for new-call search
  const filteredNewCallUsers = useMemo(() => {
    if (!newCallSearch.trim()) return newCallUsers;
    const q = newCallSearch.toLowerCase();
    return newCallUsers.filter(
      (u) => u.name.toLowerCase().includes(q) || u.role.toLowerCase().includes(q),
    );
  }, [newCallUsers, newCallSearch]);

  // Load active staff for the add-participant picker
  const loadStaff = useCallback(async () => {
    setStaffLoading(true);
    try {
      // Fetch from both staff records and people list, merge unique entries
      const [staffRecords, people] = await Promise.all([
        fetchPendingStaff().catch(() => [] as PendingStaffRecord[]),
        listEduPeopleFromApi({ limit: 200 }).catch(() => [] as EduPerson[]),
      ]);

      const merged = new Map<string, { id: string; name: string; role: string; status: string }>();

      // Active staff from staff records
      for (const s of staffRecords) {
        if (s.status === "active") {
          merged.set(s.id, {
            id: s.id,
            name: s.fullName,
            role: s.positionTitle || s.role,
            status: s.status,
          });
        }
      }

      // Active people (faculty/staff)
      for (const p of people) {
        if (p.status === "active" && !merged.has(p.id)) {
          merged.set(p.id, {
            id: p.id,
            name: p.name,
            role: p.role.replace(/_/g, " "),
            status: p.status,
          });
        }
      }

      setStaffList(Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name)));
    } catch {
      setStaffList([]);
    } finally {
      setStaffLoading(false);
    }
  }, []);

  // Filtered staff for search
  const filteredStaff = useMemo(() => {
    if (!staffSearch.trim()) return staffList;
    const q = staffSearch.toLowerCase();
    return staffList.filter(
      (s) => s.name.toLowerCase().includes(q) || s.role.toLowerCase().includes(q),
    );
  }, [staffList, staffSearch]);

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
    if (!selectedCallUser) return;
    setCreating(true);
    try {
      const title = `Call with ${selectedCallUser.name}`;
      const c = await createEduCall({ title, participants: [selectedCallUser.id] });

      // Immediately activate the call
      const activated = await updateEduCall(c.id, { status: "active" });
      setCalls((prev) => [activated, ...prev]);

      setNewTitle("");
      setSelectedCallUser(null);
      setNewCallSearch("");
      setShowNew(false);
      setActiveTab("Active Calls");

      // Connect to LiveKit with the target user
      await connectToLiveKit(selectedCallUser.id);
    } catch (err: any) {
      console.error("[EduCalls] create error:", err);
      setLkError(err?.message || "Failed to start call");
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
    setStaffSearch("");
    setSelectedStaffIds(new Set());

    const updated = await updateEduCall(c.id, { status: "active" });
    setCalls((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
    // Switch to Active Calls tab so the user sees the call UI
    setActiveTab("Active Calls");

    // Connect to LiveKit — use the first participant that isn't us
    const targetUid = c.participants.find((p) => p !== me.uid) || c.createdBy;
    if (targetUid && targetUid !== me.uid) {
      await connectToLiveKit(targetUid);
    }
  };

  const handleEndCall = async (c: EduCall) => {
    // Disconnect LiveKit first
    disconnectLiveKit();

    const updated = await updateEduCall(c.id, { status: "completed" });
    setCalls((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
  };

  const handleAddSelectedStaff = () => {
    if (selectedStaffIds.size === 0 || !activeCall) return;
    const newNames = staffList
      .filter((s) => selectedStaffIds.has(s.id))
      .map((s) => {
        // Generate initials from name, or short name if initials are too short
        const parts = s.name.trim().split(/\s+/);
        return parts.length >= 2
          ? parts.map((w) => w[0]).join("").toUpperCase().slice(0, 2)
          : s.name.slice(0, 2).toUpperCase();
      });
    setCalls((prev) =>
      prev.map((x) =>
        x.id === activeCall.id
          ? { ...x, participants: [...x.participants, ...newNames] }
          : x,
      ),
    );
    setSelectedStaffIds(new Set());
    setStaffSearch("");
    setShowAddParticipant(false);
  };

  const toggleStaffSelection = (id: string) => {
    setSelectedStaffIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
          onClick={() => { setShowNew(true); loadNewCallUsers(); }}
          className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
          New Call
        </button>
      </div>

      {/* New call — user picker */}
      {showNew && (
        <div className="rounded-2xl border border-orange-500/20 bg-slate-800/50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-white">Select a user to call</span>
            <button
              onClick={() => { setShowNew(false); setSelectedCallUser(null); setNewCallSearch(""); }}
              className="text-slate-400 hover:text-white"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Search input */}
          <div className="relative mb-3">
            <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              autoFocus
              value={newCallSearch}
              onChange={(e) => setNewCallSearch(e.target.value)}
              placeholder="Search users…"
              className="w-full rounded-xl border border-slate-700 bg-slate-900 py-2.5 pl-9 pr-3 text-sm text-white outline-none focus:border-orange-500 placeholder:text-slate-500"
            />
          </div>

          {/* User list */}
          <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900">
            {newCallUsersLoading && (
              <div className="flex items-center justify-center py-6">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
              </div>
            )}
            {!newCallUsersLoading && filteredNewCallUsers.length === 0 && (
              <div className="py-6 text-center text-xs text-slate-500">
                {newCallUsers.length === 0 ? "No active users found" : "No matches"}
              </div>
            )}
            {!newCallUsersLoading && filteredNewCallUsers.map((u) => {
              const selected = selectedCallUser?.id === u.id;
              return (
                <button
                  key={u.id}
                  onClick={() => setSelectedCallUser(selected ? null : u)}
                  className={`flex w-full items-center gap-3 border-b border-slate-800 px-4 py-3 text-left transition last:border-b-0 ${
                    selected
                      ? "bg-orange-500/15 ring-1 ring-inset ring-orange-500/40"
                      : "hover:bg-slate-800"
                  }`}
                >
                  {/* Avatar */}
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    selected
                      ? "bg-orange-500/30 text-orange-200"
                      : "bg-slate-700 text-slate-300"
                  }`}>
                    {u.name.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2) || "?"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white">{u.name}</div>
                    <div className="truncate text-xs text-slate-400">{u.role}</div>
                  </div>
                  {/* Online dot */}
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-green-500" title="Online" />
                  {/* Selection ring */}
                  <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${
                    selected
                      ? "border-orange-500 bg-orange-500"
                      : "border-slate-600 bg-transparent"
                  }`}>
                    {selected && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" className="h-3 w-3">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Action row */}
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              {selectedCallUser ? `Call ${selectedCallUser.name}` : "Choose a user above"}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowNew(false); setSelectedCallUser(null); setNewCallSearch(""); }}
                className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                disabled={creating || !selectedCallUser}
                onClick={handleCreate}
                className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                {creating ? "Calling…" : "Call"}
              </button>
            </div>
          </div>
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

            {/* Video feeds */}
            <div className="absolute inset-0 flex items-center justify-center">
              {/* Remote video (full area) */}
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="h-full w-full object-cover"
              />
              <audio ref={remoteAudioRef} autoPlay />
              {/* Local video (picture-in-picture) */}
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="absolute bottom-4 right-4 h-32 w-44 rounded-xl border-2 border-slate-600 bg-slate-950 object-cover shadow-lg"
              />
            </div>

            {/* Connecting / error overlay */}
            {connectingLk && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 z-10">
                <div className="flex flex-col items-center gap-3">
                  <div className="h-8 w-8 animate-spin rounded-full border-3 border-orange-500 border-t-transparent" />
                  <span className="text-sm text-slate-300">Connecting…</span>
                </div>
              </div>
            )}
            {lkError && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 z-10">
                <div className="flex flex-col items-center gap-2 text-center px-6">
                  <span className="text-red-400 text-sm">{lkError}</span>
                  <button onClick={() => setLkError(null)} className="text-xs text-slate-400 hover:text-white">Dismiss</button>
                </div>
              </div>
            )}
            {!lkConnected && !connectingLk && !lkError && (
              <div className="text-center z-10">
                <div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-orange-500/30 to-red-600/30 text-2xl font-bold text-orange-300">
                  {activeCall.title.charAt(0)}
                </div>
                <p className="font-semibold text-white">{activeCall.title}</p>
                <p className="mt-1 text-sm text-slate-400">Waiting for connection…</p>
              </div>
            )}

            {lkConnected && (
              <div className="absolute bottom-4 left-4 z-10">
                <p className="text-xs text-green-400 font-medium">● Connected</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {activeCall.participants.length} participant{activeCall.participants.length !== 1 ? "s" : ""}
                  {activeCall.startedAt ? ` · Started ${formatTime(activeCall.startedAt)}` : ""}
                </p>
              </div>
            )}
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
                onClick={() => { if (!showAddParticipant) loadStaff(); setShowAddParticipant(!showAddParticipant); }}
                className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-slate-600 bg-slate-900/50 text-slate-400 transition hover:border-orange-500/40 hover:text-orange-300"
                title="Call a staff member"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </div>

            {/* Staff picker popover */}
            {showAddParticipant && (
              <div className="absolute right-20 top-4 z-10 w-72 rounded-xl border border-slate-700 bg-slate-900 shadow-xl">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-700/50 px-3 py-2.5">
                  <span className="text-xs font-semibold text-slate-200">Call Staff Member</span>
                  <button
                    onClick={() => { setShowAddParticipant(false); setStaffSearch(""); setSelectedStaffIds(new Set()); }}
                    className="text-slate-500 hover:text-white"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Search */}
                <div className="px-3 py-2">
                  <div className="relative">
                    <svg className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                    </svg>
                    <input
                      autoFocus
                      value={staffSearch}
                      onChange={(e) => setStaffSearch(e.target.value)}
                      placeholder="Search active staff…"
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 py-1.5 pl-8 pr-3 text-xs text-white outline-none placeholder:text-slate-500 focus:border-orange-500"
                    />
                  </div>
                </div>

                {/* Staff list */}
                <div className="max-h-48 overflow-y-auto border-t border-slate-700/50 px-1.5 py-1">
                  {staffLoading && (
                    <div className="flex items-center justify-center py-4">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
                    </div>
                  )}
                  {!staffLoading && filteredStaff.length === 0 && (
                    <div className="py-4 text-center text-[11px] text-slate-500">
                      {staffList.length === 0 ? "No active staff found" : "No matches"}
                    </div>
                  )}
                  {!staffLoading && filteredStaff.map((s) => {
                    const selected = selectedStaffIds.has(s.id);
                    return (
                      <button
                        key={s.id}
                        onClick={() => toggleStaffSelection(s.id)}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${
                          selected
                            ? "bg-orange-500/15 ring-1 ring-orange-500/40"
                            : "hover:bg-slate-800"
                        }`}
                      >
                        {/* Avatar */}
                        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                          selected
                            ? "bg-orange-500/30 text-orange-200"
                            : "bg-slate-700 text-slate-300"
                        }`}>
                          {s.name.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2) || "?"}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium text-white">{s.name}</div>
                          <div className="truncate text-[10px] text-slate-400">{s.role}</div>
                        </div>
                        {/* Online indicator */}
                        <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" title="Active" />
                        {/* Checkbox */}
                        <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                          selected
                            ? "border-orange-500 bg-orange-500"
                            : "border-slate-600 bg-slate-800"
                        }`}>
                          {selected && (
                            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" className="h-3 w-3">
                              <path d="M20 6L9 17l-5-5" />
                            </svg>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Action footer */}
                <div className="flex items-center justify-between border-t border-slate-700/50 px-3 py-2">
                  <span className="text-[10px] text-slate-500">
                    {selectedStaffIds.size > 0 ? `${selectedStaffIds.size} selected` : "Select staff to call"}
                  </span>
                  <button
                    onClick={handleAddSelectedStaff}
                    disabled={selectedStaffIds.size === 0}
                    className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-orange-500 to-red-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                    Call
                  </button>
                </div>
              </div>
            )}
          </div>
          {/* Call controls */}
          <div className="flex items-center justify-center gap-3 border-t border-slate-700 bg-slate-900 py-4">
            {/* Mic toggle */}
            <button
              onClick={async () => {
                const room = lkRoomRef.current;
                if (room) {
                  const next = !micMuted;
                  await room.localParticipant.setMicrophoneEnabled(!next);
                  setMicMuted(next);
                } else {
                  setMicMuted(!micMuted);
                }
              }}
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
              onClick={async () => {
                const room = lkRoomRef.current;
                if (room) {
                  const next = !camOff;
                  await room.localParticipant.setCameraEnabled(!next);
                  setCamOff(next);
                  // Re-attach or detach local preview
                  if (!next && localVideoRef.current) {
                    const { Track } = await import("livekit-client");
                    const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
                    if (camPub?.track) camPub.track.attach(localVideoRef.current);
                  } else if (localVideoRef.current) {
                    localVideoRef.current.srcObject = null;
                  }
                } else {
                  setCamOff(!camOff);
                }
              }}
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
              onClick={async () => {
                const room = lkRoomRef.current;
                if (room) {
                  const next = !screenSharing;
                  await room.localParticipant.setScreenShareEnabled(next);
                  setScreenSharing(next);
                } else {
                  setScreenSharing(!screenSharing);
                }
              }}
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
