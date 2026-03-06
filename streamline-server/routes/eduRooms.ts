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

// ── GET /api/edu/rooms ──────────────────────────────────────────
// Returns all rooms for the current user's org.
router.get("/rooms", requireAuth as any, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "No org context" });

    const snap = await tenantCol("rooms")
      .where("orgId", "==", ctx.orgId)
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();

    const rooms = snap.docs.map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        name: data.name ?? "",
        description: data.description ?? "",
        createdBy: data.createdBy ?? "",
        isLive: data.isLive ?? false,
        participantCount: data.participantCount ?? 0,
        createdAt: data.createdAt?.toMillis?.() ?? null,
      };
    });

    return res.json({ rooms });
  } catch (err: any) {
    console.error("[eduRooms] GET /rooms error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/edu/rooms ─────────────────────────────────────────
// Create a new room. Requires faculty_admin role.
router.post("/rooms", requireAuth as any, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "No org context" });
    if (ctx.orgRole !== "faculty_admin") {
      return res.status(403).json({ error: "Only faculty admins can create rooms" });
    }

    const name = asString(req.body?.name).trim();
    const description = asString(req.body?.description).trim();
    if (!name) return res.status(400).json({ error: "Room name is required" });

    const roomRef = tenantCol("rooms").doc();
    const roomData = {
      name,
      description,
      orgId: ctx.orgId,
      createdBy: uid,
      isLive: false,
      participantCount: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await roomRef.set(roomData);

    writeEduAudit({
      orgId: ctx.orgId,
      actorUid: uid,
      actorName: "",
      action: "room.create",
      targetId: roomRef.id,
    });

    return res.status(201).json({ id: roomRef.id, ...roomData, createdAt: Date.now() });
  } catch (err: any) {
    console.error("[eduRooms] POST /rooms error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
