/**
 * Expired sessions / ephemeral docs (hourly). Bounded deletes of:
 *
 *   roomInviteAcceptances      expiresAtMs <= now (invite acceptance expired)
 *   monetizationPendingCodes   expiresAt (ms) <= now (abandoned checkout codes)
 *   rooms/{id}/joinPagePresence lastSeenAtMs older than 1h
 *   rooms/{id}/hlsViewers       lastSeenAtMs older than 1h (unique-viewer
 *                               totals live in viewerSessions, unaffected)
 *   stripeEvents               createdAt (ms) older than 30 days (webhook de-dup
 *                               markers; Stripe stops retrying after 3 days)
 *   jobRuns                    startedAtMs older than 30 days (job history)
 *   telemetryEvents            timestamp (ms) older than TELEMETRY_RETENTION_DAYS
 *                               (default 30; product telemetry, lib/telemetry.ts)
 *
 * Every query is a single-field range (no composite index). The two presence
 * sub-collections are queried as collection groups; when the collection-group
 * index is missing the job falls back to scanning rooms in pages (cursor in
 * maintenanceState/ephemeralCleanup) so it still makes progress.
 */
import { FieldPath } from "firebase-admin/firestore";
import { firestore } from "../../firebaseAdmin";
import { defineJob, JOB_RUNS } from "./framework";
import { envNumber } from "./pure";
import { TELEMETRY_COLLECTION } from "../telemetryPure";

const PAGE = 400;
const MAX_PER_COLLECTION = 2_000;
const PRESENCE_MAX_AGE_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** Delete every doc a query matches, in pages, up to `max` docs. */
export async function deleteMatching(
  query: FirebaseFirestore.Query,
  max: number = MAX_PER_COLLECTION,
  shouldStop: () => boolean = () => false
): Promise<number> {
  let deleted = 0;
  while (deleted < max && !shouldStop()) {
    const want = Math.min(PAGE, max - deleted);
    const snap = await query.limit(want).get();
    if (snap.empty) break;
    const batch = firestore.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;
    if (snap.size < want) break;
  }
  return deleted;
}

async function cleanupPresenceViaRooms(cutoffMs: number, shouldStop: () => boolean): Promise<{ joinPagePresence: number; hlsViewers: number; roomsScanned: number }> {
  const stateRef = firestore.collection("maintenanceState").doc("ephemeralCleanup");
  let cursor: string | null = null;
  try {
    const s = await stateRef.get();
    const raw = s.exists ? (s.data() as any)?.roomCursor : null;
    cursor = typeof raw === "string" && raw ? raw : null;
  } catch {}

  let q: FirebaseFirestore.Query = firestore.collection("rooms").orderBy(FieldPath.documentId()).limit(100);
  if (cursor) q = q.startAfter(cursor);
  const rooms = await q.get();
  const out = { joinPagePresence: 0, hlsViewers: 0, roomsScanned: 0 };
  for (const room of rooms.docs) {
    if (shouldStop()) break;
    out.roomsScanned += 1;
    out.joinPagePresence += await deleteMatching(room.ref.collection("joinPagePresence").where("lastSeenAtMs", "<", cutoffMs), PAGE);
    out.hlsViewers += await deleteMatching(room.ref.collection("hlsViewers").where("lastSeenAtMs", "<", cutoffMs), PAGE);
    cursor = room.id;
  }
  // Wrap around once the end of the collection is reached.
  const next = rooms.size < 100 && out.roomsScanned === rooms.size ? null : cursor;
  try {
    await stateRef.set({ roomCursor: next, updatedAt: new Date() }, { merge: true });
  } catch {}
  return out;
}

export async function cleanupEphemeralDocs(now: Date, opts: { shouldStop?: () => boolean } = {}) {
  const nowMs = now.getTime();
  const shouldStop = opts.shouldStop ?? (() => false);
  const retentionDays = envNumber(process.env.JOB_HISTORY_RETENTION_DAYS, 30);
  const stripeDays = envNumber(process.env.STRIPE_EVENT_RETENTION_DAYS, 30);
  const telemetryDays = envNumber(process.env.TELEMETRY_RETENTION_DAYS, 30);
  const presenceCutoff = nowMs - PRESENCE_MAX_AGE_MS;
  const counts: Record<string, number> = {};
  const errors: string[] = [];

  async function step(label: string, fn: () => Promise<number>) {
    if (shouldStop()) return;
    try {
      counts[label] = await fn();
    } catch (e: any) {
      errors.push(`${label}: ${e?.message || e}`);
    }
  }

  await step("roomInviteAcceptances", () =>
    deleteMatching(firestore.collection("roomInviteAcceptances").where("expiresAtMs", "<=", nowMs), MAX_PER_COLLECTION, shouldStop)
  );
  await step("monetizationPendingCodes", () =>
    deleteMatching(firestore.collection("monetizationPendingCodes").where("expiresAt", "<=", nowMs), MAX_PER_COLLECTION, shouldStop)
  );

  // Presence: collection group first, room scan when the index is missing.
  let presenceFallback = false;
  for (const group of ["joinPagePresence", "hlsViewers"]) {
    if (presenceFallback || shouldStop()) break;
    try {
      counts[group] = await deleteMatching(
        firestore.collectionGroup(group).where("lastSeenAtMs", "<", presenceCutoff),
        MAX_PER_COLLECTION,
        shouldStop
      );
    } catch (e: any) {
      const code = e?.code;
      if (code === 9 || code === "failed-precondition" || /index/i.test(String(e?.message || ""))) {
        presenceFallback = true;
      } else {
        errors.push(`${group}: ${e?.message || e}`);
      }
    }
  }
  if (presenceFallback) {
    try {
      const r = await cleanupPresenceViaRooms(presenceCutoff, shouldStop);
      counts.joinPagePresence = (counts.joinPagePresence || 0) + r.joinPagePresence;
      counts.hlsViewers = (counts.hlsViewers || 0) + r.hlsViewers;
      counts.presenceRoomsScanned = r.roomsScanned;
    } catch (e: any) {
      errors.push(`presence_room_scan: ${e?.message || e}`);
    }
  }

  await step("stripeEvents", () =>
    deleteMatching(firestore.collection("stripeEvents").where("createdAt", "<", nowMs - stripeDays * DAY_MS), MAX_PER_COLLECTION, shouldStop)
  );
  await step("jobRuns", () =>
    deleteMatching(firestore.collection(JOB_RUNS).where("startedAtMs", "<", nowMs - retentionDays * DAY_MS), MAX_PER_COLLECTION, shouldStop)
  );
  await step("telemetryEvents", () =>
    deleteMatching(
      firestore.collection(TELEMETRY_COLLECTION).where("timestamp", "<", nowMs - telemetryDays * DAY_MS),
      MAX_PER_COLLECTION,
      shouldStop
    )
  );

  const deleted = Object.entries(counts)
    .filter(([k]) => k !== "presenceRoomsScanned")
    .reduce((sum, [, n]) => sum + (n || 0), 0);
  return { deleted, counts, presenceFallback, errors };
}

export const ephemeralCleanupJob = defineJob({
  name: "expired-sessions",
  title: "Expired Sessions & Ephemeral Docs",
  description:
    "Deletes expired invite acceptances and pending checkout codes, presence/HLS-viewer docs idle > 1h, stripeEvents and jobRuns older than 30 days, telemetryEvents older than TELEMETRY_RETENTION_DAYS (30).",
  intervalMs: 60 * 60_000,
  highlight: "deleted",
  async run(ctx) {
    const r = await cleanupEphemeralDocs(ctx.now, { shouldStop: () => ctx.timeLeftMs() <= 0 });
    return {
      processed: r.deleted,
      details: { deleted: r.deleted, ...r.counts, presenceFallback: r.presenceFallback || undefined, errors: r.errors.length ? r.errors : undefined },
      error: r.errors.length ? r.errors.join("; ") : null,
    };
  },
});
