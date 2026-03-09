/**
 * useConversations — Central chat state management hook.
 *
 * Provides:
 *   • Conversation list (DMs + Rooms), separated and sorted
 *   • Active conversation + messages
 *   • Real-time updates via SSE
 *   • Send message / create DM / create room
 *   • Typing indicators
 *   • Unread counts
 */
import { useState, useCallback, useEffect, useRef } from "react";
import {
  listConversations,
  getOrCreateDM,
  createRoom,
  listMessages,
  sendMessage,
  markConversationRead,
  sendTypingIndicator,
  type Conversation,
  type ConversationMessage,
} from "../api/conversations";
import { useChatSSE, type ChatSSEEvent } from "./useChatSSE";

interface UseConversationsReturn {
  /** All conversations, sorted by last message */
  conversations: Conversation[];
  /** DM conversations only */
  dms: Conversation[];
  /** Room conversations only */
  rooms: Conversation[];
  /** Currently active conversation ID */
  activeConversationId: string | null;
  /** Currently active conversation data */
  activeConversation: Conversation | null;
  /** Messages in the active conversation */
  messages: ConversationMessage[];
  /** Loading states */
  loading: boolean;
  messagesLoading: boolean;
  /** Total unread count across all conversations */
  totalUnread: number;
  /** Who is currently typing in the active conversation */
  typingUsers: { uid: string; userName: string }[];
  /** Select a conversation */
  selectConversation: (id: string) => void;
  /** Start or open a DM with a user */
  startDM: (targetUserId: string) => Promise<Conversation>;
  /** Create a new chat room */
  createChatRoom: (name: string, members?: string[], isPrivate?: boolean) => Promise<Conversation>;
  /** Send a message to the active conversation */
  send: (content: string) => Promise<void>;
  /** Signal typing in the active conversation */
  signalTyping: () => void;
  /** Refresh conversations list */
  refresh: () => Promise<void>;
}

export function useConversations(currentUid: string | undefined): UseConversationsReturn {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [typingUsers, setTypingUsers] = useState<{ uid: string; userName: string }[]>([]);

  const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastTypingSentRef = useRef(0);

  /* ── Load conversations ──────────────────────────────────── */

  const refresh = useCallback(async () => {
    try {
      const data = await listConversations();
      setConversations(data);
    } catch {
      // Swallow — avoid disrupting UI on transient errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentUid) {
      refresh();
    }
  }, [currentUid, refresh]);

  /* ── Load messages when active conversation changes ──────── */

  const loadMessages = useCallback(async (convoId: string) => {
    setMessagesLoading(true);
    setTypingUsers([]);
    try {
      const data = await listMessages(convoId, { limit: 50 });
      setMessages(data);
      // Mark as read
      markConversationRead(convoId).catch(() => {});
      // Update local unread count
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convoId && currentUid
            ? { ...c, unreadCounts: { ...c.unreadCounts, [currentUid]: 0 } }
            : c,
        ),
      );
    } catch {
      setMessages([]);
    } finally {
      setMessagesLoading(false);
    }
  }, [currentUid]);

  useEffect(() => {
    if (activeConversationId) {
      loadMessages(activeConversationId);
    } else {
      setMessages([]);
    }
  }, [activeConversationId, loadMessages]);

  /* ── SSE handler ─────────────────────────────────────────── */

  const handleSSEEvent = useCallback(
    (event: ChatSSEEvent) => {
      switch (event.type) {
        case "message:new": {
          const { conversationId, message } = event.data;
          // If viewing this conversation, append message
          if (conversationId === activeConversationId) {
            setMessages((prev) => {
              // Deduplicate
              if (prev.some((m) => m.id === message.id)) return prev;
              return [...prev, message];
            });
            // Auto-mark as read since user is looking at it
            markConversationRead(conversationId).catch(() => {});
          }
          break;
        }

        case "conversation:created": {
          const { conversation } = event.data;
          setConversations((prev) => {
            if (prev.some((c) => c.id === conversation.id)) return prev;
            return [conversation, ...prev];
          });
          break;
        }

        case "conversation:updated": {
          const { conversationId, lastMessage, lastMessageAt, unreadCounts } = event.data;
          setConversations((prev) =>
            prev
              .map((c) => {
                if (c.id !== conversationId) return c;
                return {
                  ...c,
                  lastMessage: lastMessage ?? c.lastMessage,
                  lastMessageAt: lastMessageAt ?? c.lastMessageAt,
                  unreadCounts: {
                    ...c.unreadCounts,
                    ...unreadCounts,
                    // If user is currently viewing this conversation, keep unread at 0
                    ...(conversationId === activeConversationId && currentUid
                      ? { [currentUid]: 0 }
                      : {}),
                  },
                };
              })
              .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)),
          );
          break;
        }

        case "typing": {
          const { conversationId, uid, userName } = event.data;
          if (conversationId !== activeConversationId) break;
          if (uid === currentUid) break;

          setTypingUsers((prev) => {
            if (prev.some((t) => t.uid === uid)) return prev;
            return [...prev, { uid, userName }];
          });

          // Clear typing indicator after 3 seconds
          const existing = typingTimeoutsRef.current.get(uid);
          if (existing) clearTimeout(existing);
          typingTimeoutsRef.current.set(
            uid,
            setTimeout(() => {
              setTypingUsers((prev) => prev.filter((t) => t.uid !== uid));
              typingTimeoutsRef.current.delete(uid);
            }, 3000),
          );
          break;
        }

        default:
          break;
      }
    },
    [activeConversationId, currentUid],
  );

  useChatSSE(handleSSEEvent);

  /* ── Derived state ───────────────────────────────────────── */

  const dms = conversations.filter((c) => c.type === "dm");
  const rooms = conversations.filter((c) => c.type === "room");
  const activeConversation = conversations.find((c) => c.id === activeConversationId) ?? null;

  const totalUnread = currentUid
    ? conversations.reduce((sum, c) => {
        const count = c.unreadCounts?.[currentUid] ?? 0;
        return sum + count;
      }, 0)
    : 0;

  /* ── Actions ─────────────────────────────────────────────── */

  const selectConversation = useCallback((id: string) => {
    setActiveConversationId(id);
  }, []);

  const startDM = useCallback(
    async (targetUserId: string): Promise<Conversation> => {
      const { conversation, created } = await getOrCreateDM(targetUserId);
      if (created) {
        setConversations((prev) => [conversation, ...prev]);
      }
      setActiveConversationId(conversation.id);
      return conversation;
    },
    [],
  );

  const createChatRoom = useCallback(
    async (name: string, members?: string[], isPrivate?: boolean): Promise<Conversation> => {
      const conversation = await createRoom({ name, members, isPrivate });
      setConversations((prev) => [conversation, ...prev]);
      setActiveConversationId(conversation.id);
      return conversation;
    },
    [],
  );

  const send = useCallback(
    async (content: string) => {
      if (!activeConversationId || !content.trim()) return;
      const msg = await sendMessage(activeConversationId, content.trim());
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      // Update conversation preview locally
      setConversations((prev) =>
        prev
          .map((c) => {
            if (c.id !== activeConversationId) return c;
            return {
              ...c,
              lastMessage: `${msg.senderName}: ${content.trim().slice(0, 100)}`,
              lastMessageAt: msg.createdAt,
            };
          })
          .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)),
      );
    },
    [activeConversationId],
  );

  const signalTyping = useCallback(() => {
    if (!activeConversationId) return;
    const now = Date.now();
    // Throttle: at most once per 2 seconds
    if (now - lastTypingSentRef.current < 2000) return;
    lastTypingSentRef.current = now;
    sendTypingIndicator(activeConversationId).catch(() => {});
  }, [activeConversationId]);

  return {
    conversations,
    dms,
    rooms,
    activeConversationId,
    activeConversation,
    messages,
    loading,
    messagesLoading,
    totalUnread,
    typingUsers,
    selectConversation,
    startDM,
    createChatRoom,
    send,
    signalTyping,
    refresh,
  };
}
