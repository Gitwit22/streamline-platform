import { LIMIT_ERRORS } from "../lib/limitErrors";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { Router } from "express";
import { randomUUID } from "crypto";
import { firestore } from "../firebaseAdmin";
import { resolveMaxDestinations } from "../lib/planLimits";
import { assertPlatformTranscodeEnabled } from "../lib/platformFlags";
import { requireAuth } from "../middleware/requireAuth";
import type { DestinationStatus, DestinationStatusReason, ApiErrorCode, DestinationItem, DestinationsGetResponse, DestinationPostResponse, ValidateRequestBody, ValidateResponse } from "../types/streaming";
import { decryptStreamKey, encryptStreamKey, normalizeRtmpBase } from "../lib/crypto";

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

function normalizeName(name?: string | null): string {
  return (name || "").trim().toLowerCase();
}

function normalizeStreamKeyInput(key?: string | null): string | null {
  if (typeof key !== "string") return null;
  const cleaned = key.replace(/\s+/g, "");
  const trimmed = cleaned.trim();
  return trimmed || null;
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
    targetId: data.targetId || doc.id,
    platform: String(data.platform || ""),
    name: data.name || undefined,
    enabled: !!data.enabled,
    mode: data.mode || "manual",
    persistent: typeof data.persistent === "boolean" ? data.persistent : true,
    oauthRef: data.oauthRef || null,
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
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    if (!assertPlatformTranscodeEnabled(res)) return;

    const limit = await getPlanLimit(uid);
    if (!limit || limit < 1) {
      return res.status(403).json({ error: LIMIT_ERRORS.FEATURE_NOT_ENTITLED });
    }

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
    const resolved = resolveMaxDestinations(limits);
    const limit = resolved > 0 ? resolved : undefined;
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
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    if (!assertPlatformTranscodeEnabled(res)) return;

    const planLimit = await getPlanLimit(uid);
    if (!planLimit || planLimit < 1) {
      return res.status(403).json({ error: LIMIT_ERRORS.FEATURE_NOT_ENTITLED });
    }
    const { platform, name, rtmpUrlBase, streamKeyEnc, streamKeyPlain, enabled, mode, persistent, oauthRef } = req.body || {};
    if (!platform || !rtmpUrlBase) {
      return res.status(400).json({ error: "missing_required_fields" as ApiErrorCode, details: "platform and rtmpUrlBase are required" });
    }

    const normalizedBase = normalizeRtmpBase(String(rtmpUrlBase));
    const normalizedPlatform = String(platform).toLowerCase();
    const normalizedName = normalizeName(name);

    // Enforce plan limit for enabled destinations
    const enabledCount = await getEnabledCount(uid);
    const willBeEnabled = enabled === false ? false : true;
    if (willBeEnabled && planLimit !== undefined && planLimit > 0 && enabledCount >= planLimit) {
      return res.status(409).json({ error: LIMIT_ERRORS.LIMIT_EXCEEDED });
    }

    // Resolve encrypted key: prefer freshly provided plaintext (server-encrypted),
    // otherwise allow callers to supply an already-encrypted payload.
    let finalEnc: any = streamKeyEnc || null;
    let plainKey: string | null = null;
    const normalizedPlain = normalizeStreamKeyInput(streamKeyPlain);
    if (normalizedPlain) {
      const enc = encryptStreamKey(normalizedPlain);
      if (!enc) {
        return res.status(500).json({ error: "server_error" as ApiErrorCode, details: "stream key encryption is not configured" });
      }
      finalEnc = enc;
      plainKey = normalizedPlain;
    } else if (streamKeyEnc) {
      const dec = decryptStreamKey(streamKeyEnc as any);
      plainKey = normalizeStreamKeyInput(dec);
    }

    // Duplicate rules:
    // 1) Names must be unique per platform (case-insensitive).
    // 2) Stream keys must be unique per platform (match on decrypted plaintext).
    const existingSnap = await firestore
      .collection("users")
      .doc(uid)
      .collection("destinations")
      .where("platform", "==", normalizedPlatform)
      .get();

    for (const doc of existingSnap.docs) {
      const data = doc.data() as any;
      const existingName = normalizeName(data?.name);
      if (normalizedName && normalizedName === existingName) {
        return res.status(409).json({ error: "duplicate_name" as ApiErrorCode });
      }
      if (plainKey) {
        const existingDec = data?.streamKeyEnc ? decryptStreamKey(data.streamKeyEnc) : null;
        const existingNorm = normalizeStreamKeyInput(existingDec);
        if (existingNorm && existingNorm === plainKey) {
          return res.status(409).json({ error: "duplicate_stream_key" as ApiErrorCode });
        }
      }
    }

    // Build doc data
    const now = Date.now();
    const docData: any = {
      platform: normalizedPlatform,
      targetId: randomUUID(),
      name: name ? String(name) : null,
      enabled: enabled === false ? false : true,
      mode: mode === "connected" ? "connected" : "manual",
      persistent: typeof persistent === "boolean" ? persistent : true,
      oauthRef: oauthRef || null,
      rtmpUrlBase: normalizedBase,
      streamKeyEnc: (typeof persistent === "boolean" && persistent === false) ? null : (finalEnc || null),
      updatedAt: now,
    };

    const col = firestore.collection("users").doc(uid).collection("destinations");
    const createdRef = await col.add(docData);

    const createdSnap = await createdRef.get();
    const destination = toItem(createdSnap);

    const usedCount = await getEnabledCount(uid);
    const limit = planLimit;
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
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    if (!assertPlatformTranscodeEnabled(res)) return;

    const planLimit = await getPlanLimit(uid);
    if (!planLimit || planLimit < 1) {
      return res.status(403).json({ error: LIMIT_ERRORS.FEATURE_NOT_ENTITLED });
    }
    const body: ValidateRequestBody = req.body || ({} as any);
    if (!body.platform || !body.rtmpUrlBase) {
      return res.status(400).json({ error: "missing_required_fields" as ApiErrorCode });
    }
    const normalizedBase = normalizeRtmpBase(body.rtmpUrlBase);
    let dec: string | null = null;
    let hasEnc = false;
    if (typeof body.streamKeyPlain === "string") {
      const norm = normalizeStreamKeyInput(body.streamKeyPlain);
      dec = norm;
      hasEnc = !!norm;
    } else if (body.streamKeyEnc) {
      const raw = decryptStreamKey(body.streamKeyEnc as any);
      dec = normalizeStreamKeyInput(raw);
      hasEnc = !!body.streamKeyEnc;
    }
    const { status, statusReason } = deriveStatus(hasEnc, dec, true);
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
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    if (!assertPlatformTranscodeEnabled(res)) return;

    const planLimit = await getPlanLimit(uid);
    if (!planLimit || planLimit < 1) {
      return res.status(403).json({ error: LIMIT_ERRORS.FEATURE_NOT_ENTITLED });
    }
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
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    if (!assertPlatformTranscodeEnabled(res)) return;

    const planLimit = await getPlanLimit(uid);
    if (!planLimit || planLimit < 1) {
      return res.status(403).json({ error: LIMIT_ERRORS.FEATURE_NOT_ENTITLED });
    }
    const id = String(req.params.id || "");
    if (!id) return res.status(400).json({ error: "invalid_query" as ApiErrorCode });
    const updates = req.body || {};

    const ref = firestore.collection("users").doc(uid).collection("destinations").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "destination_not_found" as ApiErrorCode });
    const current = snap.data() as any;

    let nextPlatform = typeof updates.platform === "string" ? String(updates.platform).toLowerCase() : current.platform;
    let nextBase = typeof updates.rtmpUrlBase === "string" ? normalizeRtmpBase(String(updates.rtmpUrlBase)) : current.rtmpUrlBase;
    const nextNameNorm = normalizeName(typeof updates.name === "string" ? updates.name : current.name);
    const nextMode = updates.mode === "connected" ? "connected" : "manual";
    const nextPersistent = typeof updates.persistent === "boolean" ? updates.persistent : (typeof current.persistent === "boolean" ? current.persistent : true);

    // Resolve encrypted key updates. If a new plaintext key is provided, encrypt
    // and store it unless persistent is false (session-only). If streamKeyEnc is
    // explicitly provided, honor it. Otherwise keep the existing value.
    let nextEnc: any = current.streamKeyEnc ?? null;
    let nextPlainKey: string | null = null;
    if (typeof updates.streamKeyPlain === "string") {
      const normalizedPlain = normalizeStreamKeyInput(updates.streamKeyPlain);
      if (normalizedPlain) {
        if (updates.persistent === false || current.persistent === false) {
          // Session-only: do not persist new key
          nextEnc = null;
          nextPlainKey = null;
        } else {
        const enc = encryptStreamKey(normalizedPlain);
        if (!enc) {
          return res.status(500).json({ error: "server_error" as ApiErrorCode, details: "stream key encryption is not configured" });
        }
        nextEnc = enc;
        nextPlainKey = normalizedPlain;
        }
      } else {
        // Empty string clears the key
        nextEnc = null;
        nextPlainKey = null;
      }
    } else if (Object.prototype.hasOwnProperty.call(updates, "streamKeyEnc")) {
      nextEnc = updates.streamKeyEnc ?? null;
      const dec = updates.streamKeyEnc ? decryptStreamKey(updates.streamKeyEnc as any) : null;
      nextPlainKey = normalizeStreamKeyInput(dec);
    } else if (current.streamKeyEnc) {
      nextPlainKey = normalizeStreamKeyInput(decryptStreamKey(current.streamKeyEnc));
    }

    // Duplicate rules on update (exclude current doc):
    // 1) Names unique per platform.
    // 2) Stream keys unique per platform.
    const existingSnap = await firestore
      .collection("users")
      .doc(uid)
      .collection("destinations")
      .where("platform", "==", nextPlatform)
      .get();

    for (const doc of existingSnap.docs) {
      if (doc.id === id) continue;
      const data = doc.data() as any;
      const existingName = normalizeName(data?.name);
      if (nextNameNorm && nextNameNorm === existingName) {
        return res.status(409).json({ error: "duplicate_name" as ApiErrorCode });
      }
      if (nextPlainKey) {
        const existingDec = data?.streamKeyEnc ? decryptStreamKey(data.streamKeyEnc) : null;
        const existingNorm = normalizeStreamKeyInput(existingDec);
        if (existingNorm && existingNorm === nextPlainKey) {
          return res.status(409).json({ error: "duplicate_stream_key" as ApiErrorCode });
        }
      }
    }

    // Enforce plan limit if toggling enabled from false to true
    const enabledCount = await getEnabledCount(uid);
    const currentEnabled = !!current.enabled;
    const nextEnabled = typeof updates.enabled === "boolean" ? !!updates.enabled : currentEnabled;
    if (!currentEnabled && nextEnabled && planLimit !== undefined && planLimit > 0 && enabledCount >= planLimit) {
      return res.status(409).json({ error: LIMIT_ERRORS.LIMIT_EXCEEDED });
    }

    const docData: any = {
      platform: nextPlatform,
      targetId: current.targetId || current.id || snap.id,
      rtmpUrlBase: nextBase,
      name: typeof updates.name === "string" ? String(updates.name) : (current.name || null),
      enabled: typeof updates.enabled === "boolean" ? !!updates.enabled : !!current.enabled,
      mode: nextMode,
      persistent: nextPersistent,
      oauthRef: typeof updates.oauthRef === "string" ? updates.oauthRef : (current.oauthRef || null),
      streamKeyEnc: nextEnc,
      updatedAt: Date.now(),
    };
    await ref.set(docData, { merge: true });
    const updatedSnap = await ref.get();
    const destination = toItem(updatedSnap);
    const usedCount = await getEnabledCount(uid);
    return res.json({ ok: true, destination, usedCount, limit: planLimit });
  } catch (err: any) {
    console.error("PUT /api/destinations/:id error:", err);
    return res.status(500).json({ error: "server_error" as ApiErrorCode, details: err?.message || String(err) });
  }
});

// DELETE /api/destinations/:id
router.delete("/:id", requireAuth, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    if (!assertPlatformTranscodeEnabled(res)) return;

    const planLimit = await getPlanLimit(uid);
    if (!planLimit || planLimit < 1) {
      return res.status(403).json({ error: LIMIT_ERRORS.FEATURE_NOT_ENTITLED });
    }
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
