/**
 * Account purge: hard-delete accounts whose deleteAfterMs has passed
 * (closed accounts after their grace period). Moved from
 * routes/maintenance.ts (purge-deleted-accounts).
 */
import { firestore } from "../../firebaseAdmin";
import { deleteFile } from "../storageClient";
import { deleteRecordingStorage } from "../recordingDeletion";
import { releaseStorageUsage } from "../../usageHelper";
import { releaseRecordingStorageOnce } from "../recordingUsage";
import { defineJob } from "./framework";

async function deleteCollection(ref: FirebaseFirestore.CollectionReference, limit: number = 200) {
  const snap = await ref.limit(limit).get();
  if (snap.empty) return 0;
  const batch = firestore.batch();
  for (const doc of snap.docs) batch.delete(doc.ref);
  await batch.commit();
  return snap.size;
}

export async function purgeDeletedAccounts(now: Date): Promise<{ purgedCount: number }> {
  const nowMs = now.getTime();
  const snap = await firestore
    .collection("users")
    .where("deleteAfterMs", "<=", nowMs)
    .limit(50)
    .get();

  let purgedCount = 0;

  for (const doc of snap.docs) {
    const uid = doc.id;
    const data = (doc.data() as any) || {};
    const deletedAtMs = typeof data.deletedAtMs === "number" ? data.deletedAtMs : null;
    const deleteAfterMs = typeof data.deleteAfterMs === "number" ? data.deleteAfterMs : null;

    if (!deletedAtMs || !deleteAfterMs || deleteAfterMs > nowMs) continue;

    try {
      // Best-effort cleanup of known user-owned data.
      // Note: Firestore does not automatically delete subcollections.

      // Release storage for user's recordings before deleting user doc
      try {
        const recSnap = await firestore
          .collection("recordings")
          .where("userId", "==", uid)
          .limit(500)
          .get();
        for (const recDoc of recSnap.docs) {
          const recData = (recDoc.data() || {}) as any;
          try {
            await deleteRecordingStorage(recData);
            // Release from the recording's billing uid (room owner) exactly once.
            await releaseRecordingStorageOnce(recDoc.ref, { caller: "maintenance.purgeDeletedAccounts" });
            await recDoc.ref.set({ status: "deleted", storageReleased: true, deletedAt: now, updatedAt: now }, { merge: true });
          } catch (e: any) {
            console.warn("[maintenance/purge-deleted-accounts] recording cleanup failed", { uid, recordingId: recDoc.id, error: e?.message || e });
          }
        }
      } catch (e: any) {
        console.warn("[maintenance/purge-deleted-accounts] failed to clean recordings", { uid, error: e?.message || e });
      }

      // Release storage for user's saved_videos (uploaded ones with storagePath)
      try {
        const svSnap = await firestore
          .collection("saved_videos")
          .where("userId", "==", uid)
          .limit(500)
          .get();
        let totalBytes = 0;
        for (const svDoc of svSnap.docs) {
          const svData = (svDoc.data() || {}) as any;
          const storagePath = typeof svData.storagePath === "string" ? svData.storagePath : null;
          const sizeBytes = typeof svData.sizeBytes === "number" ? svData.sizeBytes : 0;
          if (storagePath) {
            try {
              await deleteFile(storagePath);
              if (sizeBytes > 0) totalBytes += sizeBytes;
            } catch (e: any) {
              console.warn("[maintenance/purge-deleted-accounts] saved_video file delete failed", { uid, storagePath, error: e?.message || e });
            }
          }
          try { await svDoc.ref.delete(); } catch (e: any) {
            console.warn("[maintenance/purge-deleted-accounts] saved_video doc delete failed", { uid, docId: svDoc.id, error: e?.message || e });
          }
        }
        // Note: storage release for deleted user is best-effort since user doc is being deleted
        if (totalBytes > 0) {
          try {
            await releaseStorageUsage(uid, totalBytes, { caller: "maintenance.purgeDeletedAccounts.savedVideos" });
          } catch (e: any) {
            console.warn("[maintenance/purge-deleted-accounts] saved_videos storage release failed", { uid, totalBytes, error: e?.message || e });
          }
        }
      } catch (e: any) {
        console.warn("[maintenance/purge-deleted-accounts] failed to clean saved_videos", { uid, error: e?.message || e });
      }

      // users/{uid}/rolePresets
      try {
        let removed = 0;
        // Loop in case there are >limit docs
        for (let i = 0; i < 5; i++) {
          const n = await deleteCollection(doc.ref.collection("rolePresets"), 200);
          removed += n;
          if (n === 0) break;
        }
        if (removed) {
          console.log("[maintenance] purged rolePresets", { uid, removed });
        }
      } catch {}

      // users/{uid}/emergencyRecording
      try {
        let removed = 0;
        for (let i = 0; i < 5; i++) {
          const n = await deleteCollection(doc.ref.collection("emergencyRecording"), 200);
          removed += n;
          if (n === 0) break;
        }
        if (removed) {
          console.log("[maintenance] purged emergencyRecording", { uid, removed });
        }
      } catch {}

      // users/{uid}/usageCredits (one-time usage credits, lib/usageCredits.ts)
      try {
        let removed = 0;
        for (let i = 0; i < 5; i++) {
          const n = await deleteCollection(doc.ref.collection("usageCredits"), 200);
          removed += n;
          if (n === 0) break;
        }
        if (removed) {
          console.log("[maintenance] purged usageCredits", { uid, removed });
        }
      } catch {}

      // accounts/{uid}
      try {
        await firestore.collection("accounts").doc(uid).delete();
      } catch {}

      // billingAudit where uid == uid (best-effort, small batches)
      try {
        for (let i = 0; i < 5; i++) {
          const auditSnap = await firestore
            .collection("billingAudit")
            .where("uid", "==", uid)
            .limit(200)
            .get();
          if (auditSnap.empty) break;
          const batch = firestore.batch();
          for (const a of auditSnap.docs) batch.delete(a.ref);
          await batch.commit();
        }
      } catch {}

      // Finally: delete the primary user doc.
      await doc.ref.delete();
      purgedCount += 1;
    } catch (e: any) {
      console.warn("[maintenance/purge-deleted-accounts] failed for", uid, e?.message || e);
    }
  }

  return { purgedCount };
}

export const accountPurgeJob = defineJob({
  name: "account-purge",
  title: "Account Purge",
  description:
    "Hard-deletes closed accounts past deleteAfterMs: recordings + saved videos (storage released), subcollections, account doc (50 per run).",
  intervalMs: 60 * 60_000,
  highlight: "purged",
  async run(ctx) {
    const { purgedCount } = await purgeDeletedAccounts(ctx.now);
    return { processed: purgedCount, details: { purged: purgedCount } };
  },
});
