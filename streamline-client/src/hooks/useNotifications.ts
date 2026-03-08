import { useState, useEffect, useCallback, useRef } from "react";
import {
  fetchNotifications,
  fetchUnreadCount,
  markNotificationRead as apiMarkRead,
  markAllNotificationsRead as apiMarkAllRead,
  type Notification,
} from "../edu/api/notifications";

const POLL_INTERVAL = 30_000; // 30 seconds

/**
 * Hook to manage notifications with polling.
 *
 * Returns the notification list, unread count, and mutation helpers.
 * Polls for new notifications at a configurable interval.
 */
export function useNotifications(opts?: { pollInterval?: number }) {
  const interval = opts?.pollInterval ?? POLL_INTERVAL;

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [items, count] = await Promise.all([
        fetchNotifications({ limit: 50 }),
        fetchUnreadCount(),
      ]);
      if (!mountedRef.current) return;
      setNotifications(items);
      setUnreadCount(count);
    } catch {
      // Swallow fetch errors during polling to avoid UI disruption.
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const id = setInterval(refresh, interval);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [refresh, interval]);

  const markRead = useCallback(
    async (notificationId: string) => {
      try {
        await apiMarkRead(notificationId);
        setNotifications((prev) =>
          prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch {
        // best-effort
      }
    },
    []
  );

  const markAllRead = useCallback(async () => {
    try {
      await apiMarkAllRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      // best-effort
    }
  }, []);

  return {
    notifications,
    unreadCount,
    loading,
    refresh,
    markRead,
    markAllRead,
  };
}
