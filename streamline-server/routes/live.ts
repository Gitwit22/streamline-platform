import { Router } from "express";
import { firestore } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { canAccessFeature } from "./featureAccess";
import type { DestinationStatus, DestinationStatusReason, ApiErrorCode } from "../types/streaming";
import { decryptStreamKey } from "../lib/crypto";

const router = Router();

function deriveStatus(hasEnc: boolean, dec: string | null, enabled: boolean): { status: DestinationStatus; statusReason?: DestinationStatusReason | null } {
  if (!hasEnc) return { status: "needs_attention", statusReason: "missing_key" };
  if (!dec) return { status: "needs_attention", statusReason: "invalid_format" };
  if (!enabled) return { status: "disconnected", statusReason: undefined };
  return { status: "connected", statusReason: undefined };
}

// POST /api/live/preflight
// destinationIds? omitted => use enabled destinations
// video/audio are client hints only; server enforces plan/destinations
// networkProbeMs is ignored for MVP
router.post("/preflight", requireAuth, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" as ApiErrorCode });

    const access = await canAccessFeature((req as any).account || uid, "multistream");
    if (!access.allowed) {
      return res.status(403).json({ error: "limit_exceeded" as ApiErrorCode, details: access.reason || "Feature not available" });
    }

    const destinationIds: string[] = Array.isArray(req.body?.destinationIds) ? req.body.destinationIds.map((s: any) => String(s)) : [];

    let q = firestore.collection("users").doc(uid).collection("destinations") as FirebaseFirestore.CollectionReference;
    if (destinationIds.length > 0) {
      // Firestore cannot do IN with more than 10; if >10, fallback to fetch all and filter
      if (destinationIds.length <= 10) {
        q = q.where("__name__", "in", destinationIds) as any;
        const snap = await q.get();
        if (snap.empty) {
          return res.status(404).json({ error: "destination_not_found" as ApiErrorCode });
        }
        const items = snap.docs.map(d => ({ id: d.id, data: d.data() as any }));
        const results = items.map(({ id, data }) => {
          const hasEnc = !!data.streamKeyEnc;
          const dec = hasEnc ? decryptStreamKey(data.streamKeyEnc) : null;
          const { status, statusReason } = deriveStatus(hasEnc, dec, !!data.enabled);
          return {
            id,
            platform: String(data.platform || ""),
            status,
            statusReason: statusReason ?? null,
          };
        });
        return res.json({ ok: true, allowed: true, destinations: results });
      } else {
        const snap = await q.get();
        const set = new Set(destinationIds);
        const filtered = snap.docs.filter(d => set.has(d.id));
        if (filtered.length === 0) {
          return res.status(404).json({ error: "destination_not_found" as ApiErrorCode });
        }
        const results = filtered.map(d => {
          const data = d.data() as any;
          const hasEnc = !!data.streamKeyEnc;
          const dec = hasEnc ? decryptStreamKey(data.streamKeyEnc) : null;
          const { status, statusReason } = deriveStatus(hasEnc, dec, !!data.enabled);
          return {
            id: d.id,
            platform: String(data.platform || ""),
            status,
            statusReason: statusReason ?? null,
          };
        });
        return res.json({ ok: true, allowed: true, destinations: results });
      }
    } else {
      // Use enabled destinations
      q = q.where("enabled", "==", true) as any;
      const snap = await q.get();
      const results = snap.docs.map(d => {
        const data = d.data() as any;
        const hasEnc = !!data.streamKeyEnc;
        const dec = hasEnc ? decryptStreamKey(data.streamKeyEnc) : null;
        const { status, statusReason } = deriveStatus(hasEnc, dec, true);
        return {
          id: d.id,
          platform: String(data.platform || ""),
          status,
          statusReason: statusReason ?? null,
        };
      });
      return res.json({ ok: true, allowed: true, destinations: results });
    }
  } catch (err: any) {
    console.error("POST /api/live/preflight error:", err);
    return res.status(500).json({ error: "server_error" as ApiErrorCode, details: err?.message || String(err) });
  }
});

export default router;
