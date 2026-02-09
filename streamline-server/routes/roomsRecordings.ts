import { Router } from "express";
import { firestore } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { getSignedDownloadUrl, headObjectSize, isR2Configured } from "../lib/storageClient";

const router = Router();

function getAuthUserId(req: any): string | null {
  return req.user?.uid || req.user?.id || null;
}

function normalizeRoomId(roomId: unknown): string {
  return String(roomId || "").trim();
}

function normalizeStorageKey(key: unknown): string | null {
  const raw = String(key ?? "").trim();
  if (!raw) return null;
  return raw.startsWith("/") ? raw.slice(1) : raw;
}

type LatestRecordingState = "none" | "processing" | "ready" | "failed";

type RecordingDoc = {
  id: string;
  data: any;
};

function statusToState(statusRaw: unknown): LatestRecordingState {
  const status = String(statusRaw || "").toLowerCase();
  if (!status) return "none";
  if (status === "ready") return "ready";
  if (status === "failed") return "failed";
  if (status === "deleted" || status === "deleting") return "none";
  // starting/recording/processing/stopped => processing from a UX perspective
  return "processing";
}

function toIsoOrNull(value: any): string | null {
  if (!value) return null;
  try {
    if (value instanceof Date) return value.toISOString();
    if (typeof value?.toDate === "function") {
      const d = value.toDate();
      return d instanceof Date ? d.toISOString() : null;
    }
    // If Firestore timestamp is serialized somehow, avoid guessing.
    return null;
  } catch {
    return null;
  }
}

async function getRecordingById(recordingId: string): Promise<RecordingDoc | null> {
  const id = String(recordingId || "").trim();
  if (!id) return null;
  const snap = await firestore.collection("recordings").doc(id).get();
  if (!snap.exists) return null;
  return { id: snap.id, data: (snap.data() as any) || {} };
}

async function findLatestRecordingForRoom(params: {
  uid: string;
  roomId: string;
  roomLatestRecordingId?: string | null;
}): Promise<RecordingDoc | null> {
  const { uid, roomId, roomLatestRecordingId } = params;

  // 1) Prefer the room pointer when it points at a recording owned by the caller.
  if (roomLatestRecordingId) {
    const byPointer = await getRecordingById(roomLatestRecordingId);
    if (byPointer) {
      const data = byPointer.data || {};
      const ownerUid = String(data.userId || "").trim();
      const recRoomId = String(data.roomId || "").trim();
      if (ownerUid === uid && recRoomId === roomId) return byPointer;
    }
  }

  // 2) Deterministic fallback: newest by startedAt (or createdAt).
  // Note: this may require a composite index in Firestore; if it fails, we fall back safely.
  try {
    const querySnap = await firestore
      .collection("recordings")
      .where("roomId", "==", roomId)
      .where("userId", "==", uid)
      .orderBy("startedAt", "desc")
      .limit(5)
      .get();

    for (const doc of querySnap.docs) {
      const data = (doc.data() as any) || {};
      const state = statusToState(data.status);
      if (state === "none") continue;
      return { id: doc.id, data };
    }
  } catch (e: any) {
    console.warn("[rooms/latest-recording] query fallback failed (likely missing index); using room pointer only", e?.message || e);
  }

  // 3) Last resort: nothing.
  return null;
}

// GET /api/rooms/:roomId/latest-recording
// Authenticated host-only: validates the recording owner matches req.user.
router.get("/:roomId/latest-recording", requireAuth, async (req, res) => {
  // Never allow caching of recording readiness; processing → ready can change quickly.
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Vary", "Authorization");

  try {
    const uid = getAuthUserId(req);
    if (!uid) return res.status(401).json({ error: "unauthorized" });

    const roomId = normalizeRoomId(req.params.roomId);
    if (!roomId) return res.status(400).json({ error: "missing_room_id" });

    const roomSnap = await firestore.collection("rooms").doc(roomId).get();
    const roomData = roomSnap.exists ? ((roomSnap.data() as any) || {}) : {};

    const roomLatestRecordingId = String(roomData.latestRecordingId || "").trim() || null;
    const recDoc = await findLatestRecordingForRoom({ uid, roomId, roomLatestRecordingId });

    if (!recDoc) {
      return res.status(200).json({ ok: true, roomId, state: "none" satisfies LatestRecordingState });
    }

    const recordingId = recDoc.id;
    const rec = recDoc.data || {};
    const state = statusToState(rec.status);

    // Keep room pointer synced if it was missing or stale (best-effort; do not block response).
    if (!roomLatestRecordingId || roomLatestRecordingId !== recordingId) {
      void firestore
        .collection("rooms")
        .doc(roomId)
        .set(
          {
            latestRecordingId: recordingId,
            latestRecordingStatus: state === "none" ? null : state,
            latestRecordingUpdatedAt: new Date(),
          },
          { merge: true }
        )
        .catch(() => {});
    }

    if (state === "none") {
      return res.status(200).json({ ok: true, roomId, state: "none" satisfies LatestRecordingState });
    }

    if (state === "processing") {
      return res.status(200).json({
        ok: true,
        roomId,
        state,
        recordingId,
        status: String(rec.status || ""),
        createdAt: toIsoOrNull(rec.createdAt),
        startedAt: toIsoOrNull(rec.startedAt),
        stoppedAt: toIsoOrNull(rec.stoppedAt),
        updatedAt: toIsoOrNull(rec.updatedAt),
      });
    }

    if (state === "failed") {
      return res.status(200).json({
        ok: true,
        roomId,
        state,
        recordingId,
        status: String(rec.status || ""),
        error: String(rec.errorMessage || "Recording failed").trim(),
        updatedAt: toIsoOrNull(rec.updatedAt),
      });
    }

    const objectKey = normalizeStorageKey(rec.objectKey || rec.downloadPath);
    if (!objectKey) {
      return res.status(200).json({
        ok: true,
        roomId,
        state: "failed" satisfies LatestRecordingState,
        recordingId,
        status: String(rec.status || ""),
        error: "Recording marked ready but no objectKey present",
      });
    }

    if (!isR2Configured()) {
      // Do not hard-fail the endpoint; the UI should still show "ready" but disable download.
      return res.status(200).json({
        ok: true,
        roomId,
        state: "ready" satisfies LatestRecordingState,
        recordingId,
        downloadUrl: null,
        signedUrl: null,
        expiresAt: null,
        expiresAtMs: null,
        fileSize: typeof rec.fileSize === "number" ? rec.fileSize : null,
        storageConfigured: false,
        error: "storage_not_configured",
      });
    }

    const ttlSeconds = 3600;
    const downloadUrl = await getSignedDownloadUrl(objectKey, ttlSeconds);
    const expiresAtMs = Date.now() + ttlSeconds * 1000;
    const expiresAt = new Date(expiresAtMs).toISOString();

    return res.status(200).json({
      ok: true,
      roomId,
      state: "ready" satisfies LatestRecordingState,
      recordingId,
      // Preferred field name (per matrix)
      downloadUrl,
      // Back-compat (clients may still read this)
      signedUrl: downloadUrl,
      expiresAt,
      expiresAtMs,
      fileSize: typeof rec.fileSize === "number" ? rec.fileSize : null,
      storageConfigured: true,
    });
  } catch (err: any) {
    console.error("[rooms/latest-recording] error", err?.message || err);
    // Prefer a non-500 payload so the UI panel doesn't "break"; clients can continue polling.
    return res.status(200).json({
      ok: false,
      state: "failed" satisfies LatestRecordingState,
      error: "latest_recording_failed",
    });
  }
});

// POST /api/rooms/:roomId/recordings/reconcile
// Best-effort self-heal: if latest recording is processing but file exists in R2, mark ready.
router.post("/:roomId/recordings/reconcile", requireAuth, async (req, res) => {
  // This endpoint is used by background polling; never cache responses.
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Vary", "Authorization");

  try {
    const uid = getAuthUserId(req);
    if (!uid) return res.status(401).json({ error: "unauthorized" });

    const roomId = normalizeRoomId(req.params.roomId);
    if (!roomId) return res.status(400).json({ error: "missing_room_id" });

    const roomRef = firestore.collection("rooms").doc(roomId);
    const roomSnap = await roomRef.get();
    const roomData = roomSnap.exists ? ((roomSnap.data() as any) || {}) : {};

    const roomLatestRecordingId = String(roomData.latestRecordingId || "").trim() || null;
    const recDoc = await findLatestRecordingForRoom({ uid, roomId, roomLatestRecordingId });

    if (!recDoc) {
      return res.status(200).json({ ok: true, roomId, reconciled: false, state: "none" as LatestRecordingState });
    }

    const recordingId = recDoc.id;
    const rec = recDoc.data || {};
    const state = statusToState(rec.status);

    // Idempotency: never mutate terminal states.
    if (state === "none" || state === "ready" || state === "failed") {
      return res.status(200).json({ ok: true, roomId, reconciled: false, state, recordingId, status: String(rec.status || "") });
    }

    const objectKey = normalizeStorageKey(rec.objectKey || rec.downloadPath);
    if (!objectKey) {
      return res.status(200).json({ ok: true, roomId, reconciled: false, state, recordingId, status: String(rec.status || ""), reason: "missing_object_key" });
    }

    const size = await headObjectSize(objectKey);
    if (size <= 0) {
      return res.status(200).json({ ok: true, roomId, reconciled: false, state, recordingId });
    }

    const now = new Date();
    await firestore
      .collection("recordings")
      .doc(recordingId)
      .set(
        {
          status: "ready",
          downloadReady: true,
          fileSize: size,
          readyAt: now,
          updatedAt: now,
        },
        { merge: true }
      );

    // Keep room pointer synced to the reconciled recording (deterministic latest selection).
    await roomRef.set(
      {
        latestRecordingId: recordingId,
        latestRecordingStatus: "ready",
        latestRecordingUpdatedAt: now,
      },
      { merge: true }
    );

    return res.status(200).json({ ok: true, roomId, reconciled: true, state: "ready" as LatestRecordingState, recordingId, fileSize: size });
  } catch (err: any) {
    console.error("[rooms/recordings/reconcile] error", err?.message || err);
    return res.status(500).json({ error: "reconcile_failed" });
  }
});

export default router;
