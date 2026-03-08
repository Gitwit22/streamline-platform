import { apiFetchAuth } from "@/lib/api";

/* ── Types ─────────────────────────────────────────────────────── */

export interface EduChatRoom {
  id: string;
  name: string;
  section: string;          // "department" | "general" | "staff"
  isPrivate: boolean;
  unreadCount: number;
  lastMessage: string;
  lastMessageAt: number | null;
  memberCount: number;
  createdAt: number | null;
}

export interface EduChatMessage {
  id: string;
  roomId: string;
  senderUid: string;
  senderName: string;
  content: string;
  type: string;             // "text" | "file" | "image"
  attachmentUrl: string;
  createdAt: number | null;
}

/* ── API ───────────────────────────────────────────────────────── */

export async function fetchEduChatRooms(): Promise<EduChatRoom[]> {
  const res = await apiFetchAuth("/api/edu/chat/rooms");
  if (!res.ok) throw new Error("fetch_rooms_failed");
  const data = await res.json();
  return data.rooms;
}

export async function fetchEduMessages(
  roomId: string,
  params?: { limit?: number; before?: number },
): Promise<EduChatMessage[]> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.before) qs.set("before", String(params.before));
  const url = `/api/edu/chat/rooms/${roomId}/messages${qs.toString() ? "?" + qs : ""}`;
  const res = await apiFetchAuth(url);
  if (!res.ok) throw new Error("fetch_messages_failed");
  const data = await res.json();
  return data.messages;
}

export async function sendEduMessage(
  roomId: string,
  content: string,
  type?: string,
): Promise<EduChatMessage> {
  const res = await apiFetchAuth(`/api/edu/chat/rooms/${roomId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, type: type || "text" }),
  });
  if (!res.ok) throw new Error("send_message_failed");
  const data = await res.json();
  return data.message;
}

export async function createEduChatRoom(body: {
  name: string;
  section?: string;
  isPrivate?: boolean;
}): Promise<EduChatRoom> {
  const res = await apiFetchAuth("/api/edu/chat/rooms", {
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

/* ── Staff & Presence ──────────────────────────────────────────── */

export interface EduChatStaffMember {
  uid: string;
  name: string;
  email: string;
  role: string;
  department: string | null;
  avatar: string | null;
  status: string;
}

export interface EduChatOnlineStaff {
  uid: string;
  userName: string;
  orgRole: string;
  lastHeartbeat: number;
}

export async function fetchEduChatStaff(): Promise<EduChatStaffMember[]> {
  const res = await apiFetchAuth("/api/edu/chat/staff");
  if (!res.ok) throw new Error("fetch_chat_staff_failed");
  const data = await res.json();
  return data.staff ?? [];
}

export async function fetchEduChatOnline(): Promise<EduChatOnlineStaff[]> {
  const res = await apiFetchAuth("/api/edu/chat/staff/online");
  if (!res.ok) throw new Error("fetch_online_failed");
  const data = await res.json();
  return data.online ?? [];
}

export async function sendEduChatHeartbeat(): Promise<void> {
  await apiFetchAuth("/api/edu/chat/heartbeat", { method: "POST" });
}
