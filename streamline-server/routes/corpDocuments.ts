import express from "express";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { getCorpOrgContext, assertCorpRole, asString, coerceMillis } from "../lib/corpOrg";
import { writeCorpAudit } from "../lib/corpAudit";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";

const router = express.Router();

function normalizeDocument(docId: string, data: any) {
  return {
    id: docId,
    title: asString(data?.title),
    category: asString(data?.category),
    version: asString(data?.version || "1.0"),
    description: asString(data?.description),
    fileUrl: asString(data?.fileUrl),
    fileSize: typeof data?.fileSize === "number" ? data.fileSize : 0,
    mimeType: asString(data?.mimeType),
    requiresAcknowledgment: !!data?.requiresAcknowledgment,
    totalAcknowledged: typeof data?.totalAcknowledged === "number" ? data.totalAcknowledged : 0,
    totalRequired: typeof data?.totalRequired === "number" ? data.totalRequired : 0,
    updatedAt: coerceMillis(data?.updatedAt),
    createdAt: coerceMillis(data?.createdAt),
    createdBy: asString(data?.createdBy),
  };
}

/**
 * GET /documents — list org documents
 * Query: ?category=HR+Policies&limit=50
 */
router.get("/documents", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });

    const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 50, 1), 200);

    const snap = await db.collection("corpDocuments")
      .where("orgId", "==", ctx.orgId)
      .orderBy("updatedAt", "desc")
      .limit(limit)
      .get();

    let docs = snap.docs.map(d => normalizeDocument(d.id, d.data()));

    const category = asString(req.query.category as string).trim();
    if (category) {
      docs = docs.filter(d => d.category === category);
    }

    return res.json({ documents: docs });
  } catch (err: any) {
    console.error("[corp/documents] list error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/**
 * POST /documents — create a document record (admin/manager)
 */
router.post("/documents", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });
    if (!assertCorpRole(ctx.orgRole, ["admin", "manager"])) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const title = asString(req.body.title).trim();
    if (!title) return res.status(400).json({ error: "title_required" });

    const now = Date.now();
    const docId = `${ctx.orgId}_doc_${now}_${Math.random().toString(36).slice(2, 8)}`;

    const doc = {
      orgId: ctx.orgId,
      title,
      category: asString(req.body.category).trim(),
      version: asString(req.body.version || "1.0").trim(),
      description: asString(req.body.description).trim(),
      fileUrl: asString(req.body.fileUrl).trim(),
      fileSize: typeof req.body.fileSize === "number" ? req.body.fileSize : 0,
      mimeType: asString(req.body.mimeType).trim(),
      requiresAcknowledgment: !!req.body.requiresAcknowledgment,
      totalAcknowledged: 0,
      totalRequired: 0,
      updatedAt: now,
      createdAt: now,
      createdBy: uid,
    };

    await db.collection("corpDocuments").doc(docId).set(doc, { merge: true });

    await writeCorpAudit({
      orgId: ctx.orgId,
      action: "document.create",
      actorUid: uid,
      actorName: asString((req as any).account?.displayName || ""),
      targetId: docId,
      meta: { title, category: doc.category },
    });

    return res.json({ document: normalizeDocument(docId, doc) });
  } catch (err: any) {
    console.error("[corp/documents] create error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/**
 * DELETE /documents/:id — delete a document (admin only)
 */
router.delete("/documents/:id", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });
    if (!assertCorpRole(ctx.orgRole, ["admin"])) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const docId = req.params.id;
    const snap = await db.collection("corpDocuments").doc(docId).get();
    if (!snap.exists) return res.status(404).json({ error: "not_found" });

    const existing = snap.data() as any;
    if (existing.orgId !== ctx.orgId) return res.status(403).json({ error: "wrong_org" });

    await db.collection("corpDocuments").doc(docId).delete();

    await writeCorpAudit({
      orgId: ctx.orgId,
      action: "document.delete",
      actorUid: uid,
      actorName: asString((req as any).account?.displayName || ""),
      targetId: docId,
    });

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[corp/documents] delete error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/**
 * POST /documents/:id/acknowledge — acknowledge a document
 */
router.post("/documents/:id/acknowledge", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });

    const docId = req.params.id;
    const snap = await db.collection("corpDocuments").doc(docId).get();
    if (!snap.exists) return res.status(404).json({ error: "not_found" });

    const existing = snap.data() as any;
    if (existing.orgId !== ctx.orgId) return res.status(403).json({ error: "wrong_org" });

    const ackId = `${docId}_${uid}`;
    const now = Date.now();

    await db.collection("corpDocumentAcks").doc(ackId).set({
      orgId: ctx.orgId,
      documentId: docId,
      uid,
      acknowledgedAt: now,
    }, { merge: true });

    // Increment the acknowledged counter
    const ackSnap = await db.collection("corpDocumentAcks")
      .where("documentId", "==", docId)
      .get();
    const totalAcknowledged = ackSnap.size;

    await db.collection("corpDocuments").doc(docId).set({
      totalAcknowledged,
      updatedAt: now,
    }, { merge: true });

    return res.json({ ok: true, totalAcknowledged });
  } catch (err: any) {
    console.error("[corp/documents] acknowledge error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
