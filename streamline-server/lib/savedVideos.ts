/**
 * SavedVideo (saved_videos) cleanup shared by DELETE /api/my-content/:id and
 * the unified DELETE /api/editing/assets/:id. Owner-only, never plan-gated.
 * Rows that own an object (uploads, exports saved to the library) delete it
 * and release sizeBytes; recording-backed rows are references only.
 */
import { firestore as db } from "../firebaseAdmin";
import { deleteFile } from "./storageClient";
import { releaseStorageUsage } from "../usageHelper";

export async function deleteSavedVideo(
  uid: string,
  id: string,
  caller: string,
): Promise<{ status: number; body: Record<string, any> }> {
  const ref = db.collection("saved_videos").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { status: 404, body: { error: "Saved video not found" } };
  const data = snap.data() as any;
  if (data?.userId !== uid) return { status: 403, body: { error: "forbidden" } };

  const sizeBytes = typeof data.sizeBytes === "number" ? data.sizeBytes : 0;
  const storagePath = typeof data.storagePath === "string" ? data.storagePath : null;
  if (storagePath) {
    try {
      await deleteFile(storagePath);
    } catch (e: any) {
      console.warn("[saved-videos] storage delete failed:", e?.message || e);
    }
    if (sizeBytes > 0) {
      try {
        await releaseStorageUsage(uid, sizeBytes, { caller, docId: id, storagePath });
      } catch (e: any) {
        console.error("[saved-videos] storage release failed:", { uid, docId: id, sizeBytes, storagePath, error: e?.message || e });
      }
    }
  }
  await ref.delete();
  return { status: 200, body: { ok: true } };
}
