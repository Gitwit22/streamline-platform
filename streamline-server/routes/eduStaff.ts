/**
 * eduStaff — Admin staff management (create pending staff, list, regenerate codes, update status).
 *
 * Routes (mounted at /api/edu):
 *   GET    /staff                       → list pending/active staff for the org
 *   POST   /staff                       → create a new pending staff record with onboarding code
 *   POST   /staff/:id/regenerate-code   → regenerate an onboarding code for a pending staff member
 *   PATCH  /staff/:id/status            → toggle active/inactive
 */

import express from "express";
import crypto from "crypto";
import { requireAuth } from "../middleware/requireAuth";
import { writeEduAudit } from "../lib/eduAudit";
import { tenantCol, globalCol } from "../lib/dbPaths";

const router = express.Router();

/* ── Types ─────────────────────────────────────────────────────── */

type EduOrgRole = "faculty_admin" | "faculty_teacher" | "staff";

/* ── Helpers ───────────────────────────────────────────────────── */

function asString(v: any): string {
  return typeof v === "string" ? v : "";
}

function coerceStaffRole(v: any): EduOrgRole | null {
  const r = asString(v).trim();
  if (r === "faculty_admin") return "faculty_admin";
  if (r === "faculty_teacher") return "faculty_teacher";
  if (r === "staff") return "faculty_teacher"; // map legacy "staff" → "faculty_teacher"
  return null;
}

/** Generate a 6-character uppercase alphanumeric onboarding code. */
function generateOnboardingCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // excluding 0/O/1/I for clarity
  let code = "";
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

/** Resolve orgId + orgRole from the authenticated user's uid. */
async function getOrgContext(uid: string): Promise<{ orgId: string; orgRole: string } | null> {
  // 1) Try user doc first
  const userSnap = await globalCol("users").doc(uid).get().catch(() => null as any);
  const user = userSnap && userSnap.exists ? (userSnap.data() as any) : null;
  if (!user) return null;

  const rawOrgId = user?.orgId ?? user?.org?.id ?? user?.org?.orgId;
  const orgId = typeof rawOrgId === "string" && rawOrgId.trim() ? rawOrgId.trim() : "";
  if (!orgId) return null;

  // 2) Fall back to orgMembers for the role
  const memberId = `${orgId}_${uid}`;
  const memberSnap = await tenantCol("orgMembers").doc(memberId).get().catch(() => null as any);
  const member = memberSnap && memberSnap.exists ? (memberSnap.data() as any) : null;
  const orgRole = asString(member?.role || user?.orgRole).trim() || "faculty_teacher";

  return { orgId, orgRole };
}

/** Normalize a pendingStaff doc into the shape expected by the client. */
function normalizeStaffDoc(docId: string, data: any) {
  return {
    id: docId,
    orgId: asString(data?.orgId),
    fullName: asString(data?.fullName),
    role: coerceStaffRole(data?.role) || "faculty_teacher",
    positionTitle: asString(data?.positionTitle),
    email: typeof data?.email === "string" ? data.email : null,
    onboardingCode: asString(data?.onboardingCode),
    status: asString(data?.status) || "pending",
    createdBy: asString(data?.createdBy),
    createdAt: typeof data?.createdAt === "number" ? data.createdAt : 0,
    usedAt: typeof data?.usedAt === "number" ? data.usedAt : null,
  };
}

/* ── GET /staff — list all pending/active staff for the org ────── */

router.get("/staff", requireAuth, async (req, res) => {
  try {
    const uid = String((req as any).user?.uid || "").trim();
    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "no_org" });

    const snap = await tenantCol("pendingStaff")
      .where("orgId", "==", ctx.orgId)
      .get();

    const staff = snap.docs.map((d) => normalizeStaffDoc(d.id, d.data()));
    // Sort in-memory (avoids composite index requirement)
    staff.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return res.json({ staff });
  } catch (err: any) {
    console.error("[eduStaff] GET /staff error:", err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── POST /staff — create a pending staff member ─────────────── */

router.post("/staff", requireAuth, async (req, res) => {
  try {
    const uid = String((req as any).user?.uid || "").trim();
    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "no_org" });
    if (ctx.orgRole !== "faculty_admin") {
      return res.status(403).json({ error: "Only faculty admins can create staff" });
    }

    const fullName = asString(req.body?.fullName).trim();
    const role = coerceStaffRole(req.body?.role) || "faculty_teacher";
    const positionTitle = asString(req.body?.positionTitle).trim();
    const email = asString(req.body?.email).trim().toLowerCase() || null;

    if (!fullName) {
      return res.status(400).json({ error: "fullName is required" });
    }

    const now = Date.now();
    const onboardingCode = generateOnboardingCode();

    const ref = tenantCol("pendingStaff").doc();
    const doc = {
      orgId: ctx.orgId,
      fullName,
      role,
      positionTitle,
      email,
      onboardingCode,
      status: "pending",
      createdBy: uid,
      createdAt: now,
      usedAt: null,
    };

    await ref.set(doc);

    await writeEduAudit({
      orgId: ctx.orgId,
      actorUid: uid,
      actorName: "",
      action: "staff_created",
      targetId: ref.id,
    }).catch(() => {});

    return res.json({ staff: normalizeStaffDoc(ref.id, doc) });
  } catch (err: any) {
    console.error("[eduStaff] POST /staff error:", err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── POST /staff/:id/regenerate-code ─────────────────────────── */

router.post("/staff/:id/regenerate-code", requireAuth, async (req, res) => {
  try {
    const uid = String((req as any).user?.uid || "").trim();
    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "no_org" });
    if (ctx.orgRole !== "faculty_admin") {
      return res.status(403).json({ error: "Only faculty admins can regenerate codes" });
    }

    const staffId = asString(req.params.id).trim();
    if (!staffId) return res.status(400).json({ error: "Missing staff ID" });

    const docRef = tenantCol("pendingStaff").doc(staffId);
    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).json({ error: "Staff record not found" });

    const data = snap.data() as any;
    if (data?.orgId !== ctx.orgId) return res.status(403).json({ error: "forbidden" });
    if (data?.status !== "pending") {
      return res.status(400).json({ error: "Can only regenerate code for pending staff" });
    }

    const newCode = generateOnboardingCode();
    await docRef.update({ onboardingCode: newCode, updatedAt: Date.now() });

    await writeEduAudit({
      orgId: ctx.orgId,
      actorUid: uid,
      actorName: "",
      action: "staff_code_regenerated",
      targetId: staffId,
    }).catch(() => {});

    return res.json({ onboardingCode: newCode });
  } catch (err: any) {
    console.error("[eduStaff] POST /staff/:id/regenerate-code error:", err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── PATCH /staff/:id/status ─────────────────────────────────── */

router.patch("/staff/:id/status", requireAuth, async (req, res) => {
  try {
    const uid = String((req as any).user?.uid || "").trim();
    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "no_org" });
    if (ctx.orgRole !== "faculty_admin") {
      return res.status(403).json({ error: "Only faculty admins can change staff status" });
    }

    const staffId = asString(req.params.id).trim();
    if (!staffId) return res.status(400).json({ error: "Missing staff ID" });

    const newStatus = asString(req.body?.status).trim();
    if (newStatus !== "active" && newStatus !== "inactive") {
      return res.status(400).json({ error: "status must be 'active' or 'inactive'" });
    }

    const docRef = tenantCol("pendingStaff").doc(staffId);
    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).json({ error: "Staff record not found" });

    const data = snap.data() as any;
    if (data?.orgId !== ctx.orgId) return res.status(403).json({ error: "forbidden" });

    await docRef.update({ status: newStatus, updatedAt: Date.now() });

    const updated = { ...data, status: newStatus, updatedAt: Date.now() };
    return res.json({ staff: normalizeStaffDoc(staffId, updated) });
  } catch (err: any) {
    console.error("[eduStaff] PATCH /staff/:id/status error:", err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
