import { useEffect, useState, useCallback } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useEduMe } from "../layout/EduProtectedRoute";
import { useConversations } from "../hooks/useConversations";
import ChatSidebar from "../components/ChatSidebar";
import ConversationView from "../components/ConversationView";
import {
  fetchEduChatStaff,
  fetchEduChatOnline,
  sendEduChatHeartbeat,
  type EduChatStaffMember,
  type EduChatOnlineStaff,
} from "../api/chat";

/* ── Helpers ────────────────────────────────────────────────────── */

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/* ── Component ─────────────────────────────────────────────────── */

export default function EduChat() {
  const me = useEduMe();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const navState = location.state as { conversationId?: string } | null;

  /* ── Conversations hook (DMs + Rooms + SSE) ─────────────── */
  const chat = useConversations(me?.uid);

  /* ── Local composer state (managed here, passed to ConversationView) */
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  /* ── Staff & online presence state ──────────────────────── */
  const [allStaff, setAllStaff] = useState<EduChatStaffMember[]>([]);
  const [onlineStaff, setOnlineStaff] = useState<EduChatOnlineStaff[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [dmBusy, setDmBusy] = useState<string | null>(null);

  /* ── Load staff + online ────────────────────────────────── */
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
    sendEduChatHeartbeat().catch(() => {});
    const interval = setInterval(() => {
      sendEduChatHeartbeat().catch(() => {});
      fetchEduChatOnline()
        .then((data) => setOnlineStaff(data))
        .catch(() => {});
    }, 120_000);
    return () => clearInterval(interval);
  }, []);

  /* ── Derive online uid set for quick lookups ──────────────── */
  const onlineUids = new Set(onlineStaff.map((s) => s.uid));

  /* ── Auto-select from navigation / URL params ────────────── */
  useEffect(() => {
    const fromParam = searchParams.get("c");
    const fromState = navState?.conversationId;
    const target = fromParam || fromState;
    if (target && target !== chat.activeConversationId) {
      chat.selectConversation(target);
      // Clear nav state so refresh doesn't re-select
      window.history.replaceState({}, "");
    }
  }, [searchParams, navState]);

  /* ── Click staff → open DM via new conversations API ──── */
  const handleStaffDM = async (staffUid: string) => {
    if (dmBusy || staffUid === me?.uid) return;
    setDmBusy(staffUid);
    try {
      await chat.startDM(staffUid);
    } catch (err: any) {
      console.error("[Chat] DM error:", err?.message || err);
    } finally {
      setDmBusy(null);
    }
  };

  /* ── Render ──────────────────────────────────────────────── */

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* ── Conversation sidebar (DMs + Rooms) ──────────────── */}
      <ChatSidebar
        dms={chat.dms}
        rooms={chat.rooms}
        activeId={chat.activeConversationId}
        currentUid={me?.uid || ""}
        onSelect={chat.selectConversation}
        onCreateRoom={() => { chat.createChatRoom("New Room"); }}
        loading={chat.loading}
      />

      {/* ── Main chat area ────────────────────────────────────── */}
      <ConversationView
        conversation={chat.conversations.find((c) => c.id === chat.activeConversationId) || null}
        messages={chat.messages}
        currentUid={me?.uid || ""}
        messagesLoading={chat.messagesLoading}
        typingUsers={chat.typingUsers}
        input={input}
        sending={sending}
        onInputChange={setInput}
        onSend={() => {
          if (!input.trim() || sending) return;
          setSending(true);
          chat.send(input.trim()).then(() => setInput("")).finally(() => setSending(false));
        }}
        onTyping={chat.signalTyping}
      />

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
    </div>
  );
}
