import { apiFetchAuth } from "@/lib/api";

/* ── Types ─────────────────────────────────────────────────────── */

export type TicketStatus = "open" | "in_progress" | "waiting_on_user" | "resolved" | "closed";
export type TicketPriority = "low" | "medium" | "high" | "urgent";
export type TicketCategory =
  | "technical"
  | "account"
  | "broadcast"
  | "room_access"
  | "event_issue"
  | "student_issue"
  | "other";
export type TicketMessageType = "reply" | "internal_note" | "status_change";

export interface EduSupportTicket {
  id: string;
  tenantId: string;
  schoolId: string;
  createdByUserId: string;
  createdByName: string;
  createdByRole: string;
  title: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  assignedToUserId: string | null;
  assignedToName: string | null;
  tags: string[];
  createdAt: number | null;
  updatedAt: number | null;
  closedAt: number | null;
}

export interface EduSupportTicketMessage {
  id: string;
  authorUserId: string;
  authorName: string;
  authorRole: string;
  type: TicketMessageType;
  message: string;
  createdAt: number | null;
}

/* ── API ───────────────────────────────────────────────────────── */

export async function createTicket(body: {
  title: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  schoolId?: string;
  tags?: string[];
}): Promise<EduSupportTicket> {
  const res = await apiFetchAuth("/api/edu/tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "create_ticket_failed");
  }
  const data = await res.json();
  return data.ticket;
}

export async function listTickets(params?: {
  status?: string;
  priority?: string;
  category?: string;
  schoolId?: string;
  createdByUserId?: string;
  assignedToUserId?: string;
  limit?: number;
}): Promise<{ tickets: EduSupportTicket[]; count: number }> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.priority) qs.set("priority", params.priority);
  if (params?.category) qs.set("category", params.category);
  if (params?.schoolId) qs.set("schoolId", params.schoolId);
  if (params?.createdByUserId) qs.set("createdByUserId", params.createdByUserId);
  if (params?.assignedToUserId) qs.set("assignedToUserId", params.assignedToUserId);
  if (params?.limit) qs.set("limit", String(params.limit));
  const url = `/api/edu/tickets${qs.toString() ? "?" + qs : ""}`;
  const res = await apiFetchAuth(url);
  if (!res.ok) throw new Error("list_tickets_failed");
  return res.json();
}

export async function getTicket(ticketId: string): Promise<{
  ticket: EduSupportTicket;
  messages: EduSupportTicketMessage[];
}> {
  const res = await apiFetchAuth(`/api/edu/tickets/${ticketId}`);
  if (!res.ok) throw new Error("get_ticket_failed");
  return res.json();
}

export async function updateTicket(
  ticketId: string,
  body: Partial<{
    status: TicketStatus;
    priority: TicketPriority;
    category: TicketCategory;
    assignedToUserId: string | null;
    assignedToName: string | null;
    tags: string[];
  }>,
): Promise<EduSupportTicket> {
  const res = await apiFetchAuth(`/api/edu/tickets/${ticketId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "update_ticket_failed");
  }
  const data = await res.json();
  return data.ticket;
}

export async function addTicketMessage(
  ticketId: string,
  body: { type: TicketMessageType; message: string },
): Promise<EduSupportTicketMessage> {
  const res = await apiFetchAuth(`/api/edu/tickets/${ticketId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "add_message_failed");
  }
  const data = await res.json();
  return data.message;
}

export async function closeTicket(
  ticketId: string,
  resolutionNote?: string,
): Promise<EduSupportTicket> {
  const res = await apiFetchAuth(`/api/edu/tickets/${ticketId}/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resolutionNote: resolutionNote || "" }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "close_ticket_failed");
  }
  const data = await res.json();
  return data.ticket;
}
