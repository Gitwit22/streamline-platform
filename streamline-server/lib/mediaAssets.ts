/**
 * MediaAssets (Firestore side): one listing API and one resolver for every
 * source the editor uses. See mediaAssetsPure.ts for the shape and mapping.
 */
import { firestore as db } from "../firebaseAdmin";
import { getSignedDownloadUrl } from "./storageClient";
import {
  isDeletedStatus,
  mergeMediaAssets,
  projectAssetToMediaAsset,
  recordingToMediaAsset,
  savedVideoToMediaAsset,
  uploadToMediaAsset,
  type MediaAsset,
} from "./mediaAssetsPure";

const PLAYBACK_URL_TTL_SEC = 3600;

/** Replace videoUrl with a short-lived presigned URL when the asset has a key. */
export async function withPlayableUrl(a: MediaAsset): Promise<MediaAsset> {
  if (!a.storageKey) return a;
  if (a.type === "recording" && a.status !== "ready") return a;
  try {
    return { ...a, videoUrl: await getSignedDownloadUrl(a.storageKey, PLAYBACK_URL_TTL_SEC) };
  } catch {
    return a;
  }
}

export async function listMediaAssets(
  uid: string,
  opts: { recordings: boolean; uploads: boolean },
): Promise<MediaAsset[]> {
  const [recSnap, upSnap, svSnap] = await Promise.all([
    opts.recordings ? db.collection("recordings").where("userId", "==", uid).get() : null,
    opts.uploads ? db.collection("editing_assets").where("userId", "==", uid).get() : null,
    opts.uploads ? db.collection("saved_videos").where("userId", "==", uid).get() : null,
  ]);
  const recordings = recSnap ? recSnap.docs.map((d) => recordingToMediaAsset(d.id, d.data())) : [];
  const uploads = upSnap ? upSnap.docs.map((d) => uploadToMediaAsset(d.id, d.data())) : [];
  const saved = svSnap
    ? (svSnap.docs.map((d) => savedVideoToMediaAsset(d.id, d.data())).filter(Boolean) as MediaAsset[])
    : [];
  const merged = mergeMediaAssets(recordings, uploads, saved);
  return Promise.all(merged.map(withPlayableUrl));
}

/**
 * Resolve one asset id the caller owns, across all backing collections.
 * Returns null when missing, deleted or owned by someone else.
 */
export async function resolveMediaAsset(uid: string, id: string): Promise<MediaAsset | null> {
  if (!id || id.includes("/")) return null;

  const rec = await db.collection("recordings").doc(id).get();
  if (rec.exists) {
    const d = rec.data() as any;
    if (d?.userId !== uid || isDeletedStatus(d?.status)) return null;
    return recordingToMediaAsset(rec.id, d);
  }
  const up = await db.collection("editing_assets").doc(id).get();
  if (up.exists) {
    const d = up.data() as any;
    return d?.userId === uid ? uploadToMediaAsset(up.id, d) : null;
  }
  const sv = await db.collection("saved_videos").doc(id).get();
  if (sv.exists) {
    const d = sv.data() as any;
    if (d?.userId !== uid) return null;
    if (d?.sourceType === "recording" && typeof d?.sourceId === "string" && d.sourceId) {
      // Same file as the recording: resolve through it (owner + status checks).
      const viaRec = await resolveMediaAsset(uid, d.sourceId);
      return viaRec ? { ...viaRec, id: sv.id } : null;
    }
    return savedVideoToMediaAsset(sv.id, d);
  }
  const pa = await db.collection("project_assets").doc(id).get();
  if (pa.exists) {
    const d = pa.data() as any;
    return d?.ownerId === uid ? projectAssetToMediaAsset(pa.id, d) : null;
  }
  return null;
}

/** Resolve many ids (deduped) -> Map id -> asset (missing ids omitted). */
export async function resolveMediaAssets(uid: string, ids: Iterable<string>): Promise<Map<string, MediaAsset>> {
  const out = new Map<string, MediaAsset>();
  const unique = Array.from(new Set(Array.from(ids).filter(Boolean)));
  await Promise.all(
    unique.map(async (id) => {
      try {
        const a = await resolveMediaAsset(uid, id);
        if (a) out.set(id, a);
      } catch {
        // missing / transient: caller treats as unavailable
      }
    }),
  );
  return out;
}
