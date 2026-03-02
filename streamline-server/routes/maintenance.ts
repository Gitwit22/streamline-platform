import { Router } from "express";
import { firestore } from "../firebaseAdmin";
import { requireAdmin } from "../middleware/adminAuth";
import { deleteFiles, deletePrefix } from "../lib/storageClient";
import { deleteRecordingStorage } from "../lib/recordingDeletion";
import { stopEgress } from "../services/livekitEgress";
import { setHlsIdle } from "../services/rooms";

const router = Router();

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

// Admin-only maintenance endpoints (Render cron-friendly)
//
// Supports two auth mechanisms:
// 1) Standard admin auth via requireAdmin (JWT/cookie/body)
// 2) Static maintenance key for cron jobs: header x-maintenance-key
//    (Authorization: Bearer <key> is deprecated; use only for legacy clients)
router.use((req, res, next) => {
  const key = process.env.MAINTENANCE_KEY;
  if (!key) return requireAdmin(req, res, next);

  const headerKey = String(req.headers["x-maintenance-key"] || "").trim();
  const allowDeprecated = process.env.ALLOW_DEPRECATED_AUTHZ_TOKENS !== "0";
  const authHeader = req.headers["authorization"] || req.headers["Authorization"];
  const bearer =
    allowDeprecated && typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : "";

  if (headerKey && headerKey === key) return next();
  if (bearer && bearer === key) {
    console.warn("[deprecation] maintenance key provided via Authorization header; send x-maintenance-key instead");
    return next();
  }

  return requireAdmin(req, res, next);
});

async function expireEmergencyRecordings(now: Date): Promise<{ deletedCount: number }> {
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
          .set({ status: "deleted", deletedAt: now, updatedAt: now }, { merge: true });
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

async function deleteCollection(ref: FirebaseFirestore.CollectionReference, limit: number = 200) {
  const snap = await ref.limit(limit).get();
  if (snap.empty) return 0;
  const batch = firestore.batch();
  for (const doc of snap.docs) batch.delete(doc.ref);
  await batch.commit();
  return snap.size;
}

async function purgeDeletedAccounts(now: Date): Promise<{ purgedCount: number }> {
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

async function purgeExpiredRecordings(now: Date, opts?: { limit?: number }): Promise<{ deletedCount: number }> {
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
    if (status === "deleted") continue;


    try {
      await deleteRecordingStorage(data);
    } catch (e: any) {
      console.warn("[maintenance/purge-expired-recordings] deleteRecordingStorage failed", { recordingId: doc.id, error: e?.message || e });
    }

    try {
      await doc.ref.set(
        { status: "deleted", deleteReason: "expired_retention", deletedAt: now, updatedAt: now },
        { merge: true }
      );
      deletedCount += 1;
    } catch (e: any) {
      console.warn("[maintenance/purge-expired-recordings] failed to update recording", { recordingId: doc.id, error: e?.message || e });
    }
  }

  return { deletedCount };
}

async function purgeStaleHls(now: Date, opts?: { ttlMinutes?: number; limit?: number }) {
  const ttlMinutes = typeof opts?.ttlMinutes === "number" && Number.isFinite(opts.ttlMinutes) ? opts.ttlMinutes : 180;
  const limit = typeof opts?.limit === "number" && Number.isFinite(opts.limit) ? Math.max(1, Math.min(500, opts.limit)) : 100;
  const cutoffMs = now.getTime() - ttlMinutes * 60 * 1000;

  let purgedCount = 0;
  let considered = 0;

  // Prefer a targeted query; if Firestore complains about indexes, fall back to a bounded scan.
  let docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  try {
    const snap = await firestore
      .collection("rooms")
      .where("hls.status", "in", ["starting", "live", "error"])
      .limit(limit)
      .get();
    docs = snap.docs;
  } catch (e) {
    const snap = await firestore
      .collection("rooms")
      .orderBy("updatedAt", "desc")
      .limit(Math.max(limit, 200))
      .get();
    docs = snap.docs;
  }

  for (const doc of docs) {
    const data = (doc.data() || {}) as any;
    const hls = data.hls || {};
    const status = String(hls.status || "idle").toLowerCase();
    if (status !== "starting" && status !== "live" && status !== "error") continue;

    considered += 1;

    // Determine staleness from Firestore timestamps when available.
    let updatedAtMs: number | null = null;
    const updatedAt = hls.updatedAt;
    try {
      if (updatedAt?.toDate) updatedAtMs = updatedAt.toDate().getTime();
      else if (updatedAt instanceof Date) updatedAtMs = updatedAt.getTime();
      else if (typeof updatedAt === "number") updatedAtMs = updatedAt;
    } catch {
      updatedAtMs = null;
    }
    if (updatedAtMs && updatedAtMs > cutoffMs) continue;

    const roomId = doc.id;
    const prefix = String(hls.prefix || `hls/${roomId}/`).trim();
    const egressId = typeof hls.egressId === "string" ? hls.egressId : null;

    try {
      if (egressId) {
        try {
          await stopEgress(egressId);
        } catch (e: any) {
          console.warn("[maintenance/purge-stale-hls] stopEgress failed", { roomId, egressId, error: e?.message || e });
        }
      }

      try {
        await deletePrefix(prefix);
      } catch (e: any) {
        console.warn("[maintenance/purge-stale-hls] deletePrefix failed", { roomId, prefix, error: e?.message || e });
      }

      try {
        await setHlsIdle(doc.ref);
      } catch (e: any) {
        console.warn("[maintenance/purge-stale-hls] setHlsIdle failed", { roomId, error: e?.message || e });
      }

      purgedCount += 1;
    } catch (e: any) {
      console.warn("[maintenance/purge-stale-hls] failed", { roomId, error: e?.message || e });
    }
  }

  return { ok: true, purgedCount, considered, ttlMinutes, limit };
}

router.get("/expire-emergency-recordings", async (_req, res) => {
  const now = new Date();
  const [{ deletedCount }, { deletedCount: purgedRecordingsCount }] = await Promise.all([
    expireEmergencyRecordings(now),
    purgeExpiredRecordings(now),
  ]);
  return res.json({ ok: true, deletedCount, purgedRecordingsCount });
});

router.post("/expire-emergency-recordings", async (_req, res) => {
  const now = new Date();
  const [{ deletedCount }, { deletedCount: purgedRecordingsCount }] = await Promise.all([
    expireEmergencyRecordings(now),
    purgeExpiredRecordings(now),
  ]);
  return res.json({ ok: true, deletedCount, purgedRecordingsCount });
});

// Deletes expired recording objects whose deleteAfterMs has passed.
// POST/GET /api/maintenance/purge-expired-recordings?limit=200
router.get("/purge-expired-recordings", async (req, res) => {
  const now = new Date();
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const { deletedCount } = await purgeExpiredRecordings(now, { limit });
  return res.json({ ok: true, deletedCount });
});

router.post("/purge-expired-recordings", async (req, res) => {
  const now = new Date();
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const { deletedCount } = await purgeExpiredRecordings(now, { limit });
  return res.json({ ok: true, deletedCount });
});

router.get("/purge-deleted-accounts", async (_req, res) => {
  const now = new Date();
  const { purgedCount } = await purgeDeletedAccounts(now);
  return res.json({ ok: true, purgedCount });
});

router.post("/purge-deleted-accounts", async (_req, res) => {
  const now = new Date();
  const { purgedCount } = await purgeDeletedAccounts(now);
  return res.json({ ok: true, purgedCount });
});

// Best-effort safety net for orphaned HLS sessions.
// POST/GET /api/maintenance/purge-stale-hls?ttlMinutes=180&limit=100
router.get("/purge-stale-hls", async (req, res) => {
  const now = new Date();
  const ttlMinutes = req.query.ttlMinutes ? Number(req.query.ttlMinutes) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const result = await purgeStaleHls(now, { ttlMinutes, limit });
  return res.json(result);
});

router.post("/purge-stale-hls", async (req, res) => {
  const now = new Date();
  const ttlMinutes = req.query.ttlMinutes ? Number(req.query.ttlMinutes) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const result = await purgeStaleHls(now, { ttlMinutes, limit });
  return res.json(result);
});

export default router;
