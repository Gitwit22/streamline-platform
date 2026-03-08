import { apiFetchAuth } from "../../lib/api";

/* ── Types ────────────────────────────────────────────────────────── */

export type NotificationCategory = "communication" | "events" | "broadcast" | "system";

export type Notification = {
  id: string;
  userId: string;
  type: string;
  category: NotificationCategory;
  title: string;
  message: string;
  link: string | null;
  read: boolean;
  createdAt: string;
  metadata: Record<string, unknown> | null;
};

/* ── API calls ────────────────────────────────────────────────────── */

export async function fetchNotifications(opts?: {
  limit?: number;
  unreadOnly?: boolean;
}): Promise<Notification[]> {
  const sp = new URLSearchParams();
  if (typeof opts?.limit === "number" && Number.isFinite(opts.limit)) {
    sp.set("limit", String(Math.max(1, Math.min(200, Math.floor(opts.limit)))));
  }
  if (opts?.unreadOnly) {
    sp.set("unreadOnly", "true");
  }

  const res = await apiFetchAuth(
    `/api/edu/notifications${sp.toString() ? `?${sp.toString()}` : ""}`
  );
  const payload = (await res.json().catch(() => null)) as any;
  const items = Array.isArray(payload?.notifications) ? payload.notifications : [];

  return items
    .map((x: any) => ({
      id: String(x?.id || "").trim(),
      userId: typeof x?.userId === "string" ? x.userId : "",
      type: typeof x?.type === "string" ? x.type : "",
      category: (typeof x?.category === "string" ? x.category : "system") as NotificationCategory,
      title: typeof x?.title === "string" ? x.title : "",
      message: typeof x?.message === "string" ? x.message : "",
      link: typeof x?.link === "string" ? x.link : null,
      read: !!x?.read,
      createdAt: typeof x?.createdAt === "string" ? x.createdAt : "",
      metadata: x?.metadata && typeof x.metadata === "object" ? x.metadata : null,
    }))
    .filter((x: Notification) => !!x.id);
}

export async function fetchUnreadCount(): Promise<number> {
  const res = await apiFetchAuth("/api/edu/notifications/unread-count");
  const payload = (await res.json().catch(() => null)) as any;
  return typeof payload?.count === "number" ? payload.count : 0;
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await apiFetchAuth(`/api/edu/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: "PATCH",
  });
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiFetchAuth("/api/edu/notifications/read-all", {
    method: "POST",
  });
}
