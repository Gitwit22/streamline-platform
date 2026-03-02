import { apiFetchAuth } from "@/lib/api";

export interface ChatRoom {
  id: string;
  name: string;
  section: string;
  isPrivate: boolean;
  unreadCount: number;
  lastMessage: string;
  lastMessageAt: number | null;
  memberCount: number;
  createdAt: number | null;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  senderUid: string;
  senderName: string;
  content: string;
  type: string;
  attachmentUrl: string;
  createdAt: number | null;
}

export async function fetchChatRooms(): Promise<ChatRoom[]> {
  const res = await apiFetchAuth("/api/corp/chat/rooms");
  if (!res.ok) throw new Error("fetch_rooms_failed");
  const data = await res.json();
  return data.rooms;
}

export async function fetchMessages(
  roomId: string,
  params?: { limit?: number; before?: number }
): Promise<ChatMessage[]> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.before) qs.set("before", String(params.before));
  const url = `/api/corp/chat/rooms/${roomId}/messages${qs.toString() ? "?" + qs : ""}`;
  const res = await apiFetchAuth(url);
  if (!res.ok) throw new Error("fetch_messages_failed");
  const data = await res.json();
  return data.messages;
}

export async function sendMessage(
  roomId: string,
  content: string,
  type?: string
): Promise<ChatMessage> {
  const res = await apiFetchAuth(`/api/corp/chat/rooms/${roomId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, type: type || "text" }),
  });
  if (!res.ok) throw new Error("send_message_failed");
  const data = await res.json();
  return data.message;
}

export async function createChatRoom(body: {
  name: string;
  section?: string;
  isPrivate?: boolean;
}): Promise<ChatRoom> {
  const res = await apiFetchAuth("/api/corp/chat/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "create_room_failed");
  }
  const data = await res.json();
  return data.room;
}
