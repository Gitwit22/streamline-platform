import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useEduMe } from "../layout/EduProtectedRoute";
import { apiFetchAuth } from "../../lib/api";

/* ── Types ─────────────────────────────────────────────────────── */

type RoomType = "meeting" | "broadcast" | "hybrid";
type DefaultLayout = "grid" | "speaker" | "single" | "custom";

type Room = {
  id: string;
  name: string;
  description: string;
  isLive: boolean;
  participantCount: number;
  createdBy: string;
  roomType: RoomType;
  broadcastEnabled: boolean;
  recordingEnabled: boolean;
  defaultLayout: DefaultLayout;
  shareableExternally: boolean;
  allowedRoles: string[];
};

const ROOM_TYPE_META: Record<RoomType, { label: string; icon: string; color: string; bgColor: string }> = {
  meeting: { label: "Meeting", icon: "👥", color: "text-blue-400", bgColor: "bg-blue-500/15" },
  broadcast: { label: "Broadcast", icon: "📡", color: "text-red-400", bgColor: "bg-red-500/15" },
  hybrid: { label: "Hybrid", icon: "⚡", color: "text-purple-400", bgColor: "bg-purple-500/15" },
};

const LAYOUT_LABELS: Record<DefaultLayout, string> = {
  grid: "Grid",
  speaker: "Speaker",
  single: "Single",
  custom: "Custom",
};

/* ── Component ─────────────────────────────────────────────────── */

export default function Rooms() {
  const me = useEduMe();
  const nav = useNavigate();
  const isFacultyAdmin =
    String(me?.orgRole || me?.role || "") === "faculty_admin";

  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<RoomType | "all">("all");
  const [showCreate, setShowCreate] = useState(false);

  // Create form state
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newType, setNewType] = useState<RoomType>("meeting");
  const [newBroadcast, setNewBroadcast] = useState(false);
  const [newRecording, setNewRecording] = useState(false);
  const [newLayout, setNewLayout] = useState<DefaultLayout>("grid");
  const [newShareable, setNewShareable] = useState(false);
  const [creating, setCreating] = useState(false);

  // Edit modal state
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editType, setEditType] = useState<RoomType>("meeting");
  const [editBroadcast, setEditBroadcast] = useState(false);
  const [editRecording, setEditRecording] = useState(false);
  const [editLayout, setEditLayout] = useState<DefaultLayout>("grid");
  const [editShareable, setEditShareable] = useState(false);
  const [saving, setSaving] = useState(false);

  // Delete confirmation state
  const [deletingRoom, setDeletingRoom] = useState<Room | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await apiFetchAuth("/api/edu/rooms?limit=100");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (mounted) setRooms(data.rooms || []);
      } catch (e: any) {
        if (mounted) setError(e?.message || "Failed to load rooms");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const filtered = useMemo(() => {
    let list = rooms;
    if (typeFilter !== "all") {
      list = list.filter((r) => r.roomType === typeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q),
      );
    }
    return list;
  }, [rooms, search, typeFilter]);

  const resetCreateForm = () => {
    setNewName("");
    setNewDesc("");
    setNewType("meeting");
    setNewBroadcast(false);
    setNewRecording(false);
    setNewLayout("grid");
    setNewShareable(false);
    setShowCreate(false);
  };

  // Auto-set broadcastEnabled when type changes (create)
  useEffect(() => {
    if (newType === "broadcast") setNewBroadcast(true);
    else if (newType === "meeting") setNewBroadcast(false);
  }, [newType]);

  // Auto-set broadcastEnabled when type changes (edit)
  useEffect(() => {
    if (editType === "broadcast") setEditBroadcast(true);
    else if (editType === "meeting") setEditBroadcast(false);
  }, [editType]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);

    try {
      const res = await apiFetchAuth("/api/edu/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDesc.trim(),
          roomType: newType,
          broadcastEnabled: newBroadcast,
          recordingEnabled: newRecording,
          defaultLayout: newLayout,
          shareableExternally: newShareable,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRooms((prev) => [...prev, data.room]);
      resetCreateForm();
    } catch (e: any) {
      setError(e?.message || "Failed to create room");
    } finally {
      setCreating(false);
    }
  };

  const openEditModal = (room: Room) => {
    setEditingRoom(room);
    setEditName(room.name);
    setEditDesc(room.description);
    setEditType(room.roomType);
    setEditBroadcast(room.broadcastEnabled);
    setEditRecording(room.recordingEnabled);
    setEditLayout(room.defaultLayout);
    setEditShareable(room.shareableExternally);
  };

  const closeEditModal = () => {
    setEditingRoom(null);
    setEditName("");
    setEditDesc("");
    setEditType("meeting");
    setEditBroadcast(false);
    setEditRecording(false);
    setEditLayout("grid");
    setEditShareable(false);
  };

  const handleEdit = async () => {
    if (!editingRoom || !editName.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetchAuth(`/api/edu/rooms/${editingRoom.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDesc.trim(),
          roomType: editType,
          broadcastEnabled: editBroadcast,
          recordingEnabled: editRecording,
          defaultLayout: editLayout,
          shareableExternally: editShareable,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRooms((prev) =>
        prev.map((r) =>
          r.id === editingRoom.id
            ? {
                ...r,
                name: editName.trim(),
                description: editDesc.trim(),
                roomType: editType,
                broadcastEnabled: editBroadcast,
                recordingEnabled: editRecording,
                defaultLayout: editLayout,
                shareableExternally: editShareable,
              }
            : r,
        ),
      );
      closeEditModal();
    } catch (e: any) {
      setError(e?.message || "Failed to update room");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingRoom) return;
    setDeleting(true);
    try {
      const res = await apiFetchAuth(`/api/edu/rooms/${deletingRoom.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setRooms((prev) => prev.filter((r) => r.id !== deletingRoom.id));
      setDeletingRoom(null);
    } catch (e: any) {
      setError(e?.message || "Failed to delete room");
    } finally {
      setDeleting(false);
    }
  };

  // Counts by type
  const counts = useMemo(() => {
    const c = { all: rooms.length, meeting: 0, broadcast: 0, hybrid: 0 };
    rooms.forEach((r) => { c[r.roomType] = (c[r.roomType] || 0) + 1; });
    return c;
  }, [rooms]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-slate-800" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-2xl bg-slate-800/50" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Broadcast Rooms</h1>
          <p className="mt-1 text-sm text-slate-400">
            Reusable internal production spaces for your school
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Rooms define crew spaces &amp; defaults. Broadcasts go live from{" "}
            <button type="button" onClick={() => nav("/streamline/edu/broadcast")} className="text-orange-400 hover:text-orange-300 underline underline-offset-2">
              Broadcast Studio
            </button>.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search broadcast rooms..."
              className="rounded-xl border border-slate-700 bg-slate-800/50 py-2.5 pl-10 pr-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-orange-500"
            />
          </div>
          {isFacultyAdmin && (
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-xl bg-gradient-to-r from-orange-500 to-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
            >
              + Create Broadcast Room
            </button>
          )}
        </div>
      </div>

      {/* Type Filter Tabs */}
      <div className="flex gap-2">
        {(["all", "meeting", "broadcast", "hybrid"] as const).map((t) => {
          const active = typeFilter === t;
          const label = t === "all" ? "All" : ROOM_TYPE_META[t].label;
          const count = counts[t];
          return (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                active
                  ? "bg-orange-500/15 text-orange-300"
                  : "bg-slate-800/50 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              {label} ({count})
            </button>
          );
        })}
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
      )}

      {/* Room Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((room) => {
          const meta = ROOM_TYPE_META[room.roomType];
          return (
            <div
              key={room.id}
              onClick={() => nav(`/streamline/edu/rooms/${room.id}/prejoin`)}
              className="group cursor-pointer rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6 transition hover:border-slate-600 hover:shadow-lg hover:shadow-orange-500/5"
            >
              {/* Top row: type badge + live indicator */}
              <div className="flex items-start justify-between">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${meta.bgColor} ${meta.color}`}>
                  <span>{meta.icon}</span> {meta.label}
                </span>
                {room.isLive && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-400">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> LIVE
                  </span>
                )}
              </div>

              {/* Name & description */}
              <h3 className="mt-3 font-semibold text-white group-hover:text-orange-200">{room.name}</h3>
              <p className="mt-1 text-sm text-slate-400 line-clamp-2">{room.description}</p>

              {/* Feature pills */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {room.broadcastEnabled && (
                  <span className="rounded-full bg-slate-700/60 px-2 py-0.5 text-[10px] text-slate-300">📡 Broadcast</span>
                )}
                {room.recordingEnabled && (
                  <span className="rounded-full bg-slate-700/60 px-2 py-0.5 text-[10px] text-slate-300">🔴 Recording</span>
                )}
                {room.shareableExternally && (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">🌐 Shareable</span>
                )}
                <span className="rounded-full bg-slate-700/60 px-2 py-0.5 text-[10px] text-slate-300">
                  🎬 {LAYOUT_LABELS[room.defaultLayout]}
                </span>
              </div>

              {/* Footer */}
              <div className="mt-4 flex items-center justify-between border-t border-slate-700/50 pt-3">
                <span className="text-xs text-slate-500">
                  {room.participantCount > 0 ? `${room.participantCount} in room` : "Empty"}
                </span>
                <div className="flex items-center gap-2">
                  {isFacultyAdmin && (
                    <>
                      <button
                        title="Edit room"
                        onClick={(e) => { e.stopPropagation(); openEditModal(room); }}
                        className="rounded-lg bg-slate-700/60 px-2 py-1.5 text-xs text-slate-400 transition hover:bg-blue-500/20 hover:text-blue-300"
                      >
                        ✏️
                      </button>
                      <button
                        title="Delete room"
                        onClick={(e) => { e.stopPropagation(); setDeletingRoom(room); }}
                        className="rounded-lg bg-slate-700/60 px-2 py-1.5 text-xs text-slate-400 transition hover:bg-red-500/20 hover:text-red-300"
                      >
                        🗑️
                      </button>
                    </>
                  )}
                  <span className="rounded-lg bg-slate-700/60 px-3 py-1.5 text-xs text-slate-300 transition group-hover:bg-orange-500/20 group-hover:text-orange-300">
                    Enter Room →
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="col-span-full rounded-2xl border border-slate-700 bg-slate-800/50 p-12 text-center">
            <div className="text-4xl">🏫</div>
            <div className="mt-3 text-lg font-semibold text-slate-300">
              {search || typeFilter !== "all" ? "No broadcast rooms match your filters" : "No broadcast rooms yet"}
            </div>
            <div className="mt-1 text-sm text-slate-500">
              {isFacultyAdmin
                ? "Create a broadcast room to get started — meetings, broadcasts, or hybrid."
                : "Your school admin hasn't created any broadcast rooms yet."}
            </div>
          </div>
        )}
      </div>

      {/* ── Delete Confirmation Modal ──────────────────────── */}
      {deletingRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" onClick={() => setDeletingRoom(null)} className="absolute inset-0 bg-black/60" aria-label="Close" />
          <div className="relative w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold text-white">Delete Room</h2>
            <p className="mt-2 text-sm text-slate-400">
              Are you sure you want to delete <span className="font-semibold text-white">{deletingRoom.name}</span>?
              This action cannot be undone.
            </p>
            {deletingRoom.isLive && (
              <p className="mt-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
                ⚠️ This room is currently live. You must end the broadcast before deleting.
              </p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setDeletingRoom(null)}
                className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting || deletingRoom.isLive}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete Room"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Room Modal ────────────────────────────────── */}
      {editingRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" onClick={closeEditModal} className="absolute inset-0 bg-black/60" aria-label="Close" />
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold text-white">Edit Room</h2>
            <p className="mt-1 text-sm text-slate-400">Update the room settings below.</p>

            <div className="mt-5 space-y-5">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-slate-300">Room Name</label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-orange-500"
                  placeholder="e.g. Morning Announcements"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-slate-300">Description</label>
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-orange-500"
                  placeholder="What is this room for?"
                />
              </div>

              {/* Room Type */}
              <div>
                <label className="block text-sm font-medium text-slate-300">Room Type</label>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(["meeting", "broadcast", "hybrid"] as const).map((t) => {
                    const m = ROOM_TYPE_META[t];
                    const active = editType === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setEditType(t)}
                        className={`rounded-xl border p-3 text-center transition ${
                          active
                            ? "border-orange-500 bg-orange-500/10"
                            : "border-slate-700 bg-slate-800/50 hover:border-slate-600"
                        }`}
                      >
                        <div className="text-xl">{m.icon}</div>
                        <div className="mt-1 text-xs font-medium text-white">{m.label}</div>
                        <div className="mt-0.5 text-[10px] text-slate-400">
                          {t === "meeting" && "No broadcast"}
                          {t === "broadcast" && "Always broadcasts"}
                          {t === "hybrid" && "Optional broadcast"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Options row */}
              <div className="grid grid-cols-2 gap-4">
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={editBroadcast}
                    onChange={(e) => setEditBroadcast(e.target.checked)}
                    disabled={editType === "broadcast" || editType === "meeting"}
                    className="rounded border-slate-600 bg-slate-800 text-orange-500 focus:ring-orange-500 disabled:opacity-40"
                  />
                  Broadcast
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={editRecording}
                    onChange={(e) => setEditRecording(e.target.checked)}
                    className="rounded border-slate-600 bg-slate-800 text-orange-500 focus:ring-orange-500"
                  />
                  Recording
                </label>
              </div>

              {/* External embed sharing */}
              <div className="rounded-xl border border-slate-700 bg-slate-800/30 p-4">
                <label className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-white">🌐 Allow external website embedding</div>
                    <div className="mt-1 text-xs text-slate-400">When enabled, this room can be selected as a source on the Website Embed page for public viewers.</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={editShareable}
                    onChange={(e) => setEditShareable(e.target.checked)}
                    className="rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500"
                  />
                </label>
              </div>

              {/* Default Layout */}
              {(editBroadcast || editType === "broadcast") && (
                <div>
                  <label className="block text-sm font-medium text-slate-300">Default Layout</label>
                  <div className="mt-2 flex gap-2">
                    {(["grid", "speaker", "single", "custom"] as const).map((l) => (
                      <button
                        key={l}
                        type="button"
                        onClick={() => setEditLayout(l)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                          editLayout === l
                            ? "border-orange-500 bg-orange-500/10 text-orange-300"
                            : "border-slate-700 bg-slate-800/50 text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        {LAYOUT_LABELS[l]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={closeEditModal}
                className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleEdit}
                disabled={saving || !editName.trim()}
                className="rounded-xl bg-gradient-to-r from-orange-500 to-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create Room Modal ──────────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" onClick={resetCreateForm} className="absolute inset-0 bg-black/60" aria-label="Close" />
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold text-white">Create a Broadcast Room</h2>
            <p className="mt-1 text-sm text-slate-400">A broadcast room is a persistent internal space — your crew joins here, then goes live when ready.</p>

            <div className="mt-5 space-y-5">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-slate-300">Room Name</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-orange-500"
                  placeholder="e.g. Morning Announcements"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-slate-300">Description</label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-orange-500"
                  placeholder="What is this room for?"
                />
              </div>

              {/* Room Type */}
              <div>
                <label className="block text-sm font-medium text-slate-300">Room Type</label>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(["meeting", "broadcast", "hybrid"] as const).map((t) => {
                    const m = ROOM_TYPE_META[t];
                    const active = newType === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setNewType(t)}
                        className={`rounded-xl border p-3 text-center transition ${
                          active
                            ? "border-orange-500 bg-orange-500/10"
                            : "border-slate-700 bg-slate-800/50 hover:border-slate-600"
                        }`}
                      >
                        <div className="text-xl">{m.icon}</div>
                        <div className="mt-1 text-xs font-medium text-white">{m.label}</div>
                        <div className="mt-0.5 text-[10px] text-slate-400">
                          {t === "meeting" && "No broadcast"}
                          {t === "broadcast" && "Always broadcasts"}
                          {t === "hybrid" && "Optional broadcast"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Options row */}
              <div className="grid grid-cols-2 gap-4">
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={newBroadcast}
                    onChange={(e) => setNewBroadcast(e.target.checked)}
                    disabled={newType === "broadcast" || newType === "meeting"}
                    className="rounded border-slate-600 bg-slate-800 text-orange-500 focus:ring-orange-500 disabled:opacity-40"
                  />
                  Broadcast
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={newRecording}
                    onChange={(e) => setNewRecording(e.target.checked)}
                    className="rounded border-slate-600 bg-slate-800 text-orange-500 focus:ring-orange-500"
                  />
                  Recording
                </label>
              </div>

              {/* External embed sharing */}
              <div className="rounded-xl border border-slate-700 bg-slate-800/30 p-4">
                <label className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-white">🌐 Allow external website embedding</div>
                    <div className="mt-1 text-xs text-slate-400">When enabled, this room can be selected as a source on the Website Embed page for public viewers.</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={newShareable}
                    onChange={(e) => setNewShareable(e.target.checked)}
                    className="rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500"
                  />
                </label>
              </div>

              {/* Default Layout */}
              {(newBroadcast || newType === "broadcast") && (
                <div>
                  <label className="block text-sm font-medium text-slate-300">Default Layout</label>
                  <div className="mt-2 flex gap-2">
                    {(["grid", "speaker", "single", "custom"] as const).map((l) => (
                      <button
                        key={l}
                        type="button"
                        onClick={() => setNewLayout(l)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                          newLayout === l
                            ? "border-orange-500 bg-orange-500/10 text-orange-300"
                            : "border-slate-700 bg-slate-800/50 text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        {LAYOUT_LABELS[l]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={resetCreateForm}
                className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                className="rounded-xl bg-gradient-to-r from-orange-500 to-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create Broadcast Room"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
