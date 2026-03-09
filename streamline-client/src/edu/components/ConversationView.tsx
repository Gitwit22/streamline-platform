/**
 * ConversationView — Main chat area for a selected conversation.
 *
 * Shows:
 *   • Header with conversation name, type indicator, member count
 *   • Message list with sender avatars, names, timestamps
 *   • Typing indicators
 *   • Message composer with attachment icon and send button
 */
import { useRef, useEffect } from "react";
import type { Conversation, ConversationMessage } from "../api/conversations";

/* ── Helpers ────────────────────────────────────────────────── */

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

function formatDateHeader(ms: number) {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

/* ── Props ──────────────────────────────────────────────────── */

interface Props {
  conversation: Conversation | null;
  messages: ConversationMessage[];
  currentUid: string;
  messagesLoading: boolean;
  typingUsers: { uid: string; userName: string }[];
  input: string;
  sending: boolean;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onTyping: () => void;
  dmDisplayName?: string;
}

export default function ConversationView({
  conversation,
  messages,
  currentUid,
  messagesLoading,
  typingUsers,
  input,
  sending,
  onInputChange,
  onSend,
  onTyping,
  dmDisplayName,
}: Props) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (!conversation) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-800">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-8 w-8 text-slate-500">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-white">Select a conversation</h3>
        <p className="mt-1 max-w-xs text-sm text-slate-400">
          Choose a DM or room from the sidebar, or start a new conversation from the People page.
        </p>
      </div>
    );
  }

  const isDM = conversation.type === "dm";
  const displayName = isDM && dmDisplayName ? dmDisplayName : conversation.name;

  // Group messages by date
  let lastDate = "";

  return (
    <div className="flex flex-1 flex-col">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 border-b border-slate-700 bg-slate-900/60 px-5 py-3">
        {isDM ? (
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600/30 to-blue-800/30 text-[10px] font-bold text-blue-300">
            {initials(displayName)}
          </div>
        ) : conversation.isPrivate ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 text-slate-400">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        ) : (
          <span className="text-base font-bold text-violet-400">#</span>
        )}

        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold text-white">{displayName}</span>
          {!isDM && (
            <span className="ml-2 text-xs text-slate-500">
              {conversation.participants.length} member{conversation.participants.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Members count for rooms */}
        {!isDM && (
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-400">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            {conversation.participants.length}
          </div>
        )}
      </div>

      {/* ── Messages ────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col gap-1 overflow-y-auto p-5">
        {messagesLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
            <div className="mb-2 text-3xl">
              {isDM ? "👋" : "💬"}
            </div>
            <div className="text-sm text-slate-400">
              {isDM
                ? `Start your conversation with ${displayName}`
                : "No messages yet. Start the conversation!"}
            </div>
            {isDM && (
              <div className="mt-3 flex gap-2">
                {["Hey, can you join the room?", "Event starting soon."].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => onInputChange(suggestion)}
                    className="rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-300 transition hover:border-orange-500/40 hover:text-white"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isMe = msg.senderUid === currentUid;
            const showDateHeader =
              msg.createdAt &&
              formatDateHeader(msg.createdAt) !== lastDate;
            if (msg.createdAt) lastDate = formatDateHeader(msg.createdAt);

            // Collapse sequential messages from same sender
            const prevMsg = idx > 0 ? messages[idx - 1] : null;
            const isSequential =
              prevMsg &&
              prevMsg.senderUid === msg.senderUid &&
              msg.createdAt &&
              prevMsg.createdAt &&
              msg.createdAt - prevMsg.createdAt < 120_000; // 2 min window

            return (
              <div key={msg.id}>
                {showDateHeader && (
                  <div className="my-4 flex items-center gap-3">
                    <div className="flex-1 border-t border-slate-700/60" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      {formatDateHeader(msg.createdAt!)}
                    </span>
                    <div className="flex-1 border-t border-slate-700/60" />
                  </div>
                )}
                <div className={`flex gap-3 ${isSequential ? "mt-0.5" : "mt-4"}`}>
                  {/* Avatar (only show for first message in sequence) */}
                  {isSequential ? (
                    <div className="w-9 flex-shrink-0" />
                  ) : (
                    <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${
                      isMe
                        ? "bg-gradient-to-br from-orange-500/40 to-red-600/40"
                        : "bg-gradient-to-br from-slate-700 to-slate-800"
                    }`}>
                      {initials(msg.senderName)}
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    {/* Name + timestamp (only for first in sequence) */}
                    {!isSequential && (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">
                          {isMe ? "You" : msg.senderName}
                        </span>
                        <span className="font-mono text-[10px] text-slate-500">
                          {formatMsgTime(msg.createdAt)}
                        </span>
                      </div>
                    )}

                    {/* Message content */}
                    {msg.type === "system" ? (
                      <p className="text-xs italic text-slate-500">{msg.content}</p>
                    ) : (
                      <p className="mt-0.5 text-sm leading-relaxed text-slate-300">{msg.content}</p>
                    )}

                    {/* Attachment */}
                    {msg.attachmentUrl && (
                      <a
                        href={msg.attachmentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/60 px-2 py-1 text-xs text-blue-400 hover:text-blue-300"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3">
                          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                        </svg>
                        Attachment
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Typing indicator */}
        {typingUsers.length > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <div className="flex gap-0.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: "0ms" }} />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: "150ms" }} />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: "300ms" }} />
            </div>
            <span className="text-xs text-slate-500">
              {typingUsers.map((t) => t.userName).join(", ")}{" "}
              {typingUsers.length === 1 ? "is" : "are"} typing…
            </span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Composer ────────────────────────────────────────── */}
      <div className="border-t border-slate-700 px-5 py-3">
        <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 cursor-pointer text-slate-500 hover:text-white">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
          <input
            type="text"
            value={input}
            onChange={(e) => {
              onInputChange(e.target.value);
              onTyping();
            }}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && onSend()}
            placeholder={
              isDM && dmDisplayName
                ? `Message ${dmDisplayName}…`
                : conversation
                  ? `Message #${conversation.name || "conversation"}…`
                  : "Type a message…"
            }
            className="flex-1 border-none bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
          />
          <button
            onClick={onSend}
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
  );
}
