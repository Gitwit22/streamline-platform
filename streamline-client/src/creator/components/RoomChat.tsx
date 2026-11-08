/**
 * Room chat — the single, persisted chat used everywhere in the room.
 *
 * Source of truth: the server chat API (routes/roomChat.ts) backed by
 * Firestore rooms/{roomId}/chatSessions/{sessionId}/messages. Horizon's chat
 * hooks read and write the same store. Live updates arrive over SSE; a
 * localStorage cache paints the last known messages instantly on reopen.
 *
 * One RoomChatProvider per room (Room.tsx) owns the state, so the stage chat
 * panel and the host dashboard show the same messages over one SSE stream,
 * and closing/reopening either view never loses history.
 */
import React from "react";
import { useLocalParticipant } from "@livekit/components-react";
import { splitLinks } from "../../lib/linkify";
import { CHAT_ATTACHMENT_ACCEPT, formatBytes, validateChatFile, type ChatMsg } from "../../lib/roomChat";
import { RoomChatContext, useRoomChat, type RoomChatState } from "../hooks/useRoomChat";

/* ── Provider ───────────────────────────────────────────────────────── */


export function RoomChatProvider({
  roomId,
  roomAccessToken,
  displayName,
  localIdentity,
  enabled,
  canUpload,
  children,
}: {
  roomId: string;
  roomAccessToken: string;
  displayName?: string;
  localIdentity?: string | null;
  enabled?: boolean;
  canUpload?: boolean;
  children: React.ReactNode;
}) {
  const chat = useRoomChat({ roomId, roomAccessToken, displayName, localIdentity, enabled, canUpload });
  return <RoomChatContext.Provider value={chat}>{children}</RoomChatContext.Provider>;
}

/**
 * Provider for use inside <LiveKitRoom>: takes the sender name / identity
 * from the local LiveKit participant (same fallback as the dashboard).
 */
export function LiveKitRoomChatProvider(props: {
  roomId: string;
  roomAccessToken: string;
  enabled?: boolean;
  canUpload?: boolean;
  children: React.ReactNode;
}) {
  const { localParticipant } = useLocalParticipant();
  const lkName = typeof localParticipant?.name === "string" ? localParticipant.name.trim() : "";
  const displayName = React.useMemo(() => {
    if (lkName) return lkName;
    try {
      return (localStorage.getItem("sl_displayName") || "").trim() || undefined;
    } catch {
      return undefined;
    }
  }, [lkName]);
  return (
    <RoomChatProvider
      roomId={props.roomId}
      roomAccessToken={props.roomAccessToken}
      displayName={displayName}
      localIdentity={localParticipant?.identity || null}
      enabled={props.enabled}
      canUpload={props.canUpload}
    >
      {props.children}
    </RoomChatProvider>
  );
}


/* ── View pieces ────────────────────────────────────────────────────── */

export function ChatMessageText({ text }: { text: string }) {
  const segments = React.useMemo(() => splitLinks(text), [text]);
  return (
    <>
      {segments.map((s, i) =>
        s.type === "link" ? (
          <a
            key={i}
            href={s.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            style={{ color: "#93c5fd", textDecoration: "underline", wordBreak: "break-all" }}
          >
            {s.value}
          </a>
        ) : (
          <React.Fragment key={i}>{s.value}</React.Fragment>
        ),
      )}
    </>
  );
}

function AttachmentCard({ msg, onDownload }: { msg: ChatMsg; onDownload: (m: ChatMsg) => void }) {
  const att = msg.attachment!;
  return (
    <div
      data-testid="chat-attachment"
      style={{
        marginTop: 4,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(255,255,255,0.05)",
        maxWidth: "100%",
      }}
    >
      <span aria-hidden="true">📎</span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={att.name}>
          {att.name}
        </span>
        {att.size > 0 && <span style={{ fontSize: 11, opacity: 0.7 }}>{formatBytes(att.size)}</span>}
      </span>
      <button
        type="button"
        onClick={() => onDownload(msg)}
        aria-label={`Download ${att.name}`}
        style={{
          padding: "4px 8px",
          borderRadius: 8,
          border: "1px solid rgba(59,130,246,0.35)",
          background: "rgba(59,130,246,0.18)",
          color: "#fff",
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        Download
      </button>
    </div>
  );
}

export function ChatMessageList({
  chat,
  maxHeight,
  style,
}: {
  chat: RoomChatState;
  maxHeight?: number | string;
  style?: React.CSSProperties;
}) {
  const bottomRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    try {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    } catch {
      // ignore
    }
  }, [chat.messages.length]);

  return (
    <div
      data-testid="chat-messages"
      style={{
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(15,23,42,0.35)",
        borderRadius: 12,
        padding: 10,
        maxHeight,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        ...style,
      }}
    >
      {chat.messages.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.7 }}>{chat.loading ? "Loading…" : "No messages yet."}</div>
      ) : (
        chat.messages.map((m) => (
          <div key={m.id} style={{ fontSize: 12, lineHeight: 1.35, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            <span style={{ color: "rgba(255,255,255,0.75)", fontWeight: 700 }}>
              {(m.sender?.name || m.sender?.role || "Someone") + ": "}
            </span>
            {m.text && (
              <span style={{ color: "rgba(255,255,255,0.92)" }}>
                <ChatMessageText text={m.text} />
              </span>
            )}
            {m.attachment && <AttachmentCard msg={m} onDownload={(msg) => void chat.downloadAttachment(msg)} />}
          </div>
        ))
      )}
      <div ref={bottomRef} />
    </div>
  );
}

export function ChatComposer({ chat }: { chat: RoomChatState }) {
  const [draft, setDraft] = React.useState("");
  const [pendingFile, setPendingFile] = React.useState<File | null>(null);
  const [sending, setSending] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const busy = sending || chat.uploading;
  const canSend = !busy && (!!draft.trim() || !!pendingFile);

  const submit = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const ok = pendingFile ? await chat.sendFile(pendingFile, draft) : await chat.sendText(draft);
      // Keep the draft/file on failure so nothing typed is lost.
      if (ok) {
        setDraft("");
        setPendingFile(null);
      }
    } finally {
      setSending(false);
    }
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    const invalid = validateChatFile(file);
    if (invalid) {
      setPendingFile(null);
      chat.reportError(invalid);
      return;
    }
    chat.clearError();
    setPendingFile(file);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {pendingFile && (
        <div
          data-testid="chat-pending-file"
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "rgba(255,255,255,0.85)" }}
        >
          <span aria-hidden="true">📎</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }} title={pendingFile.name}>
            {pendingFile.name} <span style={{ opacity: 0.7 }}>({formatBytes(pendingFile.size)})</span>
          </span>
          <button
            type="button"
            onClick={() => setPendingFile(null)}
            disabled={busy}
            aria-label="Remove file"
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.8)", cursor: "pointer", fontSize: 14 }}
          >
            ×
          </button>
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        {chat.canUpload && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={CHAT_ATTACHMENT_ACCEPT}
              onChange={onPickFile}
              style={{ display: "none" }}
              data-testid="chat-file-input"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              title="Share a file (up to 25 MB)"
              aria-label="Attach a file"
              style={{
                padding: "10px 10px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(255,255,255,0.06)",
                color: "rgba(255,255,255,0.9)",
                fontSize: 13,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              📎
            </button>
          </>
        )}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={
            pendingFile ? "Add a note (optional)…" : chat.sessionId ? "Type a message…" : "Chat will start when you send"
          }
          maxLength={800}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(255,255,255,0.06)",
            color: "rgba(255,255,255,0.9)",
            outline: "none",
            fontSize: 13,
          }}
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSend}
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(59,130,246,0.20)",
            background: !canSend ? "rgba(59,130,246,0.08)" : "rgba(59,130,246,0.18)",
            color: "rgba(255,255,255,0.95)",
            fontSize: 13,
            fontWeight: 900,
            cursor: !canSend ? "not-allowed" : "pointer",
            opacity: !canSend ? 0.6 : 1,
          }}
        >
          {chat.uploading ? "Uploading…" : "Send"}
        </button>
      </div>
    </div>
  );
}

/** Side panel next to the stage (Program and Gallery views). */
export function StageChatPanel({ chat, onClose }: { chat: RoomChatState; onClose: () => void }) {
  return (
    <aside className="sl-stage-chat" data-testid="stage-chat" aria-label="Room chat">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <strong style={{ fontSize: 14, color: "#fff" }}>Chat</strong>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          style={{ background: "none", border: "none", color: "rgba(255,255,255,0.8)", fontSize: 18, cursor: "pointer" }}
        >
          ×
        </button>
      </div>
      {chat.error && (
        <div role="alert" style={{ fontSize: 12, color: "rgba(248,113,113,0.95)" }}>
          {chat.error}
        </div>
      )}
      <ChatMessageList chat={chat} style={{ flex: 1, minHeight: 0 }} />
      <ChatComposer chat={chat} />
    </aside>
  );
}
