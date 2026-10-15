/**
 * SavedVideo (saved_videos) cleanup shared by DELETE /api/my-content/:id and
 * the unified DELETE /api/editing/assets/:id. Owner-only, never plan-gated.
 * Rows that own an object (uploads, exports saved to the library) delete it
 * and release sizeBytes; recording-backed rows are references only.
 */
import { firestore as db } from "../firebaseAdmin";
import { deleteFile } from "./storageClient";
import { releaseStorageUsage } from "../usageHelper";
import { claimAndDeleteDoc } from "./claimDelete";

export async function deleteSavedVideo(
  uid: string,
  id: string,
  caller: string,
): Promise<{ status: number; body: Record<string, any> }> {
  const ref = db.collection("saved_videos").doc(id);
  // Only the request that deletes the row releases its bytes.
  const claim = await claimAndDeleteDoc(ref, (d) => d?.userId === uid);
  if (claim.status === "not_found") return { status: 404, body: { error: "Saved video not found" } };
  if (claim.status === "forbidden") return { status: 403, body: { error: "forbidden" } };
  const data = claim.data;

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
  return { status: 200, body: { ok: true } };
}
