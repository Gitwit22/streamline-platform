/**
 * ChatSidebar — Left panel showing DM and Room conversations.
 *
 * Layout:
 *   Chats
 *   ──────────────────
 *   Direct Messages
 *    • Shalena
 *    • Jason
 *   Rooms
 *    • Faculty
 *    • Admin
 */
import type { Conversation } from "../api/conversations";

/* ── Helpers ────────────────────────────────────────────────── */

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function timeAgo(ms: number | null) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

/* ── Props ──────────────────────────────────────────────────── */

interface Props {
  dms: Conversation[];
  rooms: Conversation[];
  activeId: string | null;
  currentUid: string;
  onSelect: (id: string) => void;
  onCreateRoom: () => void;
  loading: boolean;
}

export default function ChatSidebar({
  dms,
  rooms,
  activeId,
  currentUid,
  onSelect,
  onCreateRoom,
  loading,
}: Props) {

  /** For DMs, show the other person's name instead of "X & Y". */
  function dmDisplayName(convo: Conversation): string {
    const otherUid = convo.participants.find((p) => p !== currentUid);
    if (otherUid && convo.participantNames[otherUid]) {
      return convo.participantNames[otherUid];
    }
    // Fallback: strip current user's name from the name
    return convo.name || "Direct Message";
  }

  function unreadCount(convo: Conversation): number {
    return convo.unreadCounts?.[currentUid] ?? 0;
  }

  return (
    <div className="flex w-[280px] flex-col border-r border-slate-700 bg-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3.5">
        <h2 className="text-sm font-semibold text-white">Chats</h2>
        <button
          onClick={onCreateRoom}
          title="New Room"
          className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
          </div>
        ) : dms.length === 0 && rooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
            <div className="text-sm text-slate-400">No conversations yet</div>
            <div className="mt-1 text-[11px] text-slate-500">
              Start a DM from the People page or create a room
            </div>
          </div>
        ) : (
          <>
            {/* ── Direct Messages ───────────────────────────── */}
            {dms.length > 0 && (
              <div>
                <div className="px-4 pb-1 pt-4 font-mono text-[10px] font-semibold uppercase tracking-[1.8px] text-slate-500">
                  Direct Messages
                </div>
                {dms.map((convo) => {
                  const unread = unreadCount(convo);
                  const displayName = dmDisplayName(convo);
                  return (
                    <button
                      key={convo.id}
                      onClick={() => onSelect(convo.id)}
                      className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                        convo.id === activeId
                          ? "border-r-2 border-orange-500 bg-orange-500/10"
                          : "hover:bg-slate-800/60"
                      }`}
                    >
                      {/* Avatar */}
                      <div className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600/30 to-blue-800/30 text-[10px] font-bold text-blue-300">
                        {initials(displayName)}
                      </div>

                      {/* Name + preview */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className={`truncate text-sm font-medium ${unread > 0 ? "text-white" : "text-slate-200"}`}>
                            {displayName}
                          </span>
                          <span className="flex-shrink-0 text-[10px] text-slate-500">
                            {timeAgo(convo.lastMessageAt)}
                          </span>
                        </div>
                        <div className="truncate text-[11px] text-slate-500">
                          {convo.lastMessage || "No messages yet"}
                        </div>
                      </div>

                      {/* Unread badge */}
                      {unread > 0 && (
                        <span className="flex-shrink-0 rounded-full bg-orange-500 px-[7px] py-0.5 font-mono text-[10px] font-bold text-white">
                          {unread > 99 ? "99+" : unread}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* ── Rooms ────────────────────────────────────── */}
            {rooms.length > 0 && (
              <div>
                <div className="px-4 pb-1 pt-4 font-mono text-[10px] font-semibold uppercase tracking-[1.8px] text-slate-500">
                  Rooms
                </div>
                {rooms.map((convo) => {
                  const unread = unreadCount(convo);
                  return (
                    <button
                      key={convo.id}
                      onClick={() => onSelect(convo.id)}
                      className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                        convo.id === activeId
                          ? "border-r-2 border-orange-500 bg-orange-500/10"
                          : "hover:bg-slate-800/60"
                      }`}
                    >
                      {/* Room icon */}
                      {convo.isPrivate ? (
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-700 to-slate-800">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 text-slate-400">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                          </svg>
                        </div>
                      ) : (
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-600/30 to-violet-800/30">
                          <span className="text-sm font-bold text-violet-300">#</span>
                        </div>
                      )}

                      {/* Name + preview */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className={`truncate text-sm font-medium ${unread > 0 ? "text-white" : "text-slate-200"}`}>
                            {convo.name || "Unnamed Room"}
                          </span>
                          <span className="flex-shrink-0 text-[10px] text-slate-500">
                            {timeAgo(convo.lastMessageAt)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 truncate text-[11px] text-slate-500">
                          <span className="truncate">{convo.lastMessage || "No messages yet"}</span>
                        </div>
                      </div>

                      {/* Unread badge */}
                      {unread > 0 && (
                        <span className="flex-shrink-0 rounded-full bg-orange-500 px-[7px] py-0.5 font-mono text-[10px] font-bold text-white">
                          {unread > 99 ? "99+" : unread}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
