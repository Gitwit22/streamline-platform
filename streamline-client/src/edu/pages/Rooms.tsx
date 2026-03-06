import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useEduMe } from "../layout/EduProtectedRoute";
import { isEduBypassEnabled } from "../state/eduMode";
import { DEMO_ROOMS, type DemoRoom } from "../state/demoData";
import { apiFetchAuth } from "../../lib/api";

/* ── Types ─────────────────────────────────────────────────────── */

type Room = {
  id: string;
  name: string;
  description: string;
  isLive: boolean;
  participantCount: number;
  createdBy: string;
};

/* ── Component ─────────────────────────────────────────────────── */

export default function Rooms() {
  const me = useEduMe();
  const nav = useNavigate();
  const isDemo = isEduBypassEnabled();
  const isFacultyAdmin =
    String(me?.orgRole || me?.role || "") === "faculty_admin";

  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (isDemo) {
      setRooms(
        DEMO_ROOMS.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          isLive: r.isLive,
          participantCount: r.participantCount,
          createdBy: r.createdBy,
        })),
      );
      setLoading(false);
      return;
    }

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
  }, [isDemo]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rooms;
    const q = search.toLowerCase();
    return rooms.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q),
    );
  }, [rooms, search]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);

    if (isDemo) {
      const id = `room_${Date.now()}`;
      setRooms((prev) => [
        ...prev,
        {
          id,
          name: newName.trim(),
          description: newDesc.trim(),
          isLive: false,
          participantCount: 0,
          createdBy: me?.uid || "demo",
        },
      ]);
      setNewName("");
      setNewDesc("");
      setShowCreate(false);
      setCreating(false);
      return;
    }

    try {
      const res = await apiFetchAuth("/api/edu/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRooms((prev) => [...prev, data.room]);
      setNewName("");
      setNewDesc("");
      setShowCreate(false);
    } catch (e: any) {
      setError(e?.message || "Failed to create room");
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-slate-800" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl bg-slate-800/50" />
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
          <h1 className="text-2xl font-bold text-white">Rooms</h1>
          <p className="mt-1 text-sm text-slate-400">{rooms.length} rooms total</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rooms..."
              className="rounded-xl border border-slate-700 bg-slate-800/50 py-2.5 pl-10 pr-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-orange-500"
            />
          </div>
          {isFacultyAdmin && (
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-xl bg-gradient-to-r from-orange-500 to-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
            >
              + Create Room
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
      )}

      {/* Room Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((room) => (
          <div
            key={room.id}
            className="group rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6 transition hover:border-slate-600"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                {room.isLive && (
                  <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                )}
                <h3 className="font-semibold text-white">{room.name}</h3>
              </div>
              {room.isLive && (
                <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-400">
                  LIVE
                </span>
              )}
            </div>
            <p className="mt-2 text-sm text-slate-400 line-clamp-2">{room.description}</p>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                {room.participantCount > 0 ? `${room.participantCount} participants` : "No one online"}
              </span>
              <button
                onClick={() => nav(`/streamline/edu/broadcast?room=${room.id}`)}
                className="rounded-lg bg-slate-700/60 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-700 hover:text-white"
              >
                Enter
              </button>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="col-span-full rounded-2xl border border-slate-700 bg-slate-800/50 p-12 text-center">
            <div className="text-4xl">🏫</div>
            <div className="mt-3 text-lg font-semibold text-slate-300">
              {search ? "No rooms match your search" : "No rooms yet"}
            </div>
            <div className="mt-1 text-sm text-slate-500">
              {isFacultyAdmin
                ? "Create a room to get started."
                : "Your school admin hasn't created any rooms yet."}
            </div>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" onClick={() => setShowCreate(false)} className="absolute inset-0 bg-black/60" aria-label="Close" />
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold text-white">Create a Room</h2>
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300">Room Name</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-orange-500"
                  placeholder="e.g. Morning Announcements"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300">Description</label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-orange-500"
                  placeholder="What is this room for?"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowCreate(false)}
                className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                className="rounded-xl bg-gradient-to-r from-orange-500 to-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create Room"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
