import express from "express";
import { requireAuth } from "../middleware/requireAuth";
import { tenantCol, globalCol } from "../lib/dbPaths";

const router = express.Router();

type EduOrgRole = "faculty_admin" | "student_producer" | "student_producer_assigned" | "talent" | "viewer";

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

// ── GET /api/edu/recordings ─────────────────────────────────────
// Returns recordings for the current user's org.
router.get("/recordings", requireAuth as any, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "No org context" });

    const snap = await tenantCol("recordings")
      .where("orgId", "==", ctx.orgId)
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();

    const recordings = snap.docs.map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        title: data.title ?? data.name ?? "",
        duration: data.duration ?? "",
        durationSec: data.durationSec ?? 0,
        date: data.createdAt?.toDate?.()?.toISOString?.() ?? null,
        status: data.status ?? "ready",
        roomId: data.roomId ?? "",
        url: data.url ?? null,
      };
    });

    return res.json({ recordings });
  } catch (err: any) {
    console.error("[eduRecordings] GET /recordings error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
