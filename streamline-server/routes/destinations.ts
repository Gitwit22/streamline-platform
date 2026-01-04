import { Router } from "express";
import { firestore } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import type { DestinationStatus, DestinationStatusReason, ApiErrorCode, DestinationItem, DestinationsGetResponse, DestinationPostResponse, ValidateRequestBody, ValidateResponse } from "../types/streaming";
import { decryptStreamKey, normalizeRtmpBase } from "../lib/crypto";

const router = Router();

function deriveStatus(hasEnc: boolean, streamKeyDec: string | null, enabled: boolean): { status: DestinationStatus; statusReason?: DestinationStatusReason | null } {
  if (!hasEnc) {
    return { status: "needs_attention", statusReason: "missing_key" };
  }
  if (!streamKeyDec) {
    return { status: "needs_attention", statusReason: "invalid_format" };
  }
  if (!enabled) {
    return { status: "disconnected", statusReason: undefined };
  }
  return { status: "connected", statusReason: undefined };
}

function toItem(doc: FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData>): DestinationItem {
  const data = (doc.data() as any) || {};
  const hasEnc = !!data.streamKeyEnc;
  const dec = hasEnc ? decryptStreamKey(data.streamKeyEnc) : null;
  const hasKey = !!dec;
  const keyPreview = dec ? dec.slice(-4) : null;
  const { status, statusReason } = deriveStatus(hasEnc, dec, !!data.enabled);
  return {
    id: doc.id,
    platform: String(data.platform || ""),
    name: data.name || undefined,
    enabled: !!data.enabled,
    rtmpUrlBase: String(data.rtmpUrlBase || ""),
    status,
    statusReason: statusReason ?? null,
    hasKey,
    keyPreview,
    updatedAt: Number(data.updatedAt || 0) || undefined,
  };
}

// GET /api/destinations?platform=youtube&includeDisabled=false
router.get("/", requireAuth, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" as ApiErrorCode });

    const platform = req.query.platform ? String(req.query.platform).trim().toLowerCase() : "";
    const includeDisabled = req.query.includeDisabled === "true" || req.query.includeDisabled === true ? true : false;

    let q = firestore.collection("users").doc(uid).collection("destinations") as FirebaseFirestore.CollectionReference;
    if (platform) {
      q = q.where("platform", "==", platform) as any;
    }
    if (!includeDisabled) {
      q = q.where("enabled", "==", true) as any;
    }
    const snap = await q.get();
    const items = snap.docs.map(toItem);

    // Optional: fetch plan limit
    let limit: number | undefined;
    const userSnap = await firestore.collection("users").doc(uid).get();
    const planId = String((userSnap.data() || {}).planId || "free");
    const planSnap = await firestore.collection("plans").doc(planId).get();
    if (planSnap.exists) {
      const limits = (planSnap.data() || {}).limits || {};
      limit = Number(limits.maxDestinations || 0) || undefined;
    }

    const payload: DestinationsGetResponse = { ok: true, items, usedCount: items.length, limit };
    return res.json(payload);
  } catch (err: any) {
    console.error("GET /api/destinations error:", err);
    return res.status(500).json({ error: "server_error" as ApiErrorCode, details: err?.message || String(err) });
  }
});

async function getPlanLimit(uid: string): Promise<number | undefined> {
  const userSnap = await firestore.collection("users").doc(uid).get();
  const planId = String((userSnap.data() || {}).planId || "free");
  const planSnap = await firestore.collection("plans").doc(planId).get();
  if (planSnap.exists) {
    const limits = (planSnap.data() || {}).limits || {};
    const limit = Number(limits.maxDestinations || 0) || undefined;
    return limit;
  }
  return undefined;
}

async function getEnabledCount(uid: string): Promise<number> {
  const snap = await firestore.collection("users").doc(uid).collection("destinations").where("enabled", "==", true).get();
  return snap.size;
}

// POST /api/destinations
router.post("/", requireAuth, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" as ApiErrorCode });
    const { platform, name, rtmpUrlBase, streamKeyEnc, enabled } = req.body || {};
    if (!platform || !rtmpUrlBase) {
      return res.status(400).json({ error: "missing_required_fields" as ApiErrorCode, details: "platform and rtmpUrlBase are required" });
    }

    const normalizedBase = normalizeRtmpBase(String(rtmpUrlBase));

    // Duplicate rule: same platform + same normalized base per user
    const dupSnap = await firestore.collection("users").doc(uid).collection("destinations")
      .where("platform", "==", String(platform).toLowerCase())
      .where("rtmpUrlBase", "==", normalizedBase)
      .limit(1)
      .get();
    if (!dupSnap.empty) {
      return res.status(409).json({ error: "duplicate_target" as ApiErrorCode });
    }

    // Build doc data
    const now = Date.now();
    const docData: any = {
      platform: String(platform).toLowerCase(),
      name: name ? String(name) : null,
      enabled: enabled === false ? false : true,
      rtmpUrlBase: normalizedBase,
      streamKeyEnc: streamKeyEnc || null,
      updatedAt: now,
    };

    const col = firestore.collection("users").doc(uid).collection("destinations");
    const createdRef = await col.add(docData);
    const createdSnap = await createdRef.get();
    const destination = toItem(createdSnap);

    const usedCount = await getEnabledCount(uid);
    const limit = await getPlanLimit(uid);
    const payload: DestinationPostResponse = {
      ok: true,
      destination,
      validation: { status: destination.status, statusReason: destination.statusReason ?? null },
      usedCount,
      limit,
    };
    return res.status(201).json(payload);
  } catch (err: any) {
    console.error("POST /api/destinations error:", err);
    return res.status(500).json({ error: "server_error" as ApiErrorCode, details: err?.message || String(err) });
  }
});

// POST /api/destinations/validate (pre-create)
router.post("/validate", requireAuth, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" as ApiErrorCode });
    const body: ValidateRequestBody = req.body || ({} as any);
    if (!body.platform || !body.rtmpUrlBase) {
      return res.status(400).json({ error: "missing_required_fields" as ApiErrorCode });
    }
    const normalizedBase = normalizeRtmpBase(body.rtmpUrlBase);
    const dec = body.streamKeyEnc ? decryptStreamKey(body.streamKeyEnc as any) : null;
    const { status, statusReason } = deriveStatus(dec, true);
    const payload: ValidateResponse = { ok: true, status, statusReason: statusReason ?? null };
    return res.json(payload);
  } catch (err: any) {
    console.error("POST /api/destinations/validate error:", err);
    return res.status(500).json({ error: "server_error" as ApiErrorCode, details: err?.message || String(err) });
  }
});

// POST /api/destinations/:id/validate (validate existing; does not update)
router.post("/:id/validate", requireAuth, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" as ApiErrorCode });
    const id = String(req.params.id || "");
    if (!id) return res.status(400).json({ error: "invalid_query" as ApiErrorCode });

    const ref = firestore.collection("users").doc(uid).collection("destinations").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "destination_not_found" as ApiErrorCode });
    const item = toItem(snap);
    const payload: ValidateResponse = { ok: true, status: item.status, statusReason: item.statusReason ?? null };
    return res.json(payload);
  } catch (err: any) {
    console.error("POST /api/destinations/:id/validate error:", err);
    return res.status(500).json({ error: "server_error" as ApiErrorCode, details: err?.message || String(err) });
  }
});

// PUT /api/destinations/:id
router.put("/:id", requireAuth, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" as ApiErrorCode });
    const id = String(req.params.id || "");
    if (!id) return res.status(400).json({ error: "invalid_query" as ApiErrorCode });
    const updates = req.body || {};

    const ref = firestore.collection("users").doc(uid).collection("destinations").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "destination_not_found" as ApiErrorCode });
    const current = snap.data() as any;

    let nextPlatform = typeof updates.platform === "string" ? String(updates.platform).toLowerCase() : current.platform;
    let nextBase = typeof updates.rtmpUrlBase === "string" ? normalizeRtmpBase(String(updates.rtmpUrlBase)) : current.rtmpUrlBase;

    if ((nextPlatform !== current.platform) || (nextBase !== current.rtmpUrlBase)) {
      const dupSnap = await firestore.collection("users").doc(uid).collection("destinations")
        .where("platform", "==", nextPlatform)
        .where("rtmpUrlBase", "==", nextBase)
        .limit(1)
        .get();
      const isDup = !dupSnap.empty && dupSnap.docs[0].id !== id;
      if (isDup) {
        return res.status(409).json({ error: "duplicate_target" as ApiErrorCode });
      }
    }

    const docData: any = {
      platform: nextPlatform,
      rtmpUrlBase: nextBase,
      name: typeof updates.name === "string" ? String(updates.name) : (current.name || null),
      enabled: typeof updates.enabled === "boolean" ? !!updates.enabled : !!current.enabled,
      streamKeyEnc: updates.streamKeyEnc ?? current.streamKeyEnc ?? null,
      updatedAt: Date.now(),
    };
    await ref.set(docData, { merge: true });
    const updatedSnap = await ref.get();
    const destination = toItem(updatedSnap);
    const usedCount = await getEnabledCount(uid);
    const limit = await getPlanLimit(uid);
    return res.json({ ok: true, destination, usedCount, limit });
  } catch (err: any) {
    console.error("PUT /api/destinations/:id error:", err);
    return res.status(500).json({ error: "server_error" as ApiErrorCode, details: err?.message || String(err) });
  }
});

// DELETE /api/destinations/:id
router.delete("/:id", requireAuth, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" as ApiErrorCode });
    const id = String(req.params.id || "");
    if (!id) return res.status(400).json({ error: "invalid_query" as ApiErrorCode });

    const ref = firestore.collection("users").doc(uid).collection("destinations").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "destination_not_found" as ApiErrorCode });
    await ref.delete();
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("DELETE /api/destinations/:id error:", err);
    return res.status(500).json({ error: "server_error" as ApiErrorCode, details: err?.message || String(err) });
  }
});

export default router;
