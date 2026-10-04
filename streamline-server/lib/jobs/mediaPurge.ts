/**
 * Media purge: recording retention + emergency recording expiry.
 * (Moved from routes/maintenance.ts; the maintenance endpoints are thin
 * wrappers around these functions.)
 *
 *   - expireEmergencyRecordings: users/{uid}/emergencyRecording/current past expiresAt
 *   - purgeExpiredRecordings:    recordings past deleteAfterMs
 *   - purgeOldRecordings:        24h retention for finished recordings
 *
 * Every deletion releases counted storage exactly once through the
 * transactional releaseRecordingStorageOnce().
 */
import { firestore } from "../../firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { deleteFiles, deletePrefix } from "../storageClient";
import { deleteRecordingStorage } from "../recordingDeletion";
import { advanceablePrefixLength } from "../mediaPure";
import { releaseRecordingStorageOnce } from "../recordingUsage";
import { defineJob } from "./framework";

type EmergencyCurrentDoc = {
  recordingId?: string;
  createdAt?: any;
  expiresAt?: any;
  status?: string;
  r2Keys?: string[];
  r2Prefix?: string;
  deletedAt?: any;
};

function getUidFromEmergencyCurrentPath(path: string): string | null {
  // Expected: users/{uid}/emergencyRecording/current
  const parts = String(path || "").split("/").filter(Boolean);
  if (parts.length !== 4) return null;
  if (parts[0] !== "users") return null;
  if (parts[2] !== "emergencyRecording") return null;
  return parts[1] || null;
}

function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  return null;
}

export async function expireEmergencyRecordings(now: Date): Promise<{ deletedCount: number }> {
  const snap = await firestore
    .collectionGroup("emergencyRecording")
    .where("expiresAt", "<", now)
    .limit(500)
    .get();

  let deletedCount = 0;

  for (const doc of snap.docs) {
    if (doc.id !== "current") continue;

    const data = (doc.data() || {}) as EmergencyCurrentDoc;
    const status = String(data.status || "").toLowerCase();
    if (status === "deleted") continue;

    const expiresAt = toDate(data.expiresAt);
    if (!expiresAt || expiresAt.getTime() >= now.getTime()) continue;

    const uid = getUidFromEmergencyCurrentPath(doc.ref.path);
    const recordingId = data.recordingId ? String(data.recordingId) : null;

    try {
      // Delete R2 assets (idempotent)
      const keys = Array.isArray(data.r2Keys) ? data.r2Keys.map(String).map((s) => s.trim()).filter(Boolean) : [];
      const prefix = data.r2Prefix ? String(data.r2Prefix).trim() : "";

      if (keys.length > 0) {
        await deleteFiles(keys);
      } else if (prefix) {
        await deletePrefix(prefix);
      }

      // Release storage quota for the deleted recording (billing uid, once)
      if (uid && recordingId) {
        try {
          await releaseRecordingStorageOnce(firestore.collection("recordings").doc(recordingId), {
            caller: "maintenance.expireEmergencyRecordings",
          });
        } catch (e: any) {
          console.warn("[maintenance/expire-emergency-recordings] storage release failed", {
            uid, recordingId, error: e?.message || e,
          });
        }
      }

      // Mark pointer deleted
      await doc.ref.set(
        {
          status: "deleted",
          deletedAt: now,
        },
        { merge: true }
      );

      // Best-effort: mark recording doc deleted as well
      if (recordingId) {
        await firestore
          .collection("recordings")
          .doc(recordingId)
          .set({ status: "deleted", deletedAt: now, updatedAt: now, storageReleased: true }, { merge: true });
      }

      // Best-effort: annotate user doc so we can audit deletions later
      if (uid) {
        await firestore
          .collection("users")
          .doc(uid)
          .set({ lastEmergencyRecordingExpiredAt: now }, { merge: true });
      }

      deletedCount += 1;
    } catch (e: any) {
      console.warn("[maintenance/expire-emergency-recordings] failed for", doc.ref.path, e?.message || e);
    }
  }

  return { deletedCount };
}

export async function purgeExpiredRecordings(now: Date, opts?: { limit?: number }): Promise<{ deletedCount: number }> {
  const nowMs = now.getTime();
  const limit = typeof opts?.limit === "number" && Number.isFinite(opts.limit)
    ? Math.max(1, Math.min(500, opts.limit))
    : 200;

  // Only recordings with a deleteAfterMs field are eligible.
  // This is intended for emergency recordings (1-hour retention).
  const snap = await firestore
    .collection("recordings")
    .where("deleteAfterMs", "<=", nowMs)
    .limit(limit)
    .get();

  let deletedCount = 0;

  for (const doc of snap.docs) {
    const data = (doc.data() || {}) as any;
    const status = String(data.status || "").toLowerCase();
    if (status === "deleted") {
      // Older soft-deleted docs kept deleteAfterMs, so they matched this query
      // forever and could fill every page (purge stalls). Drop the field.
      try {
        await doc.ref.update({ deleteAfterMs: FieldValue.delete() });
      } catch {}
      continue;
    }

    try {
      await deleteRecordingStorage(data);
    } catch (e: any) {
      console.warn("[maintenance/purge-expired-recordings] deleteRecordingStorage failed", { recordingId: doc.id, error: e?.message || e });
    }

    // Release counted storage from the billing uid exactly once (transactional).
    try {
      await releaseRecordingStorageOnce(doc.ref, { caller: "maintenance.purgeExpiredRecordings" });
    } catch (e: any) {
      console.warn("[maintenance/purge-expired-recordings] storage release failed", {
        recordingId: doc.id, error: e?.message || e,
      });
    }

    try {
      await doc.ref.set(
        {
          status: "deleted",
          deleteReason: "expired_retention",
          deletedAt: now,
          updatedAt: now,
          storageReleased: true,
          // Leave the deleteAfterMs index so this doc stops matching the query.
          deleteAfterMs: FieldValue.delete(),
        },
        { merge: true }
      );
      deletedCount += 1;
    } catch (e: any) {
      console.warn("[maintenance/purge-expired-recordings] failed to update recording", { recordingId: doc.id, error: e?.message || e });
    }
  }

  return { deletedCount };
}

// ---------------------------------------------------------------------------
// 24-hour recording retention
// Deletes ready/stopped/processing recordings whose createdAt is older than
// retentionHours (default: 24).  Active recordings (status "recording" or
// "starting") and already-deleted recordings are skipped.
// Supports dryRun mode: set query param dryRun=1 or env RECORDING_CLEANUP_DRY_RUN=1.
// ---------------------------------------------------------------------------

export const RECORDING_RETENTION_HOURS = 24;

const ACTIVE_STATUSES = new Set(["recording", "starting"]);

export async function purgeOldRecordings(
  now: Date,
  opts?: { limit?: number; dryRun?: boolean; retentionHours?: number }
): Promise<{ deletedCount: number; skippedCount: number; dryRun: boolean }> {
  const retentionHours =
    typeof opts?.retentionHours === "number" && Number.isFinite(opts.retentionHours)
      ? Math.max(1, opts.retentionHours)
      : RECORDING_RETENTION_HOURS;
  const cutoff = new Date(now.getTime() - retentionHours * 60 * 60 * 1000);
  const limit =
    typeof opts?.limit === "number" && Number.isFinite(opts.limit)
      ? Math.max(1, Math.min(500, opts.limit))
      : 200;
  const dryRun = opts?.dryRun === true;

  // Page through old recordings in createdAt order. Docs that can never be
  // purged (already deleted) used to fill every 200-doc page forever and stall
  // the purge; now we page with startAfter, and persist a cursor past the
  // leading run of finished docs so each run starts where work remains.
  // Single-field range + orderBy on createdAt: no composite index needed.
  const cursorRef = firestore.collection("maintenanceState").doc("purgeOldRecordings");
  let cursorMs: number | null = null;
  if (!dryRun) {
    try {
      const cursorSnap = await cursorRef.get();
      const raw = cursorSnap.exists ? (cursorSnap.data() as any)?.createdAtCursorMs : null;
      cursorMs = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    } catch (e: any) {
      console.warn("[maintenance/purge-old-recordings] failed to read cursor", e?.message || e);
    }
  }

  const PAGE_SIZE = 200;
  const MAX_SCANNED = 5000;

  let deletedCount = 0;
  let skippedCount = 0;
  let scanned = 0;
  // Leading run of "permanently done" docs (for cursor advance).
  const doneFlags: boolean[] = [];
  const createdAtMsList: (number | null)[] = [];
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  const docCreatedMs = (d: any): number | null => {
    const v = d?.createdAt;
    if (!v) return null;
    if (v instanceof Date) return v.getTime();
    if (typeof v?.toDate === "function") return v.toDate().getTime();
    if (typeof v === "number") return v;
    return null;
  };

  while (deletedCount < limit && scanned < MAX_SCANNED) {
    let query: FirebaseFirestore.Query = firestore
      .collection("recordings")
      .where("createdAt", "<", cutoff)
      .orderBy("createdAt", "asc");
    if (lastDoc) {
      query = query.startAfter(lastDoc);
    } else if (cursorMs !== null) {
      // startAt (not After): re-check docs sharing the cursor timestamp.
      query = query.where("createdAt", ">=", new Date(cursorMs));
    }

    let snap: FirebaseFirestore.QuerySnapshot;
    try {
      snap = await query.limit(PAGE_SIZE).get();
    } catch (e: any) {
      console.warn("[maintenance/purge-old-recordings] query failed", e?.message || e);
      break;
    }
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned += 1;
      lastDoc = doc;
      const data = (doc.data() || {}) as any;
      const status = String(data.status || "").toLowerCase();
      createdAtMsList.push(docCreatedMs(data));

      // Never delete active or already-deleted recordings.
      if (status === "deleted" || ACTIVE_STATUSES.has(status)) {
        skippedCount += 1;
        doneFlags.push(status === "deleted");
        continue;
      }

      if (deletedCount >= limit) {
        doneFlags.push(false);
        continue;
      }

      if (dryRun) {
        console.log(`[maintenance/purge-old-recordings] DRY RUN — would delete recording: ${doc.id}`);
        deletedCount += 1;
        doneFlags.push(false);
        continue;
      }

      const storageReleased = data.storageReleased === true;

      let storageDeleted = false;
      try {
        await deleteRecordingStorage(data);
        storageDeleted = true;
      } catch (e: any) {
        console.warn(`[maintenance/purge-old-recordings] Failed to delete recording: ${doc.id}`, e?.message || e);
      }

      if (storageDeleted) {
        try {
          await releaseRecordingStorageOnce(doc.ref, { caller: "maintenance.purgeOldRecordings" });
        } catch (e: any) {
          console.warn("[maintenance/purge-old-recordings] storage release failed", {
            recordingId: doc.id, error: e?.message || e,
          });
        }
      }

      try {
        await doc.ref.set(
          { status: "deleted", deleteReason: "expired_24h_retention", deletedAt: now, updatedAt: now, storageReleased: storageDeleted || storageReleased },
          { merge: true }
        );
        deletedCount += 1;
        doneFlags.push(true);
        if (storageDeleted) {
          console.log(`[maintenance/purge-old-recordings] Deleted expired recording: ${doc.id}`);
        } else {
          console.warn(`[maintenance/purge-old-recordings] Marked deleted in Firestore (R2 deletion had failed): ${doc.id}`);
        }
      } catch (e: any) {
        doneFlags.push(false);
        console.warn("[maintenance/purge-old-recordings] failed to update Firestore", { recordingId: doc.id, error: e?.message || e });
      }
    }

    if (snap.size < PAGE_SIZE) break;
  }

  // Advance the persisted cursor past the leading run of finished docs.
  if (!dryRun) {
    const n = advanceablePrefixLength(doneFlags);
    const advanceTo = n > 0 ? createdAtMsList[n - 1] : null;
    if (typeof advanceTo === "number" && (cursorMs === null || advanceTo > cursorMs)) {
      try {
        await cursorRef.set({ createdAtCursorMs: advanceTo, updatedAt: now }, { merge: true });
      } catch (e: any) {
        console.warn("[maintenance/purge-old-recordings] failed to persist cursor", e?.message || e);
      }
    }
  }

  return { deletedCount, skippedCount, dryRun };
}


// ---------------------------------------------------------------------------
// Scheduled job: media-purge (hourly)
// ---------------------------------------------------------------------------

export const mediaPurgeJob = defineJob({
  name: "media-purge",
  title: "Media Purge",
  description:
    "Expired emergency recordings, recordings past deleteAfterMs, and finished recordings older than " +
    `${RECORDING_RETENTION_HOURS}h (RECORDING_CLEANUP_DRY_RUN=1 previews the retention purge). Storage released once per recording.`,
  intervalMs: 60 * 60_000,
  highlight: "deleted",
  async run(ctx) {
    const now = ctx.now;
    const dryRun = process.env.RECORDING_CLEANUP_DRY_RUN === "1";
    const errors: string[] = [];
    async function step<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
      try {
        return await fn();
      } catch (e: any) {
        errors.push(`${label}: ${e?.message || e}`);
        return null;
      }
    }

    const emergency = await step("emergency", () => expireEmergencyRecordings(now));
    const expired = await step("expired", () => purgeExpiredRecordings(now));
    const retention = await step("retention", () => purgeOldRecordings(now, { dryRun }));

    const emergencyExpired = emergency?.deletedCount ?? 0;
    const expiredDeleted = expired?.deletedCount ?? 0;
    const retentionDeleted = dryRun ? 0 : retention?.deletedCount ?? 0;
    const deleted = emergencyExpired + expiredDeleted + retentionDeleted;
    return {
      processed: deleted,
      details: {
        deleted,
        emergencyExpired,
        expiredDeleted,
        retentionDeleted,
        retentionWouldDelete: dryRun ? retention?.deletedCount ?? 0 : undefined,
        retentionSkipped: retention?.skippedCount ?? 0,
        dryRun,
        errors: errors.length ? errors : undefined,
      },
      error: errors.length ? errors.join("; ") : null,
    };
  },
});
