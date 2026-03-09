/**
 * conversations — Client API layer for the unified conversations system.
 *
 * Supports two conversation types:
 *   • "dm"   — Private 1:1 thread between two staff members
 *   • "room" — Group chat room with named participants
 */
import { apiFetchAuth } from "@/lib/api";

/* ── Types ─────────────────────────────────────────────────────── */

export interface Conversation {
  id: string;
  type: "dm" | "room";
  orgId: string;
  name: string;
  participants: string[];
  participantNames: Record<string, string>;
  lastMessage: string;
  lastMessageAt: number | null;
  lastMessageSenderUid: string;
  unreadCounts: Record<string, number>;
  createdAt: number | null;
  createdBy: string;
  isPrivate: boolean;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  senderUid: string;
  senderName: string;
  content: string;
  type: string;             // "text" | "image" | "file" | "system"
  attachmentUrl: string;
  createdAt: number | null;
}

export interface ConversationMember {
  uid: string;
  name: string;
}

/* ── Conversation CRUD ─────────────────────────────────────────── */

export async function listConversations(): Promise<Conversation[]> {
  const res = await apiFetchAuth("/api/edu/conversations");
  if (!res.ok) throw new Error("fetch_conversations_failed");
  const data = await res.json();
  return data.conversations ?? [];
}

export async function getOrCreateDM(
  targetUserId: string,
): Promise<{ conversation: Conversation; created: boolean }> {
  const res = await apiFetchAuth("/api/edu/conversations/dm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetUserId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "dm_failed");
  }
  return res.json();
}

export async function createRoom(body: {
  name: string;
  members?: string[];
  isPrivate?: boolean;
}): Promise<Conversation> {
  const res = await apiFetchAuth("/api/edu/conversations/room", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "create_room_failed");
  }
  const data = await res.json();
  return data.conversation;
}

export async function getConversation(id: string): Promise<Conversation> {
  const res = await apiFetchAuth(`/api/edu/conversations/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error("get_conversation_failed");
  const data = await res.json();
  return data.conversation;
}

/* ── Messages ──────────────────────────────────────────────────── */

export async function listMessages(
  conversationId: string,
  params?: { limit?: number; before?: number },
): Promise<ConversationMessage[]> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.before) qs.set("before", String(params.before));
  const url = `/api/edu/conversations/${encodeURIComponent(conversationId)}/messages${qs.toString() ? "?" + qs : ""}`;
  const res = await apiFetchAuth(url);
  if (!res.ok) throw new Error("fetch_messages_failed");
  const data = await res.json();
  return data.messages ?? [];
}

export async function sendMessage(
  conversationId: string,
  content: string,
  opts?: { type?: string; attachmentUrl?: string },
): Promise<ConversationMessage> {
  const res = await apiFetchAuth(
    `/api/edu/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        type: opts?.type || "text",
        attachmentUrl: opts?.attachmentUrl || "",
      }),
    },
  );
  if (!res.ok) throw new Error("send_message_failed");
  const data = await res.json();
  return data.message;
}

/* ── Conversation actions ──────────────────────────────────────── */

export async function markConversationRead(conversationId: string): Promise<void> {
  await apiFetchAuth(
    `/api/edu/conversations/${encodeURIComponent(conversationId)}/read`,
    { method: "POST" },
  );
}

export async function sendTypingIndicator(conversationId: string): Promise<void> {
  await apiFetchAuth(
    `/api/edu/conversations/${encodeURIComponent(conversationId)}/typing`,
    { method: "POST" },
  );
}

/* ── Members ───────────────────────────────────────────────────── */

export async function listMembers(conversationId: string): Promise<ConversationMember[]> {
  const res = await apiFetchAuth(
    `/api/edu/conversations/${encodeURIComponent(conversationId)}/members`,
  );
  if (!res.ok) throw new Error("fetch_members_failed");
  const data = await res.json();
  return data.members ?? [];
}

export async function addMembers(
  conversationId: string,
  members: string[],
): Promise<{ ok: boolean; added: number }> {
  const res = await apiFetchAuth(
    `/api/edu/conversations/${encodeURIComponent(conversationId)}/members`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ members }),
    },
  );
  if (!res.ok) throw new Error("add_members_failed");
  return res.json();
}

export async function removeMember(
  conversationId: string,
  memberUid: string,
): Promise<void> {
  await apiFetchAuth(
    `/api/edu/conversations/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(memberUid)}`,
    { method: "DELETE" },
  );
}
