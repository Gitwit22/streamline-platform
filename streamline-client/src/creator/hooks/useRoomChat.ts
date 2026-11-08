/**
 * State for the persisted room chat (see components/RoomChat.tsx for the
 * provider and views, lib/roomChat.ts for pure helpers).
 */
import React from "react";
import { apiFetch, apiFetchAuth } from "../../lib/api";
import {
  clearChatCache,
  friendlyError,
  normalizeMessage,
  readChatCache,
  readJson,
  roomHeaders,
  validateChatFile,
  writeChatCache,
  type ChatMsg,
} from "../../lib/roomChat";

const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

/* ── Hook ───────────────────────────────────────────────────────────── */

export type RoomChatState = {
  enabled: boolean;
  canUpload: boolean;
  sessionId: string | null;
  messages: ChatMsg[];
  loading: boolean;
  uploading: boolean;
  error: string | null;
  clearError: () => void;
  reportError: (message: string) => void;
  refresh: () => Promise<void>;
  sendText: (text: string) => Promise<boolean>;
  sendFile: (file: File, caption?: string) => Promise<boolean>;
  endSession: () => Promise<boolean>;
  downloadAttachment: (msg: ChatMsg) => Promise<void>;
  /** Messages from others that arrived after the last markRead(). */
  unreadCount: number;
  markRead: () => void;
};

const SESSION_POLL_MS = 30_000;
const SSE_RECONNECT_MS = 3_000;

export function useRoomChat(params: {
  roomId: string;
  roomAccessToken: string;
  displayName?: string;
  localIdentity?: string | null;
  enabled?: boolean;
  canUpload?: boolean;
}): RoomChatState {
  const { roomId, roomAccessToken, displayName, localIdentity } = params;
  const enabled = params.enabled !== false && !!roomId && !!roomAccessToken;
  const canUpload = enabled && !!params.canUpload;

  // Hydrate from cache immediately so reopening never shows an empty chat.
  const cached = React.useMemo(() => (roomId ? readChatCache(roomId) : null), [roomId]);

  const [sessionId, setSessionId] = React.useState<string | null>(cached?.sessionId ?? null);
  const [messages, setMessages] = React.useState<ChatMsg[]>(cached?.messages ?? []);
  const [loading, setLoading] = React.useState(enabled);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [lastReadAt, setLastReadAt] = React.useState<number>(() => Date.now());

  const seenIdsRef = React.useRef<Set<string>>(new Set(cached?.messages?.map((m) => m.id) ?? []));
  const sessionIdRef = React.useRef<string | null>(sessionId);
  React.useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);
  const loadSeqRef = React.useRef(0);

  // Persist to the local cache whenever messages change.
  React.useEffect(() => {
    if (enabled && sessionId && messages.length > 0) writeChatCache(roomId, sessionId, messages);
  }, [enabled, roomId, sessionId, messages]);

  /** Appends messages not seen yet (SSE replay + optimistic sends dedupe here). */
  const appendMessages = React.useCallback((incoming: ChatMsg[]) => {
    const fresh = incoming.filter((m) => {
      if (seenIdsRef.current.has(m.id)) return false;
      seenIdsRef.current.add(m.id);
      return true;
    });
    if (fresh.length > 0) setMessages((prev) => prev.concat(fresh));
  }, []);

  const loadSessionAndHistory = React.useCallback(
    async (opts?: { autostart?: boolean }) => {
      if (!enabled) return;
      const seq = ++loadSeqRef.current;
      setLoading(true);
      try {
        const autostart = opts?.autostart === false ? "0" : "1";
        const sessionRes = await apiFetch(
          `${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/chat/session?autostart=${autostart}`,
          { method: "GET", headers: roomHeaders(roomAccessToken) },
          { allowNonOk: true },
        );
        const sessionData = await readJson(sessionRes);
        if (seq !== loadSeqRef.current) return;
        if (!sessionRes.ok) {
          // Keep whatever is on screen (cache) instead of wiping it.
          setError(friendlyError(sessionData?.error, "Couldn't load chat. Retrying…"));
          return;
        }
        const sid = typeof sessionData?.sessionId === "string" ? sessionData.sessionId : null;
        if (!sid) {
          setSessionId(null);
          setMessages([]);
          seenIdsRef.current = new Set();
          clearChatCache(roomId);
          setError(null);
          return;
        }

        const msgRes = await apiFetch(
          `${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/chat/messages?sessionId=${encodeURIComponent(sid)}&limit=200`,
          { method: "GET", headers: roomHeaders(roomAccessToken) },
          { allowNonOk: true },
        );
        const msgData = await readJson(msgRes);
        if (seq !== loadSeqRef.current) return;
        if (!msgRes.ok) {
          setError(friendlyError(msgData?.error, "Couldn't load chat messages."));
          return;
        }
        const rows = Array.isArray(msgData?.messages) ? msgData.messages : [];
        const next = rows.map((m: unknown) => normalizeMessage(m, sid)).filter((m: ChatMsg | null): m is ChatMsg => !!m);
        // Keep live messages that arrived (SSE) after the history query ran.
        setMessages((prev) => {
          const ids = new Set(next.map((m: ChatMsg) => m.id));
          const tail = prev.filter((m) => m.sessionId === sid && !ids.has(m.id));
          const merged = next.concat(tail);
          seenIdsRef.current = new Set(merged.map((m: ChatMsg) => m.id));
          return merged;
        });
        setSessionId(sid);
        setError(null);
      } catch {
        if (seq === loadSeqRef.current) setError("Couldn't reach chat. Check your connection.");
      } finally {
        if (seq === loadSeqRef.current) setLoading(false);
      }
    },
    [enabled, roomId, roomAccessToken],
  );

  // Initial load (and whenever room/token changes). Deferred a tick so the
  // effect body doesn't set state synchronously (and StrictMode's mount/
  // unmount/mount doesn't fire two requests).
  React.useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => void loadSessionAndHistory(), 0);
    return () => clearTimeout(t);
  }, [enabled, loadSessionAndHistory]);

  // Live stream for the active session, reconnecting on drop. Closed when
  // the session changes/ends or the provider unmounts.
  React.useEffect(() => {
    if (!enabled || !sessionId || typeof EventSource === "undefined") return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    // EventSource can't send headers; the room token goes in `t`.
    const url = `${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/chat/stream?sessionId=${encodeURIComponent(sessionId)}&t=${encodeURIComponent(roomAccessToken)}`;

    const open = () => {
      const source = new EventSource(url);
      es = source;
      source.addEventListener("message", (ev: MessageEvent) => {
        try {
          const msg = normalizeMessage(JSON.parse(ev?.data || "{}"), sessionId);
          if (msg) appendMessages([msg]);
        } catch {
          // ignore malformed event
        }
      });
      source.addEventListener("error", () => {
        source.close();
        if (es === source) es = null;
        if (!disposed) retry = setTimeout(open, SSE_RECONNECT_MS);
      });
    };
    open();

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      es?.close();
      es = null;
    };
  }, [enabled, sessionId, roomId, roomAccessToken, appendMessages]);

  // Catch up after the tab was hidden (SSE may have been dropped).
  React.useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadSessionAndHistory({ autostart: false });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, loadSessionAndHistory]);

  // Detect session changes made elsewhere (host ended chat / a new session
  // started) without auto-starting one: SSE only covers the current session.
  React.useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await apiFetch(
          `${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/chat/session?autostart=0`,
          { method: "GET", headers: roomHeaders(roomAccessToken) },
          { allowNonOk: true },
        );
        if (!res.ok) return;
        const data = await readJson(res);
        const sid = typeof data?.sessionId === "string" ? data.sessionId : null;
        if (sid !== sessionIdRef.current) void loadSessionAndHistory({ autostart: false });
      } catch {
        // transient; next tick retries
      }
    }, SESSION_POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, roomId, roomAccessToken, loadSessionAndHistory]);

  // Session rotated under us (e.g. our send started a new one): reload it.
  const adoptSession = React.useCallback(
    (sid: string | null) => {
      if (sid && sid !== sessionIdRef.current) {
        setSessionId(sid);
        void loadSessionAndHistory({ autostart: false });
      }
    },
    [loadSessionAndHistory],
  );

  const sendText = React.useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!enabled || !text) return false;
      setError(null);
      try {
        const res = await apiFetch(
          `${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/chat/messages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...roomHeaders(roomAccessToken) },
            body: JSON.stringify({ text, displayName: displayName || undefined }),
          },
          { allowNonOk: true },
        );
        const data = await readJson(res);
        if (!res.ok) {
          setError(friendlyError(data?.error, "Message not sent. Try again."));
          return false;
        }
        const sid = typeof data?.sessionId === "string" ? data.sessionId : null;
        // Show our own message right away; SSE delivery dedupes by id.
        const own = normalizeMessage({ createdAtMs: Date.now(), ...data?.message }, sid);
        if (sid && sid === sessionIdRef.current && own) appendMessages([own]);
        adoptSession(sid);
        return true;
      } catch {
        setError("Message not sent. Check your connection.");
        return false;
      }
    },
    [enabled, roomId, roomAccessToken, displayName, appendMessages, adoptSession],
  );

  const sendFile = React.useCallback(
    async (file: File, caption?: string) => {
      if (!canUpload) return false;
      const invalid = validateChatFile(file);
      if (invalid) {
        setError(invalid);
        return false;
      }
      setError(null);
      setUploading(true);
      try {
        const form = new FormData();
        form.append("file", file, file.name);
        const text = (caption || "").trim();
        if (text) form.append("text", text);
        if (displayName) form.append("displayName", displayName);
        const res = await apiFetch(
          `${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/chat/attachments`,
          { method: "POST", headers: roomHeaders(roomAccessToken), body: form },
          { allowNonOk: true },
        );
        const data = await readJson(res);
        if (!res.ok) {
          setError(friendlyError(data?.error, "File not shared. Try again."));
          return false;
        }
        const sid = typeof data?.sessionId === "string" ? data.sessionId : null;
        const own = normalizeMessage(data?.message, sid);
        if (sid && sid === sessionIdRef.current && own) appendMessages([own]);
        adoptSession(sid);
        return true;
      } catch {
        setError("File not shared. Check your connection.");
        return false;
      } finally {
        setUploading(false);
      }
    },
    [canUpload, roomId, roomAccessToken, displayName, appendMessages, adoptSession],
  );

  const endSession = React.useCallback(async () => {
    if (!enabled) return false;
    setError(null);
    try {
      const res = await apiFetchAuth(
        `${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/chat/session/end`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...roomHeaders(roomAccessToken) },
          body: JSON.stringify({}),
        },
        { allowNonOk: true },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setError(`Couldn't end chat session. ${res.status} ${text}`.trim());
        return false;
      }
      setSessionId(null);
      setMessages([]);
      seenIdsRef.current = new Set();
      clearChatCache(roomId);
      return true;
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Failed to end session");
      return false;
    }
  }, [enabled, roomId, roomAccessToken]);

  const downloadAttachment = React.useCallback(
    async (msg: ChatMsg) => {
      const sid = msg.sessionId || sessionIdRef.current;
      if (!enabled || !msg.attachment || !sid) return;
      setError(null);
      try {
        const res = await apiFetch(
          `${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/chat/attachments/${encodeURIComponent(sid)}/${encodeURIComponent(msg.id)}`,
          { method: "GET", headers: roomHeaders(roomAccessToken) },
          { allowNonOk: true },
        );
        const data = await readJson(res);
        if (!res.ok || typeof data?.url !== "string") {
          setError(friendlyError(data?.error, "Couldn't download that file."));
          return;
        }
        // The signed URL responds with Content-Disposition: attachment, so the
        // browser downloads it and the room page stays put.
        const a = document.createElement("a");
        a.href = data.url;
        a.rel = "noopener noreferrer";
        a.download = msg.attachment.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch {
        setError("Couldn't download that file. Check your connection.");
      }
    },
    [enabled, roomId, roomAccessToken],
  );

  const unreadCount = React.useMemo(() => {
    let n = 0;
    for (const m of messages) {
      if (m.createdAtMs == null || m.createdAtMs <= lastReadAt) continue;
      if (localIdentity && m.sender?.identity === localIdentity) continue;
      n += 1;
    }
    return n;
  }, [messages, lastReadAt, localIdentity]);

  const markRead = React.useCallback(() => setLastReadAt(Date.now()), []);
  const clearError = React.useCallback(() => setError(null), []);
  const reportError = React.useCallback((message: string) => setError(message), []);
  const refresh = React.useCallback(() => loadSessionAndHistory(), [loadSessionAndHistory]);

  return {
    enabled,
    canUpload,
    sessionId,
    messages,
    loading,
    uploading,
    error,
    clearError,
    reportError,
    refresh,
    sendText,
    sendFile,
    endSession,
    downloadAttachment,
    unreadCount,
    markRead,
  };
}

/** Room-wide chat state from RoomChatProvider (null outside a provider). */
export const RoomChatContext = React.createContext<RoomChatState | null>(null);

export function useRoomChatContext(): RoomChatState | null {
  return React.useContext(RoomChatContext);
}
