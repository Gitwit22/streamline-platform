import express from "express";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";

const router = express.Router();

type EduOrgRole = "faculty_admin" | "student_producer" | "student_producer_assigned" | "talent" | "viewer";

type OrgDoc = {
  name: string;
  branding?: {
    logoDataUrl?: string | null;
    accentColor?: string | null;
    playerTitleText?: string | null;
  };
  defaults?: {
    publishToWebsite?: boolean;
    recordToArchive?: boolean;
    defaultLayout?: "grid" | "speaker";
    studentProducersCanStart?: boolean;
    requireAssignmentToStart?: boolean;
  };
  accessPolicy?: {
    embedVisibility?: "public" | "unlisted";
  };
  retentionDays?: number | null;
  updatedAt?: any;
  createdAt?: any;
};

type AuditDoc = {
  orgId: string;
  action: string;
  actorUid: string;
  actorName: string;
  eventId?: string | null;
  eventTitle?: string | null;
  targetId?: string | null;
  createdAt: any;
};

function asString(v: any): string {
  return typeof v === "string" ? v : "";
}

function coerceRole(value: any): EduOrgRole | null {
  const r = asString(value).trim();
  if (r === "faculty_admin") return "faculty_admin";
  if (r === "student_producer") return "student_producer";
  if (r === "student_producer_assigned") return "student_producer_assigned";
  if (r === "talent") return "talent";
  if (r === "viewer") return "viewer";
  return null;
}

async function getOrgContext(uid: string): Promise<{ orgId: string; orgRole: EduOrgRole | null; orgName: string | null; userName: string | null } | null> {
  const userSnap = await db.collection("users").doc(uid).get().catch(() => null as any);
  const user = userSnap && userSnap.exists ? (userSnap.data() as any) : null;
  if (!user) return null;

  const rawOrgId = user?.orgId ?? user?.org?.id ?? user?.org?.orgId;
  const orgId = typeof rawOrgId === "string" && rawOrgId.trim() ? rawOrgId.trim() : "";
  if (!orgId) return null;

  const memberId = `${orgId}_${uid}`;
  const memberSnap = await db.collection("orgMembers").doc(memberId).get().catch(() => null as any);
  const member = memberSnap && memberSnap.exists ? (memberSnap.data() as any) : null;
  const orgRole = coerceRole(member?.role);

  const orgName = typeof user?.orgName === "string" ? user.orgName : typeof user?.org?.name === "string" ? user.org.name : null;
  const userName = typeof user?.name === "string" ? user.name : typeof user?.displayName === "string" ? user.displayName : typeof user?.email === "string" ? user.email : null;

  return { orgId, orgRole, orgName, userName };
}

function assertRole(orgRole: EduOrgRole | null, allow: EduOrgRole[]): boolean {
  if (!orgRole) return false;
  return allow.includes(orgRole);
}

function coerceBoolean(v: any, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  return fallback;
}

function coerceLayout(v: any): "grid" | "speaker" {
  const raw = asString(v).trim();
  return raw === "speaker" ? "speaker" : "grid";
}

function coerceEmbedVisibility(v: any): "public" | "unlisted" {
  const raw = asString(v).trim();
  return raw === "unlisted" ? "unlisted" : "public";
}

function coerceRetentionDays(v: any): number | null {
  if (v === null) return null;
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return 30;
  if (n === -1 || n === 0) return null;
  const days = Math.floor(n);
  if (days <= 0) return 30;
  if (days === 30 || days === 90 || days === 365) return days;
  // clamp to a reasonable MVP set
  if (days < 60) return 30;
  if (days < 200) return 90;
  return 365;
}

function normalizeOrgDoc(docId: string, data: any): any {
  const d = (data || {}) as OrgDoc;

  return {
    id: docId,
    name: typeof d.name === "string" ? d.name : "",
    branding: {
      logoDataUrl: typeof d.branding?.logoDataUrl === "string" ? d.branding?.logoDataUrl : null,
      accentColor: typeof d.branding?.accentColor === "string" ? d.branding?.accentColor : null,
      playerTitleText: typeof d.branding?.playerTitleText === "string" ? d.branding?.playerTitleText : null,
    },
    defaults: {
      publishToWebsite: coerceBoolean(d.defaults?.publishToWebsite, true),
      recordToArchive: coerceBoolean(d.defaults?.recordToArchive, true),
      defaultLayout: d.defaults?.defaultLayout === "speaker" ? "speaker" : "grid",
      studentProducersCanStart: coerceBoolean(d.defaults?.studentProducersCanStart, false),
      requireAssignmentToStart: coerceBoolean(d.defaults?.requireAssignmentToStart, true),
    },
    accessPolicy: {
      embedVisibility: d.accessPolicy?.embedVisibility === "unlisted" ? "unlisted" : "public",
      restrictedToSchoolLogin: "coming_soon",
    },
    retentionDays: typeof d.retentionDays === "number" || d.retentionDays === null ? d.retentionDays : 30,
  };
}

async function writeAudit(params: {
  orgId: string;
  action: string;
  actorUid: string;
  actorName: string;
  eventId?: string | null;
  eventTitle?: string | null;
  targetId?: string | null;
}) {
  const now = Date.now();
  const auditDoc: AuditDoc = {
    orgId: params.orgId,
    action: params.action,
    actorUid: params.actorUid,
    actorName: params.actorName,
    eventId: params.eventId ?? null,
    eventTitle: params.eventTitle ?? null,
    targetId: params.targetId ?? null,
    createdAt: now,
  };
  const id = `${params.orgId}_${now}_${Math.random().toString(36).slice(2, 8)}`;
  await db.collection("audit").doc(id).set(auditDoc, { merge: true });
}

// GET /api/edu/org
router.get("/org", requireAuth, async (req, res) => {
  try {
    const uid = String((req as any).user?.uid || "").trim();
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "org_required" });
    // Read-only: allow broadcast-capable roles to load defaults/branding.
    if (!assertRole(ctx.orgRole, ["faculty_admin", "student_producer", "student_producer_assigned"])) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const orgRef = db.collection("orgs").doc(ctx.orgId);
    const snap = await orgRef.get();

    if (!snap.exists) {
      const created: OrgDoc = {
        name: ctx.orgName || "Your School",
        branding: {
          logoDataUrl: null,
          accentColor: null,
          playerTitleText: null,
        },
        defaults: {
          publishToWebsite: true,
          recordToArchive: true,
          defaultLayout: "grid",
          studentProducersCanStart: false,
          requireAssignmentToStart: true,
        },
        accessPolicy: {
          embedVisibility: "public",
        },
        retentionDays: 30,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await orgRef.set(created, { merge: true });
      return res.json({ ok: true, org: normalizeOrgDoc(ctx.orgId, created) });
    }

    return res.json({ ok: true, org: normalizeOrgDoc(snap.id, snap.data() || {}) });
  } catch (err: any) {
    console.error("GET /api/edu/org error", err);
    return res.status(500).json({ error: "internal" });
  }
});

// PATCH /api/edu/org
router.patch("/org", requireAuth, async (req, res) => {
  try {
    const uid = String((req as any).user?.uid || "").trim();
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "org_required" });
    if (!assertRole(ctx.orgRole, ["faculty_admin"])) return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });

    const patch = req.body || {};

    const next: Partial<OrgDoc> = {
      name: typeof patch?.name === "string" && patch.name.trim() ? patch.name.trim() : undefined,
      branding: {
        logoDataUrl:
          typeof patch?.branding?.logoDataUrl === "string" ? String(patch.branding.logoDataUrl) : null,
        accentColor:
          typeof patch?.branding?.accentColor === "string" && String(patch.branding.accentColor).trim()
            ? String(patch.branding.accentColor).trim()
            : null,
        playerTitleText:
          typeof patch?.branding?.playerTitleText === "string" && String(patch.branding.playerTitleText).trim()
            ? String(patch.branding.playerTitleText).trim()
            : null,
      },
      defaults: {
        publishToWebsite: coerceBoolean(patch?.defaults?.publishToWebsite, true),
        recordToArchive: coerceBoolean(patch?.defaults?.recordToArchive, true),
        defaultLayout: coerceLayout(patch?.defaults?.defaultLayout),
        studentProducersCanStart: coerceBoolean(patch?.defaults?.studentProducersCanStart, false),
        requireAssignmentToStart: coerceBoolean(patch?.defaults?.requireAssignmentToStart, true),
      },
      accessPolicy: {
        embedVisibility: coerceEmbedVisibility(patch?.accessPolicy?.embedVisibility),
      },
      retentionDays: coerceRetentionDays(patch?.retentionDays),
      updatedAt: Date.now(),
    };

    const orgRef = db.collection("orgs").doc(ctx.orgId);
    await orgRef.set(next, { merge: true });

    await writeAudit({
      orgId: ctx.orgId,
      action: "org.settings_updated",
      actorUid: uid,
      actorName: ctx.userName || "User",
      targetId: ctx.orgId,
    });

    const after = await orgRef.get();
    return res.json({ ok: true, org: normalizeOrgDoc(ctx.orgId, after.data() || {}) });
  } catch (err: any) {
    console.error("PATCH /api/edu/org error", err);
    return res.status(500).json({ error: "internal" });
  }
});

// GET /api/edu/storage-summary
router.get("/storage-summary", requireAuth, async (req, res) => {
  try {
    const uid = String((req as any).user?.uid || "").trim();
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "org_required" });
    if (!assertRole(ctx.orgRole, ["faculty_admin"])) return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });

    let docs: any[] = [];
    try {
      const snap = await db.collection("recordings").where("orgId", "==", ctx.orgId).limit(500).get();
      docs = snap.docs;
    } catch {
      docs = [];
    }

    let bytes = 0;
    let count = 0;
    for (const d of docs) {
      const data = d.data() || {};
      const status = String(data.status || "").toLowerCase();
      if (status === "deleted" || status === "deleting") continue;
      count += 1;
      const sizeRaw = data.fileSize ?? data.fileSizeBytes ?? data.sizeBytes ?? null;
      const n = typeof sizeRaw === "number" ? sizeRaw : typeof sizeRaw === "string" ? Number(sizeRaw) : NaN;
      if (Number.isFinite(n) && n > 0) bytes += n;
    }

    return res.json({ ok: true, recordingsCount: count, storageBytes: bytes, updatedAt: Date.now() });
  } catch (err: any) {
    console.error("GET /api/edu/storage-summary error", err);
    return res.status(500).json({ error: "internal" });
  }
});

// GET /api/edu/audit
router.get("/audit", requireAuth, async (req, res) => {
  try {
    const uid = String((req as any).user?.uid || "").trim();
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "org_required" });
    if (!assertRole(ctx.orgRole, ["faculty_admin"])) return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });

    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.floor(limitRaw))) : 10;

    let docs: any[] = [];
    try {
      const snap = await db
        .collection("audit")
        .where("orgId", "==", ctx.orgId)
        .orderBy("createdAt", "desc")
        .limit(limit)
        .get();
      docs = snap.docs;
    } catch {
      // Index-free fallback: read a small window and filter.
      const snap = await db.collection("audit").orderBy("createdAt", "desc").limit(50).get().catch(() => null as any);
      docs = snap?.docs ? snap.docs.filter((d: any) => String((d.data() || {}).orgId || "") === ctx.orgId).slice(0, limit) : [];
    }

    const actions = docs.map((d) => {
      const data = d.data() || {};
      return {
        id: d.id,
        action: asString(data.action) || "",
        actorUid: asString(data.actorUid) || "",
        actorName: asString(data.actorName) || "",
        eventId: typeof data.eventId === "string" ? data.eventId : null,
        eventTitle: typeof data.eventTitle === "string" ? data.eventTitle : null,
        targetId: typeof data.targetId === "string" ? data.targetId : null,
        createdAt: typeof data.createdAt === "number" ? data.createdAt : null,
      };
    });

    return res.json({ ok: true, actions });
  } catch (err: any) {
    console.error("GET /api/edu/audit error", err);
    return res.status(500).json({ error: "internal" });
  }
});

// POST /api/edu/audit
router.post("/audit", requireAuth, async (req, res) => {
  try {
    const uid = String((req as any).user?.uid || "").trim();
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "org_required" });
    // Broadcast start/stop can be done by approved Student Producers.
    if (!assertRole(ctx.orgRole, ["faculty_admin", "student_producer", "student_producer_assigned"])) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const action = asString(req.body?.action).trim();
    if (!action) return res.status(400).json({ error: "action_required" });

    const eventId = asString(req.body?.eventId).trim() || null;
    const eventTitle = asString(req.body?.eventTitle).trim() || null;
    const targetId = asString(req.body?.targetId).trim() || null;

    await writeAudit({
      orgId: ctx.orgId,
      action,
      actorUid: uid,
      actorName: ctx.userName || "User",
      eventId,
      eventTitle,
      targetId,
    });

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("POST /api/edu/audit error", err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
