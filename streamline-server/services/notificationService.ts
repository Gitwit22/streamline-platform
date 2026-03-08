/**
 * notificationService — Centralised notification creation and management.
 *
 * ALL notifications in StreamLine must flow through this service.
 * Never call Firestore directly for notifications from route handlers.
 *
 * Supports notification categories:
 *   - communication  (missed calls, new messages, room invites)
 *   - events         (event reminders, cancellations, updates)
 *   - broadcast      (broadcast started/ended, mentions)
 *   - system         (org invites, role changes, admin messages)
 */

import admin from "firebase-admin";
import { tenantCol } from "../lib/dbPaths";

/* ── Notification Types ──────────────────────────────────────────── */

export const NOTIFICATION_TYPES = {
  // Communication
  MISSED_VOICE_CALL: "missed_voice_call",
  MISSED_VIDEO_CALL: "missed_video_call",
  NEW_CHAT_MESSAGE: "new_chat_message",
  MISSED_CHAT_MESSAGE: "missed_chat_message",
  ROOM_JOINED: "room_joined",
  ROOM_INVITE: "room_invite",

  // Broadcast / Streaming
  BROADCAST_STARTING_SOON: "broadcast_starting_soon",
  BROADCAST_STARTED: "broadcast_started",
  BROADCAST_ENDED: "broadcast_ended",
  BROADCAST_MENTION: "broadcast_mention",

  // Event System
  EVENT_STARTING_SOON: "event_starting_soon",
  EVENT_REMINDER: "event_reminder",
  EVENT_CANCELED: "event_canceled",
  EVENT_UPDATED: "event_updated",

  // System / Admin
  ORG_INVITE: "org_invite",
  ROLE_CHANGED: "role_changed",
  SYSTEM_MESSAGE: "system_message",
} as const;

export type NotificationType =
  (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

export const NOTIFICATION_CATEGORIES = {
  COMMUNICATION: "communication",
  EVENTS: "events",
  BROADCAST: "broadcast",
  SYSTEM: "system",
} as const;

export type NotificationCategory =
  (typeof NOTIFICATION_CATEGORIES)[keyof typeof NOTIFICATION_CATEGORIES];

/** Map each notification type to its category. */
const TYPE_TO_CATEGORY: Record<NotificationType, NotificationCategory> = {
  missed_voice_call: "communication",
  missed_video_call: "communication",
  new_chat_message: "communication",
  missed_chat_message: "communication",
  room_joined: "communication",
  room_invite: "communication",

  broadcast_starting_soon: "broadcast",
  broadcast_started: "broadcast",
  broadcast_ended: "broadcast",
  broadcast_mention: "broadcast",

  event_starting_soon: "events",
  event_reminder: "events",
  event_canceled: "events",
  event_updated: "events",

  org_invite: "system",
  role_changed: "system",
  system_message: "system",
};

/* ── Input / Output types ────────────────────────────────────────── */

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationDoc {
  id: string;
  userId: string;
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  message: string;
  link: string | null;
  read: boolean;
  createdAt: string; // ISO-8601
  metadata: Record<string, unknown> | null;
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function notificationsCol() {
  return tenantCol("notifications");
}

function serializeNotification(id: string, data: any): NotificationDoc {
  return {
    id,
    userId: typeof data.userId === "string" ? data.userId : "",
    type: typeof data.type === "string" ? (data.type as NotificationType) : "system_message",
    category: typeof data.category === "string" ? (data.category as NotificationCategory) : "system",
    title: typeof data.title === "string" ? data.title : "",
    message: typeof data.message === "string" ? data.message : "",
    link: typeof data.link === "string" ? data.link : null,
    read: !!data.read,
    createdAt:
      typeof data.createdAt === "string"
        ? data.createdAt
        : data.createdAt?.toDate?.()?.toISOString?.() ?? new Date().toISOString(),
    metadata:
      data.metadata && typeof data.metadata === "object" ? data.metadata : null,
  };
}

/* ── Core API ────────────────────────────────────────────────────── */

/**
 * Create a new notification for a user.
 * Returns the serialised notification document.
 */
export async function createNotification(
  input: CreateNotificationInput
): Promise<NotificationDoc> {
  const { userId, type, title, message, link, metadata } = input;

  if (!userId || !type || !title) {
    throw new Error("userId, type and title are required");
  }

  const category = TYPE_TO_CATEGORY[type] ?? "system";

  const doc: Record<string, unknown> = {
    userId,
    type,
    category,
    title,
    message: message || "",
    link: link || null,
    read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    metadata: metadata || null,
  };

  const ref = await notificationsCol().add(doc);

  // Return a client-friendly representation immediately (serverTimestamp
  // won't be resolved until the next read, so we use Date.now()).
  return {
    id: ref.id,
    userId,
    type,
    category,
    title,
    message: message || "",
    link: link || null,
    read: false,
    createdAt: new Date().toISOString(),
    metadata: metadata || null,
  };
}

/**
 * List notifications for a user, newest first.
 */
export async function listNotifications(
  userId: string,
  opts?: { limit?: number; unreadOnly?: boolean }
): Promise<NotificationDoc[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);

  let query: FirebaseFirestore.Query = notificationsCol()
    .where("userId", "==", userId)
    .orderBy("createdAt", "desc")
    .limit(limit);

  if (opts?.unreadOnly) {
    query = notificationsCol()
      .where("userId", "==", userId)
      .where("read", "==", false)
      .orderBy("createdAt", "desc")
      .limit(limit);
  }

  const snap = await query.get();
  return snap.docs.map((d) => serializeNotification(d.id, d.data()));
}

/**
 * Mark a single notification as read.
 */
export async function markNotificationRead(
  notificationId: string,
  userId: string
): Promise<boolean> {
  const docRef = notificationsCol().doc(notificationId);
  const snap = await docRef.get();
  if (!snap.exists) return false;

  const data = snap.data() as any;
  if (data?.userId !== userId) return false; // ownership check

  await docRef.update({ read: true });
  return true;
}

/**
 * Mark all notifications for a user as read.
 */
export async function markAllNotificationsRead(
  userId: string
): Promise<number> {
  const snap = await notificationsCol()
    .where("userId", "==", userId)
    .where("read", "==", false)
    .get();

  if (snap.empty) return 0;

  const batch = admin.firestore().batch();
  for (const doc of snap.docs) {
    batch.update(doc.ref, { read: true });
  }
  await batch.commit();
  return snap.size;
}

/**
 * Get the count of unread notifications for a user.
 */
export async function getUnreadCount(userId: string): Promise<number> {
  const snap = await notificationsCol()
    .where("userId", "==", userId)
    .where("read", "==", false)
    .get();

  return snap.size;
}
