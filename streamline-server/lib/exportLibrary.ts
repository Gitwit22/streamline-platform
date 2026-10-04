/**
 * "Save to library" for completed exports (Firestore + R2 side).
 * See exportLibraryPure.ts for the rules.
 *
 * Storage accounting: the render worker already counted the output bytes on
 * the owner. Saving MOVES them: the object is copied under a stable key, the
 * saved_videos doc records sizeBytes (released when the saved video is
 * deleted) and the export job is marked outputStorageReleased so the
 * retention job never releases them a second time. The original export
 * object is deleted right away; if that fails the retention job deletes it
 * later (it skips the release because outputStorageReleased is set).
 */
import { firestore as db } from "../firebaseAdmin";
import { checkFileExists, copyObject, deleteFile, headObjectSize } from "./storageClient";
import { logger } from "./logger";
import { releaseExportStorageOnce } from "./jobs/expiredExports";
import {
  buildSavedVideoFromExport,
  decideSaveExport,
  exportLibraryKey,
  savedVideoIdForExport,
} from "./exportLibraryPure";

const EXPORTS = "editing_exports";

export type SaveExportResult =
  | { ok: true; savedVideoId: string; storagePath: string; created: boolean }
  | { ok: false; status: number; error: string };

export async function saveExportToLibrary(uid: string, exportId: string, title?: string): Promise<SaveExportResult> {
  const jobRef = db.collection(EXPORTS).doc(exportId);
  const jobSnap = await jobRef.get();
  const job = jobSnap.exists ? (jobSnap.data() as any) : null;
  const decision = decideSaveExport(job, uid);
  if ("error" in decision) return { ok: false, status: decision.status, error: decision.error };

  if (job.savedVideoId) {
    const sv = await db.collection("saved_videos").doc(job.savedVideoId).get();
    if (sv.exists) return { ok: true, savedVideoId: sv.id, storagePath: String((sv.data() as any)?.storagePath || ""), created: false };
  }

  const savedVideoId = savedVideoIdForExport(exportId);
  const outputPath = String(job.outputPath).trim();
  const storagePath = exportLibraryKey(uid, exportId, outputPath);

  let projectName = "";
  try {
    if (job.projectId) {
      const p = await db.collection("projects").doc(String(job.projectId)).get();
      projectName = p.exists ? String((p.data() as any)?.name || "") : "";
    }
  } catch { /* title only */ }
  const finalTitle = (typeof title === "string" && title.trim()) || projectName || "Exported video";

  await copyObject(outputPath, storagePath);
  const sizeBytes = await headObjectSize(storagePath);
  const now = new Date();

  const outcome = await db.runTransaction(async (tx) => {
    const svRef = db.collection("saved_videos").doc(savedVideoId);
    const [fresh, sv] = await Promise.all([tx.get(jobRef), tx.get(svRef)]);
    const fj = (fresh.data() || {}) as any;
    if (sv.exists) {
      if (!fj.savedVideoId) tx.set(jobRef, { savedVideoId }, { merge: true });
      return "exists" as const;
    }
    const again = decideSaveExport(fresh.exists ? fj : null, uid);
    if (!again.ok || fj.savedVideoId) return "expired" as const;
    tx.create(svRef, buildSavedVideoFromExport(exportId, fj, { storagePath, sizeBytes, title: finalTitle, now }));
    tx.set(
      jobRef,
      {
        savedVideoId,
        outputStorageReleased: true, // bytes now owned by saved_videos/{savedVideoId}
        outputBytes: sizeBytes,
        outputMovedTo: storagePath,
        outputUrl: null,
        currentStep: "Saved to library",
      },
      { merge: true },
    );
    return "created" as const;
  });

  if (outcome === "expired") {
    // Raced with the retention job (bytes already released): drop the copy.
    await deleteFile(storagePath).catch(() => {});
    return { ok: false, status: 410, error: "export_output_expired" };
  }
  if (outcome === "exists") {
    // A concurrent request created it; our copy wrote the same key.
    return { ok: true, savedVideoId, storagePath, created: false };
  }

  try {
    await deleteFile(outputPath);
    await jobRef.set({ outputExpired: true, outputExpiredAt: new Date() }, { merge: true });
  } catch (e: any) {
    logger.warn({ exportId, outputPath, err: e?.message || String(e) }, "export output delete after save failed; retention job will remove it");
  }
  return { ok: true, savedVideoId, storagePath, created: true };
}

/**
 * Owner cleanup: delete an export's rendered output now instead of waiting for
 * the retention job (never plan-gated). Releases the counted bytes exactly
 * once (shared with jobs/expiredExports) and keeps the job doc as history.
 * Outputs already moved to the library are owned by the saved video.
 */
export async function deleteExportOutput(uid: string, exportId: string): Promise<{ status: number; body: Record<string, any> }> {
  const ref = db.collection(EXPORTS).doc(exportId);
  const snap = await ref.get();
  if (!snap.exists) return { status: 404, body: { error: "export_not_found" } };
  const job = snap.data() as any;
  if (job.userId !== uid) return { status: 403, body: { error: "forbidden" } };
  if (["queued", "preparing", "rendering", "uploading"].includes(job.status)) {
    return { status: 409, body: { error: "export_in_progress" } };
  }
  const outputPath = typeof job.outputPath === "string" ? job.outputPath.trim() : "";
  if (job.outputExpired === true || !outputPath) return { status: 200, body: { ok: true, deleted: false } };
  const now = new Date();
  let releasedBytes = 0;
  if (job.outputStorageReleased !== true) {
    const exists = await checkFileExists(outputPath);
    const bytes = exists ? await headObjectSize(outputPath) : 0;
    if (await releaseExportStorageOnce(ref, bytes, now)) releasedBytes = bytes;
  }
  await deleteFile(outputPath);
  await ref.set({ outputExpired: true, outputExpiredAt: now, outputExpiring: false, outputUrl: null, currentStep: "Deleted" }, { merge: true });
  return { status: 200, body: { ok: true, deleted: true, releasedBytes } };
}
