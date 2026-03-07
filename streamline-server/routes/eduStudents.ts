import express from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { requireAuth } from "../middleware/requireAuth";
import { writeEduAudit } from "../lib/eduAudit";
import { tenantCol, globalCol } from "../lib/dbPaths";

const router = express.Router();

type EduOrgRole = "faculty_admin" | "student_producer" | "student_producer_assigned" | "talent" | "viewer";

function asString(v: any): string {
  return typeof v === "string" ? v : "";
}

async function getOrgContext(uid: string): Promise<{ orgId: string; orgRole: EduOrgRole | null } | null> {
  const userSnap = await globalCol("users").doc(uid).get().catch(() => null as any);
  const user = userSnap && userSnap.exists ? (userSnap.data() as any) : null;
  if (!user) return null;

  const rawOrgId = user?.orgId ?? user?.org?.id ?? user?.org?.orgId;
  const orgId = typeof rawOrgId === "string" && rawOrgId.trim() ? rawOrgId.trim() : "";
  if (!orgId) return null;

  // Try user doc first, then fall back to orgMembers collection
  let rawRole = user?.orgRole ?? user?.org?.role;
  if (typeof rawRole !== "string" || !rawRole) {
    const memberId = `${orgId}_${uid}`;
    const memberSnap = await tenantCol("orgMembers").doc(memberId).get().catch(() => null as any);
    const member = memberSnap && memberSnap.exists ? (memberSnap.data() as any) : null;
    if (member?.role) rawRole = member.role;
  }
  const orgRole = (typeof rawRole === "string" ? rawRole : null) as EduOrgRole | null;
  return { orgId, orgRole };
}

/** Generate a random temporary password. */
function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#";
  let pw = "";
  const bytes = crypto.randomBytes(10);
  for (let i = 0; i < 10; i++) pw += chars[bytes[i] % chars.length];
  return pw;
}

/** Normalize a student doc into the client's StudentRecord shape. */
function normalizeStudent(docId: string, data: any) {
  return {
    id: docId,
    orgId: asString(data?.orgId),
    fullName: asString(data?.fullName || data?.displayName || data?.name),
    username: asString(data?.username || data?.email),
    grade: asString(data?.grade),
    classHomeroom: asString(data?.classHomeroom),
    role: asString(data?.orgRole || data?.role || "student_viewer") as any,
    mediaClubMember: data?.mediaClubMember === true || data?.mediaClub === true,
    status: asString(data?.status || "active") as any,
    mustChangePassword: data?.mustChangePassword === true,
    createdBy: asString(data?.createdBy),
    createdAt: typeof data?.createdAt === "number" ? data.createdAt : (data?.createdAt?.toMillis?.() ?? Date.now()),
    lastLoginAt: typeof data?.lastLoginAt === "number" ? data.lastLoginAt : null,
  };
}

// ── GET /api/edu/students ───────────────────────────────────────
// Returns all students for the current user's org.
router.get("/students", requireAuth as any, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "No org context" });

    // Students stored in the tenantCol("students") collection
    const snap = await tenantCol("students")
      .where("orgId", "==", ctx.orgId)
      .limit(200)
      .get();

    const students = snap.docs.map((d) => normalizeStudent(d.id, d.data()));
    // Sort newest first in-memory (avoids composite index)
    students.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

    return res.json({ students });
  } catch (err: any) {
    console.error("[eduStudents] GET /students error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/edu/students ──────────────────────────────────────
// Create a student account with a temporary password.
router.post("/students", requireAuth as any, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "No org context" });
    if (ctx.orgRole !== "faculty_admin") {
      return res.status(403).json({ error: "Only faculty admins can add students" });
    }

    const fullName = asString(req.body?.fullName).trim();
    const username = asString(req.body?.username).trim().toLowerCase();
    const grade = asString(req.body?.grade).trim();
    const classHomeroom = asString(req.body?.classHomeroom).trim();
    const role = asString(req.body?.role).trim() || "student_viewer";
    const mediaClubMember = req.body?.mediaClubMember === true;

    if (!fullName) return res.status(400).json({ error: "fullName is required" });
    if (!username) return res.status(400).json({ error: "username is required" });

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const now = Date.now();

    const ref = tenantCol("students").doc();
    const doc = {
      orgId: ctx.orgId,
      fullName,
      username,
      grade,
      classHomeroom,
      orgRole: role,
      mediaClubMember,
      passwordHash,
      mustChangePassword: true,
      status: "active",
      createdBy: uid,
      createdAt: now,
      lastLoginAt: null,
    };

    await ref.set(doc);

    writeEduAudit({
      orgId: ctx.orgId,
      actorUid: uid,
      actorName: "",
      action: "student.create",
      targetId: ref.id,
    }).catch(() => {});

    return res.status(201).json({
      student: normalizeStudent(ref.id, doc),
      tempPassword,
    });
  } catch (err: any) {
    console.error("[eduStudents] POST /students error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/edu/students/:id/reset-password ───────────────────
// Reset a student's password to a new temporary one.
router.post("/students/:id/reset-password", requireAuth as any, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "No org context" });
    if (ctx.orgRole !== "faculty_admin") {
      return res.status(403).json({ error: "Only faculty admins can reset passwords" });
    }

    const studentId = asString(req.params.id).trim();
    if (!studentId) return res.status(400).json({ error: "Missing student ID" });

    const docRef = tenantCol("students").doc(studentId);
    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).json({ error: "Student not found" });

    const data = snap.data() as any;
    if (data?.orgId !== ctx.orgId) return res.status(403).json({ error: "forbidden" });

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    await docRef.update({ passwordHash, mustChangePassword: true, updatedAt: Date.now() });

    return res.json({ tempPassword });
  } catch (err: any) {
    console.error("[eduStudents] POST /students/:id/reset-password error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/edu/students/:id/status ──────────────────────────
// Toggle student active/inactive.
router.patch("/students/:id/status", requireAuth as any, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "No org context" });
    if (ctx.orgRole !== "faculty_admin") {
      return res.status(403).json({ error: "Only faculty admins can change status" });
    }

    const studentId = asString(req.params.id).trim();
    if (!studentId) return res.status(400).json({ error: "Missing student ID" });

    const newStatus = asString(req.body?.status).trim();
    if (newStatus !== "active" && newStatus !== "inactive") {
      return res.status(400).json({ error: "status must be 'active' or 'inactive'" });
    }

    const docRef = tenantCol("students").doc(studentId);
    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).json({ error: "Student not found" });

    const data = snap.data() as any;
    if (data?.orgId !== ctx.orgId) return res.status(403).json({ error: "forbidden" });

    await docRef.update({ status: newStatus, updatedAt: Date.now() });

    const updated = { ...data, status: newStatus, updatedAt: Date.now() };
    return res.json({ student: normalizeStudent(studentId, updated) });
  } catch (err: any) {
    console.error("[eduStudents] PATCH /students/:id/status error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
