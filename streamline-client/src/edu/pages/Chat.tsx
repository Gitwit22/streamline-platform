import { useEffect, useState, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useEduMe } from "../layout/EduProtectedRoute";
import {
  fetchEduChatRooms,
  fetchEduMessages,
  sendEduMessage,
  createEduChatRoom,
  fetchEduChatStaff,
  fetchEduChatOnline,
  sendEduChatHeartbeat,
  type EduChatRoom,
  type EduChatMessage,
  type EduChatStaffMember,
  type EduChatOnlineStaff,
} from "../api/chat";
import { getEduCallTokenDM } from "../api/callToken";
import { getOrCreateDirectChatRoom } from "../api/directComms";

/* ── Helpers ────────────────────────────────────────────────────── */

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function formatMsgTime(ms: number | null) {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/* ── Component ─────────────────────────────────────────────────── */

export default function EduChat() {
  const me = useEduMe();
  const location = useLocation();
  const navState = location.state as { directRoomId?: string; targetName?: string } | null;

  const [rooms, setRooms] = useState<EduChatRoom[]>([]);
  const [messages, setMessages] = useState<EduChatMessage[]>([]);
  const [selectedRoom, setSelectedRoom] = useState("");
  const [loading, setLoading] = useState(true);
  const [msgLoading, setMsgLoading] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showNewRoom, setShowNewRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");
  const [callTarget, setCallTarget] = useState<string | null>(null);
  const [roomsError, setRoomsError] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  /* Staff & online presence state */
  const [allStaff, setAllStaff] = useState<EduChatStaffMember[]>([]);
  const [onlineStaff, setOnlineStaff] = useState<EduChatOnlineStaff[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [dmBusy, setDmBusy] = useState<string | null>(null);

  /* ── Load staff + online ─────────────────────────────────── */
  const loadStaffAndOnline = useCallback(async () => {
    setStaffLoading(true);
    try {
      const [staffData, onlineData] = await Promise.all([
        fetchEduChatStaff().catch(() => [] as EduChatStaffMember[]),
        fetchEduChatOnline().catch(() => [] as EduChatOnlineStaff[]),
      ]);
      setAllStaff(staffData);
      setOnlineStaff(onlineData);
    } finally {
      setStaffLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStaffAndOnline();
  }, [loadStaffAndOnline]);

  /* ── Heartbeat (every 120s) + refresh online list ────────── */
  useEffect(() => {
    // Send initial heartbeat
    sendEduChatHeartbeat().catch(() => {});

    const interval = setInterval(() => {
      sendEduChatHeartbeat().catch(() => {});
      // Refresh online list every heartbeat
      fetchEduChatOnline()
        .then((data) => setOnlineStaff(data))
        .catch(() => {});
    }, 120_000);

    return () => clearInterval(interval);
  }, []);

  /* ── Derive online uid set for quick lookups ─────────────── */
  const onlineUids = new Set(onlineStaff.map((s) => s.uid));

  /* ── Message auto-refresh (every 30s — keeps Firestore reads low) ── */
  useEffect(() => {
    if (!selectedRoom) return;
    const interval = setInterval(() => {
      fetchEduMessages(selectedRoom, { limit: 50 })
        .then((data) => setMessages(data))
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(interval);
  }, [selectedRoom]);

  /* ── Click staff → open DM ───────────────────────────────── */
  const handleStaffDM = async (staffUid: string) => {
    if (dmBusy || staffUid === me?.uid) return;
    setDmBusy(staffUid);
    try {
      const { roomId } = await getOrCreateDirectChatRoom(staffUid);
      // Reload rooms so the DM appears in the sidebar
      const data = await fetchEduChatRooms();
      setRooms(data);
      setSelectedRoom(roomId);
    } catch (err: any) {
      console.error("[Chat] DM error:", err?.message || err);
    } finally {
      setDmBusy(null);
    }
  };

  /* ── Load rooms ──────────────────────────────────────────── */
  const loadRooms = useCallback(async (retryCount = 0) => {
    setLoading(true);
    setRoomsError(false);
    try {
      const data = await fetchEduChatRooms();
      setRooms(data);
      // If navigated with a direct room ID, select it; otherwise default to first
      if (navState?.directRoomId) {
        const exists = data.some((r: EduChatRoom) => r.id === navState.directRoomId);
        if (exists) {
          setSelectedRoom(navState.directRoomId);
        } else if (data.length > 0 && !selectedRoom) {
          setSelectedRoom(data[0].id);
        }
        // Clear nav state so refresh doesn't re-select
        window.history.replaceState({}, "");
      } else if (data.length > 0 && !selectedRoom) {
        setSelectedRoom(data[0].id);
      }
    } catch {
      // Retry once after a short delay (auth token may still be propagating)
      if (retryCount < 1) {
        await new Promise((r) => setTimeout(r, 1500));
        return loadRooms(retryCount + 1);
      }
      setRooms([]);
      setRoomsError(true);
    } finally {
      setLoading(false);
    }
  }, [selectedRoom]);

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  /* ── Load messages ───────────────────────────────────────── */
  const loadMessages = useCallback(
    async (roomId: string) => {
      if (!roomId) return;
      setMsgLoading(true);
      try {
        const data = await fetchEduMessages(roomId, { limit: 50 });
        setMessages(data);
      } catch {
        setMessages([]);
      } finally {
        setMsgLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (selectedRoom) loadMessages(selectedRoom);
  }, [selectedRoom, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* ── Send message ────────────────────────────────────────── */
  const handleSend = async () => {
    if (!input.trim() || !selectedRoom) return;
    setSending(true);
    try {
      const msg = await sendEduMessage(selectedRoom, input.trim());
      setMessages((prev) => [...prev, msg]);
      setInput("");
    } finally {
      setSending(false);
    }
  };

  /* ── Create room ─────────────────────────────────────────── */
  const handleCreateRoom = async () => {
    if (!newRoomName.trim()) return;
    try {
      const room = await createEduChatRoom({ name: newRoomName.trim() });
      setRooms((prev) => [room, ...prev]);
      setSelectedRoom(room.id);
      setNewRoomName("");
      setShowNewRoom(false);
    } catch {
      /* noop */
    }
  };

  const currentRoom = rooms.find((r) => r.id === selectedRoom);

  const sections = rooms.reduce<Record<string, EduChatRoom[]>>((acc, r) => {
    const sec = r.section || "general";
    if (!acc[sec]) acc[sec] = [];
    acc[sec].push(r);
    return acc;
  }, {});

  /* ── Render ──────────────────────────────────────────────── */

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* ── Room sidebar ──────────────────────────────────────── */}
      <div className="flex w-[260px] flex-col border-r border-slate-700 bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3.5">
          <h2 className="text-sm font-semibold text-white">Faculty Chat</h2>
          <button
            onClick={() => setShowNewRoom(true)}
            className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>

        {showNewRoom && (
          <div className="flex gap-2 border-b border-slate-700 px-3 py-2">
            <input
              autoFocus
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateRoom()}
              placeholder="Room name…"
              className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-white outline-none focus:border-orange-500"
            />
            <button onClick={handleCreateRoom} className="text-xs font-semibold text-orange-400">
              Add
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
            </div>
          )}
          {!loading && rooms.length === 0 && (
            <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
              <div className="text-sm text-slate-400">
                {roomsError ? "Couldn't load rooms" : "No chat rooms yet"}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                {roomsError ? "There was a problem loading your chat rooms." : "Click + to create your first room"}
              </div>
              {roomsError && (
                <button
                  onClick={() => loadRooms()}
                  className="mt-3 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-orange-400 transition hover:bg-slate-700"
                >
                  Retry
                </button>
              )}
            </div>
          )}

          {Object.entries(sections).map(([section, sectionRooms]) => (
            <div key={section}>
              <div className="px-4 pb-1 pt-4 font-mono text-[10px] font-semibold uppercase tracking-[1.8px] text-slate-500">
                {section}
              </div>
              {sectionRooms.map((room) => (
                <button
                  key={room.id}
                  onClick={() => setSelectedRoom(room.id)}
                  className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                    room.id === selectedRoom
                      ? "border-r-2 border-orange-500 bg-orange-500/10"
                      : "hover:bg-slate-800/60"
                  }`}
                >
                  {room.isPrivate ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 flex-shrink-0 text-slate-500">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  ) : (
                    <span className="text-sm font-bold text-slate-500">#</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white">{room.name}</div>
                    <div className="truncate text-[11px] text-slate-500">{room.lastMessage || "No messages yet"}</div>
                  </div>
                  {room.unreadCount > 0 && (
                    <span className="rounded-full bg-orange-500 px-[7px] py-0.5 font-mono text-[10px] font-bold text-white">
                      {room.unreadCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ── Main chat area ────────────────────────────────────── */}
      <div className="flex flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-slate-700 bg-slate-900/60 px-5 py-3">
          {currentRoom?.isPrivate ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 text-slate-400">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          ) : (
            <span className="text-base font-bold text-slate-400">#</span>
          )}
          <span className="text-sm font-semibold text-white">{currentRoom?.name || "Select a room"}</span>
          {currentRoom && <span className="ml-2 text-xs text-slate-500">{currentRoom.memberCount} members</span>}

          {currentRoom && (
            <button
              onClick={() => setCallTarget(currentRoom.id)}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-orange-500/20 bg-orange-500/10 px-3 py-1.5 text-xs font-medium text-orange-300 transition hover:bg-orange-500/20"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              Start Call
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
          {msgLoading && (
            <div className="flex items-center justify-center py-8">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
            </div>
          )}
          {!msgLoading && messages.length === 0 && (
            <div className="py-12 text-center text-sm text-slate-400">No messages yet. Start the conversation!</div>
          )}
          {messages.map((msg) => {
            const isMe = msg.senderUid === me?.uid;
            return (
              <div key={msg.id} className="flex gap-3">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-700 to-slate-800 text-[11px] font-bold text-white">
                  {initials(msg.senderName)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{isMe ? "You" : msg.senderName}</span>
                    <span className="font-mono text-[10px] text-slate-500">{formatMsgTime(msg.createdAt)}</span>
                  </div>
                  <p className="mt-0.5 text-sm leading-relaxed text-slate-300">{msg.content}</p>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Composer */}
        <div className="border-t border-slate-700 px-5 py-3">
          <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 cursor-pointer text-slate-500 hover:text-white">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              placeholder={`Message #${currentRoom?.name || ""}…`}
              className="flex-1 border-none bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
            />
            <button
              onClick={handleSend}
              disabled={sending || !input.trim()}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-r from-orange-500 to-red-600 text-white disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── Staff sidebar (right) ─────────────────────────────── */}
      <div className="flex w-[240px] flex-col border-l border-slate-700 bg-slate-900">
        {/* Online Now */}
        <div className="border-b border-slate-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Online Now
              <span className="ml-1 text-green-400">({onlineStaff.length})</span>
            </h3>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {/* Online staff */}
          {staffLoading ? (
            <div className="flex items-center justify-center py-6">
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
            </div>
          ) : onlineStaff.length === 0 ? (
            <div className="px-4 py-4 text-xs text-slate-500">No staff online</div>
          ) : (
            <div className="px-2 py-2">
              {onlineStaff.map((s) => (
                <button
                  key={s.uid}
                  onClick={() => handleStaffDM(s.uid)}
                  disabled={s.uid === me?.uid || dmBusy === s.uid}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
                    s.uid === me?.uid ? "cursor-default" : "cursor-pointer hover:bg-slate-800/60"
                  } ${dmBusy === s.uid ? "opacity-60" : ""}`}
                >
                  <div className="relative flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-green-600/30 to-green-800/30 text-[10px] font-bold text-green-300">
                    {initials(s.userName)}
                    <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-slate-900 bg-green-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-white">
                      {s.uid === me?.uid ? "You" : s.userName}
                    </div>
                    <div className="truncate text-[10px] text-slate-500">
                      {s.orgRole === "faculty_admin" ? "Admin" : "Teacher"}
                    </div>
                  </div>
                  {dmBusy === s.uid && (
                    <div className="h-3 w-3 animate-spin rounded-full border border-orange-500 border-t-transparent" />
                  )}
                </button>
              ))}
            </div>
          )}

          {/* All Staff divider */}
          <div className="border-t border-slate-700/60 px-4 py-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              All Staff
              <span className="ml-1 text-slate-500">({allStaff.length})</span>
            </h3>
          </div>

          {/* All staff list */}
          {staffLoading ? (
            <div className="flex items-center justify-center py-6">
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
            </div>
          ) : allStaff.length === 0 ? (
            <div className="px-4 py-4 text-xs text-slate-500">No staff found</div>
          ) : (
            <div className="px-2 py-2">
              {allStaff.map((s) => {
                const isOnline = onlineUids.has(s.uid);
                return (
                  <button
                    key={s.uid}
                    onClick={() => handleStaffDM(s.uid)}
                    disabled={s.uid === me?.uid || dmBusy === s.uid}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
                      s.uid === me?.uid ? "cursor-default" : "cursor-pointer hover:bg-slate-800/60"
                    } ${dmBusy === s.uid ? "opacity-60" : ""}`}
                  >
                    <div className="relative flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-700 to-slate-800 text-[10px] font-bold text-white">
                      {initials(s.name)}
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-slate-900 ${
                          isOnline ? "bg-green-500" : "bg-slate-600"
                        }`}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-white">
                        {s.uid === me?.uid ? "You" : s.name}
                      </div>
                      <div className="flex items-center gap-1 truncate text-[10px] text-slate-500">
                        <span>{s.role === "faculty_admin" ? "Admin" : "Teacher"}</span>
                        {s.department && (
                          <>
                            <span className="text-slate-600">·</span>
                            <span>{s.department}</span>
                          </>
                        )}
                      </div>
                    </div>
                    {dmBusy === s.uid ? (
                      <div className="h-3 w-3 animate-spin rounded-full border border-orange-500 border-t-transparent" />
                    ) : isOnline ? (
                      <span className="text-[9px] font-medium text-green-400">online</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Call toast */}
      {callTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-orange-500/20 to-red-600/20">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-8 w-8 text-orange-400">
                <path d="M15.75 10.5l4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9A2.25 2.25 0 0 0 13.5 5.25h-9A2.25 2.25 0 0 0 2.25 7.5v9A2.25 2.25 0 0 0 4.5 18.75z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-white">Start a call?</h3>
            <p className="mt-1 text-sm text-slate-400">
              Calling <span className="text-orange-300">#{rooms.find((r) => r.id === callTarget)?.name || "channel"}</span>
            </p>
            <p className="mt-3 text-xs text-slate-500">
              A LiveKit video room will be created for all channel members.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setCallTarget(null)}
                className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void getEduCallTokenDM(callTarget);
                  setCallTarget(null);
                }}
                className="flex-1 rounded-xl bg-gradient-to-r from-orange-500 to-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Start Call
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
