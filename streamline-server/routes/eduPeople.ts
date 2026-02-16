import express from "express";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { writeEduAudit } from "../lib/eduAudit";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";

const router = express.Router();

type EduOrgRole = "faculty_admin" | "student_producer" | "student_producer_assigned" | "talent" | "viewer";

function asString(v: any): string {
  return typeof v === "string" ? v : "";
}

function coerceEmail(value: any): string | null {
  const email = asString(value).trim().toLowerCase();
  if (!email) return null;
  // Intentionally simple email check (demo + governance; backend can tighten later)
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return email;
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

function coerceMillis(value: any): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Date.parse(value);
    if (Number.isFinite(n)) return n;
  }
  if (value && typeof value === "object" && typeof value.toDate === "function") {
    try {
      const d = value.toDate();
      const n = d instanceof Date ? d.getTime() : NaN;
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function getOrgContext(uid: string): Promise<{ orgId: string; orgRole: EduOrgRole | null } | null> {
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

  return { orgId, orgRole };
}

function assertRole(orgRole: EduOrgRole | null, allow: EduOrgRole[]): boolean {
  if (!orgRole) return false;
  return allow.includes(orgRole);
}

function normalizeMemberDoc(docId: string, data: any) {
  const role = coerceRole(data?.role) || "viewer";
  const statusRaw = asString(data?.status).trim();
  const status = statusRaw === "invited" || statusRaw === "disabled" || statusRaw === "active" ? statusRaw : "active";
  const lastActiveAt = coerceMillis(data?.lastActiveAt);
  const assignedEventIds = Array.isArray(data?.assignedEventIds)
    ? data.assignedEventIds.map((x: any) => asString(x).trim()).filter(Boolean)
    : [];

  return {
    id: docId,
    name: typeof data?.name === "string" ? data.name : typeof data?.displayName === "string" ? data.displayName : "",
    email: typeof data?.email === "string" ? data.email : typeof data?.invitedEmail === "string" ? data.invitedEmail : "",
    role,
    status,
    lastActiveAt: lastActiveAt ? new Date(lastActiveAt).toISOString() : null,
    assignedEventsCount: assignedEventIds.length,
    assignedEventIds,
  };
}

function isInviteDocId(id: string): boolean {
  return id.includes("_inv_");
}

function statusRank(status: string): number {
  if (status === "active") return 3;
  if (status === "invited") return 2;
  if (status === "disabled") return 1;
  return 0;
}

function pickPreferredPerson(a: any, b: any): any {
  // Prefer higher status, then prefer a real member doc over an invite stub.
  const ar = statusRank(String(a?.status || ""));
  const br = statusRank(String(b?.status || ""));
  if (ar !== br) return ar > br ? a : b;

  const aInvite = isInviteDocId(String(a?.id || ""));
  const bInvite = isInviteDocId(String(b?.id || ""));
  if (aInvite !== bInvite) return aInvite ? b : a;

  return a;
}

function dedupePeopleByEmail(people: any[]): any[] {
  const byEmail = new Map<string, any>();
  const noEmail: any[] = [];

  for (const p of people) {
    const email = asString(p?.email).trim().toLowerCase();
    if (!email) {
      noEmail.push(p);
      continue;
    }
    const existing = byEmail.get(email);
    if (!existing) {
      byEmail.set(email, p);
      continue;
    }
    byEmail.set(email, pickPreferredPerson(existing, p));
  }

  return [...byEmail.values(), ...noEmail];
}

// List org members (Faculty Admin + Student Producer)
router.get("/people", requireAuth, async (req, res) => {
  try {
    const uid = String((req as any).user?.uid || "").trim();
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "org_required" });

    if (!assertRole(ctx.orgRole, ["faculty_admin", "student_producer", "student_producer_assigned"])) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 200;

    let docs: any[] = [];
    try {
      const snap = await db.collection("orgMembers").where("orgId", "==", ctx.orgId).limit(limit).get();
      docs = snap.docs;
    } catch {
      docs = [];
    }

    // Fallback for legacy datasets missing orgId on orgMembers docs.
    if (!docs.length) {
      const snap = await db.collection("orgMembers").limit(limit).get();
      const prefix = `${ctx.orgId}_`;
      docs = snap.docs.filter((d) => String(d.id || "").startsWith(prefix));
    }

    const rawPeople = docs.map((d) => normalizeMemberDoc(d.id, d.data() || {}));
    const people = dedupePeopleByEmail(rawPeople);
    return res.json({ people });
  } catch (err: any) {
    console.error("GET /api/edu/people error", err);
    return res.status(500).json({ error: "internal" });
  }
});

// Invite (Faculty Admin)
router.post("/people/invite", requireAuth, async (req, res) => {
  try {
    const uid = String((req as any).user?.uid || "").trim();
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "org_required" });
    if (!assertRole(ctx.orgRole, ["faculty_admin"])) return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });

    const email = coerceEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: "email_invalid" });

    const role = coerceRole(req.body?.role);
    if (!role || role === "faculty_admin") {
      // For now keep invites from minting additional faculty admins via demo UI.
      return res.status(400).json({ error: "role_invalid" });
    }

    // Avoid duplicate rows for the same person (common source of count mismatch).
    // If the user is already a member: block. If an invite already exists: treat as resend.
    try {
      const existingSnap = await db
        .collection("orgMembers")
        .where("orgId", "==", ctx.orgId)
        .where("email", "==", email)
        .limit(5)
        .get();

      const existingDocs = existingSnap.docs || [];
      if (existingDocs.length) {
        const preferred = existingDocs
          .map((d) => normalizeMemberDoc(d.id, d.data() || {}))
          .reduce((acc, cur) => (acc ? pickPreferredPerson(acc, cur) : cur), null as any);

        const preferredStatus = asString(preferred?.status).trim();
        if (preferredStatus === "active") {
          return res.status(409).json({ error: "already_member" });
        }
        if (preferredStatus === "invited") {
          const now = Date.now();
          const docRef = db.collection("orgMembers").doc(String(preferred.id));
          const prev = typeof (existingDocs[0].data() as any)?.inviteResendCount === "number" ? (existingDocs[0].data() as any).inviteResendCount : 0;
          await docRef.set({ invitedAt: now, inviteResendCount: prev + 1, updatedAt: now }, { merge: true });
          const after = (await docRef.get()).data() || {};
          return res.json({ ok: true, person: normalizeMemberDoc(String(preferred.id), after) });
        }
      }
    } catch {
      // If we can't check for duplicates, proceed with best-effort invite creation.
    }

    const assignEventId = asString(req.body?.assignEventId).trim();
    const now = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const memberId = `${ctx.orgId}_inv_${now}_${rand}`;

    const doc = {
      orgId: ctx.orgId,
      email,
      role,
      status: "invited",
      invitedAt: now,
      invitedByUid: uid,
      assignedEventIds: assignEventId ? [assignEventId] : [],
      createdAt: now,
      updatedAt: now,
    };

    await db.collection("orgMembers").doc(memberId).set(doc, { merge: true });

    await writeEduAudit({
      orgId: ctx.orgId,
      action: "org.member_invited",
      actorUid: uid,
      actorName: "Faculty Admin",
      targetId: memberId,
    }).catch(() => void 0);

    return res.json({ ok: true, person: normalizeMemberDoc(memberId, doc) });
  } catch (err: any) {
    console.error("POST /api/edu/people/invite error", err);
    return res.status(500).json({ error: "internal" });
  }
});

// Edit role (Faculty Admin)
router.patch("/people/:memberId/role", requireAuth, async (req, res) => {
  try {
    const uid = String((req as any).user?.uid || "").trim();
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "org_required" });
    if (!assertRole(ctx.orgRole, ["faculty_admin"])) return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });

    const memberId = asString(req.params.memberId).trim();
    if (!memberId) return res.status(400).json({ error: "memberId_required" });

    const nextRole = coerceRole(req.body?.role);
    if (!nextRole) return res.status(400).json({ error: "role_invalid" });

    const docRef = db.collection("orgMembers").doc(memberId);
    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).json({ error: "not_found" });
    const existing = snap.data() || {};
    const existingOrgId = typeof (existing as any).orgId === "string" ? String((existing as any).orgId) : "";
    if (existingOrgId && existingOrgId !== ctx.orgId) return res.status(404).json({ error: "not_found" });
    if (!existingOrgId && !memberId.startsWith(`${ctx.orgId}_`)) return res.status(404).json({ error: "not_found" });

    await docRef.set({ role: nextRole, updatedAt: Date.now() }, { merge: true });

    await writeEduAudit({
      orgId: ctx.orgId,
      action: "org.member_role_updated",
      actorUid: uid,
      actorName: "Faculty Admin",
      targetId: memberId,
    }).catch(() => void 0);

    const after = (await docRef.get()).data() || {};
    return res.json({ ok: true, person: normalizeMemberDoc(memberId, after) });
  } catch (err: any) {
    console.error("PATCH /api/edu/people/:memberId/role error", err);
    return res.status(500).json({ error: "internal" });
  }
});

// Disable access (Faculty Admin)
router.post("/people/:memberId/disable", requireAuth, async (req, res) => {
  try {
    const uid = String((req as any).user?.uid || "").trim();
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "org_required" });
    if (!assertRole(ctx.orgRole, ["faculty_admin"])) return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });

    const memberId = asString(req.params.memberId).trim();
    if (!memberId) return res.status(400).json({ error: "memberId_required" });

    const docRef = db.collection("orgMembers").doc(memberId);
    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).json({ error: "not_found" });
    const existing = snap.data() || {};
    const existingOrgId = typeof (existing as any).orgId === "string" ? String((existing as any).orgId) : "";
    if (existingOrgId && existingOrgId !== ctx.orgId) return res.status(404).json({ error: "not_found" });
    if (!existingOrgId && !memberId.startsWith(`${ctx.orgId}_`)) return res.status(404).json({ error: "not_found" });

    await docRef.set({ status: "disabled", disabledAt: Date.now(), updatedAt: Date.now() }, { merge: true });

    await writeEduAudit({
      orgId: ctx.orgId,
      action: "org.member_disabled",
      actorUid: uid,
      actorName: "Faculty Admin",
      targetId: memberId,
    }).catch(() => void 0);

    const after = (await docRef.get()).data() || {};
    return res.json({ ok: true, person: normalizeMemberDoc(memberId, after) });
  } catch (err: any) {
    console.error("POST /api/edu/people/:memberId/disable error", err);
    return res.status(500).json({ error: "internal" });
  }
});

// Resend invite (Faculty Admin)
router.post("/people/:memberId/resend", requireAuth, async (req, res) => {
  try {
    const uid = String((req as any).user?.uid || "").trim();
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "org_required" });
    if (!assertRole(ctx.orgRole, ["faculty_admin"])) return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });

    const memberId = asString(req.params.memberId).trim();
    if (!memberId) return res.status(400).json({ error: "memberId_required" });

    const docRef = db.collection("orgMembers").doc(memberId);
    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).json({ error: "not_found" });
    const existing = snap.data() || {};
    const existingOrgId = typeof (existing as any).orgId === "string" ? String((existing as any).orgId) : "";
    if (existingOrgId && existingOrgId !== ctx.orgId) return res.status(404).json({ error: "not_found" });
    if (!existingOrgId && !memberId.startsWith(`${ctx.orgId}_`)) return res.status(404).json({ error: "not_found" });

    const status = asString((existing as any).status).trim();
    if (status !== "invited") return res.status(400).json({ error: "not_invited" });

    const now = Date.now();
    const prev = typeof (existing as any).inviteResendCount === "number" ? (existing as any).inviteResendCount : 0;
    await docRef.set({ invitedAt: now, inviteResendCount: prev + 1, updatedAt: now }, { merge: true });

    await writeEduAudit({
      orgId: ctx.orgId,
      action: "org.member_invite_resent",
      actorUid: uid,
      actorName: "Faculty Admin",
      targetId: memberId,
    }).catch(() => void 0);

    const after = (await docRef.get()).data() || {};
    return res.json({ ok: true, person: normalizeMemberDoc(memberId, after) });
  } catch (err: any) {
    console.error("POST /api/edu/people/:memberId/resend error", err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
