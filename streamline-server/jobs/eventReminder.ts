/**
 * eventReminder — Cron job that sends event-starting-soon notifications.
 *
 * Scans upcoming events and sends notifications to participants when
 * an event starts within 15 minutes.
 *
 * Usage:
 *   npx tsx jobs/eventReminder.ts
 *
 * Recommended cron schedule: every minute
 *   * * * * * npx tsx jobs/eventReminder.ts
 */

import "dotenv/config";
import { tenantCol } from "../lib/dbPaths";
import {
  createNotification,
  NOTIFICATION_TYPES,
} from "../services/notificationService";

const REMINDER_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const TOLERANCE_MS = 60 * 1000; // 1-minute tolerance window for cron drift

async function run() {
  console.log("[eventReminder] Starting event reminder scan…");

  const now = Date.now();
  const windowStart = now + REMINDER_WINDOW_MS - TOLERANCE_MS;
  const windowEnd = now + REMINDER_WINDOW_MS + TOLERANCE_MS;

  try {
    // Query events that start within the 15-minute window (±1 minute tolerance)
    const eventsSnap = await tenantCol("events")
      .where("startsAt", ">=", new Date(windowStart).toISOString())
      .where("startsAt", "<=", new Date(windowEnd).toISOString())
      .get();

    if (eventsSnap.empty) {
      console.log("[eventReminder] No events starting in ~15 minutes.");
      return;
    }

    let notificationsSent = 0;

    for (const doc of eventsSnap.docs) {
      const data = doc.data() as any;
      const eventId = doc.id;
      const title = typeof data.title === "string" ? data.title : "Upcoming Event";
      const orgId = typeof data.orgId === "string" ? data.orgId : "";

      // Skip events that were already reminded or canceled
      if (data.reminderSent || data.canceledAt) continue;

      // Get org members to notify
      if (!orgId) continue;

      const membersSnap = await tenantCol("orgMembers")
        .where("orgId", "==", orgId)
        .get();

      for (const memberDoc of membersSnap.docs) {
        const memberData = memberDoc.data() as any;
        const userId = typeof memberData.userId === "string" ? memberData.userId : "";
        if (!userId) continue;

        try {
          await createNotification({
            userId,
            type: NOTIFICATION_TYPES.EVENT_REMINDER,
            title: "Event starting soon",
            message: `${title} starts in 15 minutes`,
            link: `/streamline/edu/events`,
            metadata: { eventId, orgId },
          });
          notificationsSent++;
        } catch (err) {
          console.error(
            `[eventReminder] Failed to notify user ${userId} for event ${eventId}:`,
            (err as any)?.message || err
          );
        }
      }

      // Mark event as reminded to avoid duplicate notifications
      try {
        await tenantCol("events").doc(eventId).update({ reminderSent: true });
      } catch (err) {
        console.error(
          `[eventReminder] Failed to mark event ${eventId} as reminded:`,
          (err as any)?.message || err
        );
      }
    }

    console.log(
      `[eventReminder] Done. Sent ${notificationsSent} notification(s) for ${eventsSnap.size} event(s).`
    );
  } catch (err) {
    console.error("[eventReminder] Fatal error:", (err as any)?.message || err);
    process.exit(1);
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[eventReminder] Unhandled error:", err);
    process.exit(1);
  });
