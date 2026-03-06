import express from "express";
import admin from "firebase-admin";
import { requireAuth } from "../middleware/requireAuth";
import { writeEduAudit } from "../lib/eduAudit";
import { tenantCol, globalCol } from "../lib/dbPaths";

const router = express.Router();

type EduOrgRole = "faculty_admin" | "student_producer" | "student_producer_assigned" | "talent" | "viewer";

function asString(v: any): string {
  return typeof v === "string" ? v : "";
}

function coerceEmail(value: any): string | null {
  const email = asString(value).trim().toLowerCase();
  if (!email) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return email;
}

async function getOrgContext(uid: string): Promise<{ orgId: string; orgRole: EduOrgRole | null } | null> {
  const userSnap = await globalCol("users").doc(uid).get().catch(() => null as any);
  const user = userSnap && userSnap.exists ? (userSnap.data() as any) : null;
  if (!user) return null;

  const rawOrgId = user?.orgId ?? user?.org?.id ?? user?.org?.orgId;
  const orgId = typeof rawOrgId === "string" && rawOrgId.trim() ? rawOrgId.trim() : "";
  if (!orgId) return null;

  const rawRole = user?.orgRole ?? user?.org?.role;
  const orgRole = (typeof rawRole === "string" ? rawRole : null) as EduOrgRole | null;
  return { orgId, orgRole };
}

// ── GET /api/edu/students ───────────────────────────────────────
// Returns all students for the current user's org.
router.get("/students", requireAuth as any, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "No org context" });

    // Students are stored as users with student-type orgRoles
    const snap = await globalCol("users")
      .where("orgId", "==", ctx.orgId)
      .where("orgRole", "in", ["student_producer", "student_producer_assigned", "talent", "viewer"])
      .limit(200)
      .get();

    const students = snap.docs.map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        name: data.displayName ?? data.name ?? "",
        email: data.email ?? "",
        grade: data.grade ?? "",
        role: data.orgRole ?? "viewer",
        mediaClub: data.mediaClub ?? false,
        createdAt: data.createdAt?.toMillis?.() ?? null,
      };
    });

    return res.json({ students });
  } catch (err: any) {
    console.error("[eduStudents] GET /students error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/edu/students ──────────────────────────────────────
// Add a student to the org. Requires faculty_admin role.
router.post("/students", requireAuth as any, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "No org context" });
    if (ctx.orgRole !== "faculty_admin") {
      return res.status(403).json({ error: "Only faculty admins can add students" });
    }

    const name = asString(req.body?.name).trim();
    const email = coerceEmail(req.body?.email);
    const grade = asString(req.body?.grade).trim();
    const mediaClub = req.body?.mediaClub === true;
    const role = asString(req.body?.role).trim() || "viewer";

    if (!name) return res.status(400).json({ error: "Student name is required" });
    if (!email) return res.status(400).json({ error: "Valid email is required" });

    const studentRef = globalCol("users").doc();
    const studentData = {
      displayName: name,
      email,
      grade,
      mediaClub,
      orgId: ctx.orgId,
      orgRole: role,
      accountType: "student",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await studentRef.set(studentData);

    writeEduAudit({
      orgId: ctx.orgId,
      actorUid: uid,
      actorName: "",
      action: "student.create",
      targetId: studentRef.id,
    });

    return res.status(201).json({ id: studentRef.id, ...studentData, createdAt: Date.now() });
  } catch (err: any) {
    console.error("[eduStudents] POST /students error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
