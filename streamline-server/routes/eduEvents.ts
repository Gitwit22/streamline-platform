import express from "express";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";

const router = express.Router();

// Authenticated EDU endpoints (internal admin UI)
//
// MVP scope:
// - List events owned by the current user (ownerUid)
// - Create/update endpoints can be added later as EDU Events UI lands

router.get("/events", requireAuth, async (req, res) => {
  try {
    const uid = String((req as any).user?.uid || "").trim();
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 50;

    let q = db.collection("events").where("ownerUid", "==", uid);

    // Prefer ordering by scheduledStartAt when present.
    // If the dataset lacks that field, Firestore will throw; fall back to unsorted list.
    let snaps;
    try {
      snaps = await q.orderBy("scheduledStartAt", "desc").limit(limit).get();
    } catch {
      snaps = await q.limit(limit).get();
    }

    const events = snaps.docs.map((d) => {
      const data = d.data() || {};
      return {
        id: d.id,
        title: typeof (data as any).title === "string" ? (data as any).title : "",
        scheduledStartAt: (data as any).scheduledStartAt ?? null,
        status: typeof (data as any).status === "string" ? (data as any).status : null,
        broadcastId: typeof (data as any).broadcastId === "string" ? (data as any).broadcastId : null,
        updatedAt: (data as any).updatedAt ?? null,
      };
    });

    return res.json({ events });
  } catch (err: any) {
    console.error("GET /api/edu/events error", err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
