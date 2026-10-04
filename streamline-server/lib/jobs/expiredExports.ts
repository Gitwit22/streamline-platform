/**
 * Expired exports (daily).
 *
 * Data model (checked): editing_exports/{id} are render jobs. A completed job
 * holds outputPath (R2 key "exports/{uid}/{projectId}/{ts}.ext") and
 * outputUrl, shown once on the Render & Upload page as a download link. The
 * output is NOT copied into saved_videos / My Content (nothing references
 * it except the job doc), and its bytes were counted against the user's
 * storage by the render worker. Failed / canceled jobs never keep an output
 * (the worker deletes it), so only completed outputs are considered here.
 *
 * Completed exports whose completedAt is older than EXPORT_RETENTION_DAYS
 * (default 30; "0" disables) are expired:
 *   1. transaction: mark outputExpiring + outputStorageReleased and decrement
 *      the owner's storageUsedBytes by the object size (HEAD), exactly once
 *   2. delete the R2 object (retried on later runs until it succeeds)
 *   3. mark outputExpired, clear outputUrl (status stays "completed")
 *
 * Saved videos, recordings and project assets are never touched. Paging uses
 * a persisted completedAt cursor (maintenanceState/expiredExports) so
 * finished docs never fill a page.
 */
import { firestore } from "../../firebaseAdmin";
import { checkFileExists, deleteFile, headObjectSize, isR2Configured } from "../storageClient";
import { advanceablePrefixLength, toMillis } from "../mediaPure";
import { defineJob } from "./framework";
import { envNumber, isExportOutputKey } from "./pure";

const COLLECTION = "editing_exports";
const PAGE = 100;
const DAY_MS = 24 * 60 * 60_000;

export function exportRetentionDays(): number {
  return envNumber(process.env.EXPORT_RETENTION_DAYS, 30, { allowZero: true });
}


export async function releaseExportStorageOnce(ref: FirebaseFirestore.DocumentReference, bytes: number, now: Date): Promise<boolean> {
  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const job = (snap.data() || {}) as any;
    if (job.outputStorageReleased === true) return false;
    const uid = typeof job.userId === "string" ? job.userId : "";
    const userRef = uid ? firestore.collection("users").doc(uid) : null;
    const userSnap = userRef && bytes > 0 ? await tx.get(userRef) : null;
    tx.set(ref, { outputExpiring: true, outputStorageReleased: true, outputBytes: bytes, outputStorageReleasedAt: now }, { merge: true });
    if (userRef && userSnap?.exists && bytes > 0) {
      const raw = Number((userSnap.data() as any)?.usage?.storageUsedBytes);
      const current = Number.isFinite(raw) ? raw : 0;
      tx.set(userRef, { usage: { storageUsedBytes: Math.max(0, current - bytes), lastStorageUpdate: now } }, { merge: true });
    }
    return true;
  });
}

export async function purgeExpiredExports(now: Date, opts: { limit?: number; retentionDays?: number } = {}) {
  const retentionDays = opts.retentionDays ?? exportRetentionDays();
  const out = { expired: 0, releasedBytes: 0, scanned: 0, errors: 0, retentionDays, disabled: false };
  if (retentionDays <= 0 || !isR2Configured()) {
    out.disabled = true;
    return out;
  }
  const limit = Math.max(1, Math.min(500, opts.limit ?? 200));
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);

  const cursorRef = firestore.collection("maintenanceState").doc("expiredExports");
  let cursorMs: number | null = null;
  try {
    const c = await cursorRef.get();
    const raw = c.exists ? (c.data() as any)?.completedAtCursorMs : null;
    cursorMs = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  } catch {}

  const doneFlags: boolean[] = [];
  const times: (number | null)[] = [];
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  while (out.expired < limit && out.scanned < 2_000) {
    let q: FirebaseFirestore.Query = firestore.collection(COLLECTION).where("completedAt", "<", cutoff).orderBy("completedAt", "asc");
    if (lastDoc) q = q.startAfter(lastDoc);
    else if (cursorMs !== null) q = q.where("completedAt", ">=", new Date(cursorMs));
    const snap = await q.limit(PAGE).get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      lastDoc = doc;
      out.scanned += 1;
      const job = (doc.data() || {}) as any;
      times.push(toMillis(job.completedAt));

      if (job.status !== "completed" || job.outputExpired === true || !job.outputPath) {
        doneFlags.push(true);
        continue;
      }
      if (out.expired >= limit) {
        doneFlags.push(false);
        continue;
      }
      if (!isExportOutputKey(job.outputPath, job.userId)) {
        // Unknown key shape: never delete, just stop considering it.
        await doc.ref.set({ outputExpired: true, outputExpiredAt: now, outputExpireSkipped: "unexpected_key" }, { merge: true }).catch(() => {});
        doneFlags.push(true);
        continue;
      }

      try {
        if (job.outputStorageReleased !== true) {
          // checkFileExists throws on non-404 errors, so a transient R2
          // failure retries later instead of releasing 0 bytes for good.
          const exists = await checkFileExists(job.outputPath);
          const bytes = exists ? await headObjectSize(job.outputPath) : 0;
          if (await releaseExportStorageOnce(doc.ref, bytes, now)) out.releasedBytes += bytes;
        }
        await deleteFile(job.outputPath);
        await doc.ref.set(
          { outputExpired: true, outputExpiredAt: now, outputExpiring: false, outputUrl: null, currentStep: "Expired" },
          { merge: true }
        );
        out.expired += 1;
        doneFlags.push(true);
      } catch (e: any) {
        out.errors += 1;
        doneFlags.push(false);
        console.warn("[jobs/expired-exports] failed", { exportId: doc.id, error: e?.message || e });
      }
    }
    if (snap.size < PAGE) break;
  }

  const n = advanceablePrefixLength(doneFlags);
  const advanceTo = n > 0 ? times[n - 1] : null;
  if (typeof advanceTo === "number" && (cursorMs === null || advanceTo > cursorMs)) {
    await cursorRef.set({ completedAtCursorMs: advanceTo, updatedAt: now }, { merge: true }).catch(() => {});
  }
  return out;
}

export const expiredExportsJob = defineJob({
  name: "expired-exports",
  title: "Expired Exports",
  description:
    "Deletes rendered export files (editing_exports, completed) older than EXPORT_RETENTION_DAYS (default 30) and releases their storage once. Never touches saved videos or recordings.",
  intervalMs: 24 * 60 * 60_000,
  leaseMs: 30 * 60_000,
  highlight: "expired",
  async run(ctx) {
    const r = await purgeExpiredExports(ctx.now, { limit: ctx.params.limit });
    return {
      processed: r.expired,
      details: r as unknown as Record<string, unknown>,
      error: r.errors > 0 ? `${r.errors} export(s) failed` : null,
    };
  },
});
