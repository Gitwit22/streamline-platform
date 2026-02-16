import express from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { loadEduOrgSettingsForUid, isEduOrgType } from "../lib/eduOrgContext";
import { writeEduAudit } from "../lib/eduAudit";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";

const router = express.Router();

type AccessMode = "public" | "unlisted" | "password";

function asString(v: any): string {
  return typeof v === "string" ? v : "";
}

function coerceAccessMode(v: any): AccessMode {
  const raw = asString(v).trim();
  if (raw === "unlisted") return "unlisted";
  if (raw === "password") return "password";
  return "public";
}

function randomToken(lenBytes: number = 32): string {
  // url-safe token (no padding)
  return crypto.randomBytes(Math.max(16, Math.min(64, lenBytes))).toString("base64url");
}

function embedIdForEvent(eventId: string): string {
  const id = String(eventId || "").trim();
  // Deterministic embedId (stable URLs); access is enforced via token/password.
  return `edu_event_${id}`;
}

// POST /api/edu/embeds/event
// Creates or updates a secure embed doc for an EDU event.
router.post("/embeds/event", requireAuth, async (req, res) => {
  try {
    const uid = asString((req as any).user?.uid).trim();
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const eduCtx = await loadEduOrgSettingsForUid(uid).catch(() => null);

    const eventId = asString(req.body?.eventId).trim();
    if (!eventId) return res.status(400).json({ error: "eventId_required" });

    const accessMode = coerceAccessMode(req.body?.accessMode);
    const password = asString(req.body?.password);

    // Basic authorization: user must own the event.
    const evRef = db.collection("events").doc(eventId);
    const evSnap = await evRef.get();
    if (!evSnap.exists) return res.status(404).json({ error: "event_not_found" });
    const ev = evSnap.data() || {};
    const ownerUid = asString((ev as any).ownerUid).trim();
    if (ownerUid && ownerUid !== uid) return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });

    // EDU org enforcement: if org policy says embeds are unlisted,
    // do not allow public embeds (password embeds are allowed).
    if (eduCtx?.org && isEduOrgType(eduCtx.org.orgType)) {
      const policy = eduCtx.org.accessPolicy?.embedVisibility;
      if (policy === "unlisted" && accessMode === "public") {
        return res.status(403).json({ error: "embed_public_disabled_by_org_policy" });
      }
    }

    const embedId = embedIdForEvent(eventId);
    const embedRef = db.collection("embeds").doc(embedId);

    const existedBefore = (await embedRef.get()).exists;

    const now = new Date();
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(embedRef);
      const existing = snap.exists ? (snap.data() as any) : null;

      const token = asString(existing?.token).trim() || randomToken(32);

      const next: Record<string, any> = {
        id: embedId,
        embedId,
        eventId,
        accessMode,
        token,
        updatedAt: now,
      };
      if (!existing) {
        next.createdAt = now;
        next.createdByUid = uid;
      }

      if (accessMode === "password" && password.trim()) {
        next.passwordHash = await bcrypt.hash(password, 10);
        next.passwordUpdatedAt = now;
      }

      tx.set(embedRef, next, { merge: true });
    });

    const finalSnap = await embedRef.get();
    const finalDoc = finalSnap.data() || {};

    if (eduCtx?.orgId && eduCtx?.org && isEduOrgType(eduCtx.org.orgType)) {
      await writeEduAudit({
        orgId: eduCtx.orgId,
        action: existedBefore ? "embed.updated" : "embed.created",
        actorUid: uid,
        actorName: eduCtx.userName || "User",
        eventId,
        eventTitle: typeof (ev as any).title === "string" ? String((ev as any).title) : null,
        targetId: embedId,
      }).catch(() => void 0);
    }

    return res.json({
      embed: {
        embedId,
        eventId,
        accessMode: coerceAccessMode(finalDoc.accessMode),
        token: asString(finalDoc.token).trim(),
        hasPassword: typeof finalDoc.passwordHash === "string" && !!finalDoc.passwordHash,
      },
    });
  } catch (err: any) {
    console.error("POST /api/edu/embeds/event error", err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
