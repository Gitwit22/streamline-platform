import express from "express";
import admin from "firebase-admin";
import { requireAuth } from "../middleware/requireAuth";
import { writeEduAudit } from "../lib/eduAudit";
import { tenantCol, globalCol } from "../lib/dbPaths";

const router = express.Router();

type EduOrgRole = "faculty_admin" | "faculty_teacher" | "student_producer" | "student_producer_assigned" | "talent" | "viewer";

/** Room types: meeting (no broadcast), broadcast (always broadcasts), hybrid (optional broadcast). */
type RoomType = "meeting" | "broadcast" | "hybrid";

/** Default broadcast layout when a room goes live. */
type DefaultLayout = "grid" | "speaker" | "single" | "custom";

function asString(v: any): string {
  return typeof v === "string" ? v : "";
}

function asStringEnum<T extends string>(v: any, allowed: T[], fallback: T): T {
  return typeof v === "string" && (allowed as string[]).includes(v) ? (v as T) : fallback;
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

// ── GET /api/edu/rooms ──────────────────────────────────────────
// Returns all rooms for the current user's org.
router.get("/rooms", requireAuth as any, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const ctx = await getOrgContext(uid);
    if (!ctx) {
      console.warn("[eduRooms] GET /rooms — no org context for uid:", uid);
      return res.status(403).json({ error: "No org context" });
    }

    console.log("[eduRooms] GET /rooms — uid:", uid, "orgId:", ctx.orgId, "orgRole:", ctx.orgRole);

    const snap = await tenantCol("rooms")
      .where("orgId", "==", ctx.orgId)
      .limit(100)
      .get();

    console.log("[eduRooms] GET /rooms — found", snap.docs.length, "rooms for orgId:", ctx.orgId);

    const rooms = snap.docs.map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        name: data.name ?? "",
        description: data.description ?? "",
        createdBy: data.createdBy ?? "",
        isLive: data.isLive ?? false,
        participantCount: data.participantCount ?? 0,
        roomType: data.roomType ?? "meeting",
        broadcastEnabled: data.broadcastEnabled ?? false,
        recordingEnabled: data.recordingEnabled ?? false,
        defaultLayout: data.defaultLayout ?? "grid",
        shareableExternally: data.shareableExternally ?? false,
        allowedRoles: data.allowedRoles ?? [],
        createdAt: data.createdAt?.toMillis?.() ?? null,
      };
    });

    // Sort in-memory (avoids composite index requirement)
    rooms.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

    return res.json({ rooms });
  } catch (err: any) {
    console.error("[eduRooms] GET /rooms error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/edu/rooms/shareable ────────────────────────────────
// Returns only rooms with shareableExternally = true for the current user's org.
// Used by Website Embed page to populate the "Shareable Room" source selector.
router.get("/rooms/shareable", requireAuth as any, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "No org context" });

    const snap = await tenantCol("rooms")
      .where("orgId", "==", ctx.orgId)
      .where("shareableExternally", "==", true)
      .limit(100)
      .get();

    const rooms = snap.docs.map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        name: data.name ?? "",
        description: data.description ?? "",
        roomType: data.roomType ?? "meeting",
        broadcastEnabled: data.broadcastEnabled ?? false,
        isLive: data.isLive ?? false,
      };
    });

    rooms.sort((a, b) => a.name.localeCompare(b.name));

    return res.json({ rooms });
  } catch (err: any) {
    console.error("[eduRooms] GET /rooms/shareable error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/edu/rooms/:roomId ──────────────────────────────────
// Returns a single room by ID.
router.get("/rooms/:roomId", requireAuth as any, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "No org context" });

    const roomId = req.params.roomId;
    const snap = await tenantCol("rooms").doc(roomId).get();
    if (!snap.exists) return res.status(404).json({ error: "Room not found" });

    const data = snap.data() as any;
    if (data.orgId !== ctx.orgId) return res.status(403).json({ error: "Not in your org" });

    return res.json({
      room: {
        id: snap.id,
        name: data.name ?? "",
        description: data.description ?? "",
        createdBy: data.createdBy ?? "",
        isLive: data.isLive ?? false,
        participantCount: data.participantCount ?? 0,
        roomType: data.roomType ?? "meeting",
        broadcastEnabled: data.broadcastEnabled ?? false,
        recordingEnabled: data.recordingEnabled ?? false,
        defaultLayout: data.defaultLayout ?? "grid",
        shareableExternally: data.shareableExternally ?? false,
        allowedRoles: data.allowedRoles ?? [],
        createdAt: data.createdAt?.toMillis?.() ?? null,
      },
    });
  } catch (err: any) {
    console.error("[eduRooms] GET /rooms/:roomId error:", err);
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

    const roomType = asStringEnum(req.body?.roomType, ["meeting", "broadcast", "hybrid"], "meeting");
    const broadcastEnabled = roomType === "broadcast" ? true : !!req.body?.broadcastEnabled;
    const recordingEnabled = !!req.body?.recordingEnabled;
    const defaultLayout = asStringEnum(req.body?.defaultLayout, ["grid", "speaker", "single", "custom"], "grid");
    const shareableExternally = !!req.body?.shareableExternally;
    const allowedRoles: string[] = Array.isArray(req.body?.allowedRoles)
      ? req.body.allowedRoles.filter((r: any) => typeof r === "string")
      : [];

    const roomRef = tenantCol("rooms").doc();
    const roomData = {
      name,
      description,
      orgId: ctx.orgId,
      createdBy: uid,
      isLive: false,
      participantCount: 0,
      roomType,
      broadcastEnabled,
      recordingEnabled,
      defaultLayout,
      shareableExternally,
      allowedRoles,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await roomRef.set(roomData);

    console.log("[eduRooms] Room created:", { id: roomRef.id, name, orgId: ctx.orgId, createdBy: uid });

    writeEduAudit({
      orgId: ctx.orgId,
      actorUid: uid,
      actorName: "",
      action: "room.create",
      targetId: roomRef.id,
    });

    return res.status(201).json({ room: { id: roomRef.id, ...roomData, createdAt: Date.now() } });
  } catch (err: any) {
    console.error("[eduRooms] POST /rooms error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/edu/rooms/:roomId ────────────────────────────────
// Update room settings. Requires faculty_admin role.
router.patch("/rooms/:roomId", requireAuth as any, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "No org context" });
    if (ctx.orgRole !== "faculty_admin") {
      return res.status(403).json({ error: "Only faculty admins can update rooms" });
    }

    const roomId = req.params.roomId;
    const ref = tenantCol("rooms").doc(roomId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Room not found" });

    const existing = snap.data() as any;
    if (existing.orgId !== ctx.orgId) return res.status(403).json({ error: "Not in your org" });

    const patch: Record<string, any> = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };

    if (req.body?.name !== undefined) patch.name = asString(req.body.name).trim();
    if (req.body?.description !== undefined) patch.description = asString(req.body.description).trim();
    if (req.body?.roomType !== undefined) {
      patch.roomType = asStringEnum(req.body.roomType, ["meeting", "broadcast", "hybrid"], "meeting");
    }
    if (req.body?.broadcastEnabled !== undefined) patch.broadcastEnabled = !!req.body.broadcastEnabled;
    if (req.body?.recordingEnabled !== undefined) patch.recordingEnabled = !!req.body.recordingEnabled;
    if (req.body?.shareableExternally !== undefined) patch.shareableExternally = !!req.body.shareableExternally;
    if (req.body?.defaultLayout !== undefined) {
      patch.defaultLayout = asStringEnum(req.body.defaultLayout, ["grid", "speaker", "single", "custom"], "grid");
    }
    if (Array.isArray(req.body?.allowedRoles)) {
      patch.allowedRoles = req.body.allowedRoles.filter((r: any) => typeof r === "string");
    }

    await ref.update(patch);

    writeEduAudit({
      orgId: ctx.orgId,
      actorUid: uid,
      actorName: "",
      action: "room.update",
      targetId: roomId,
    });

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[eduRooms] PATCH /rooms/:roomId error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/edu/rooms/:roomId ────────────────────────────────
// Delete a room. Requires faculty_admin role. Cannot delete a live room.
router.delete("/rooms/:roomId", requireAuth as any, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "No org context" });
    if (ctx.orgRole !== "faculty_admin") {
      return res.status(403).json({ error: "Only faculty admins can delete rooms" });
    }

    const roomId = req.params.roomId;
    const ref = tenantCol("rooms").doc(roomId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Room not found" });

    const existing = snap.data() as any;
    if (existing.orgId !== ctx.orgId) return res.status(403).json({ error: "Not in your org" });
    if (existing.isLive) return res.status(409).json({ error: "Cannot delete a room that is currently live" });

    await ref.delete();

    console.log("[eduRooms] Room deleted:", { id: roomId, name: existing.name, orgId: ctx.orgId, deletedBy: uid });

    writeEduAudit({
      orgId: ctx.orgId,
      actorUid: uid,
      actorName: "",
      action: "room.delete",
      targetId: roomId,
    });

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[eduRooms] DELETE /rooms/:roomId error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/edu/admin/patch-orgs ──────────────────────────────
// TEMPORARY diagnostic: patches all orgs missing `status` field and returns room counts.
// Requires faculty_admin auth. Remove after data is clean.
router.post("/admin/patch-orgs", requireAuth as any, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "No org context" });
    if (ctx.orgRole !== "faculty_admin") {
      return res.status(403).json({ error: "Only faculty admins" });
    }

    // Patch all orgs missing status
    const orgsSnap = await tenantCol("orgs").get();
    const orgResults: any[] = [];
    for (const doc of orgsSnap.docs) {
      const data = doc.data() as any;
      const patched = !data.status;
      if (patched) {
        await tenantCol("orgs").doc(doc.id).set({ status: "active" }, { merge: true });
      }
      orgResults.push({
        id: doc.id,
        name: data.name || "?",
        slug: data.slug || "?",
        status: data.status || "(was missing → patched to active)",
        patched,
      });
    }

    // Count rooms for this org
    const roomsSnap = await tenantCol("rooms")
      .where("orgId", "==", ctx.orgId)
      .get();
    const rooms = roomsSnap.docs.map((d) => {
      const data = d.data() as any;
      return { id: d.id, name: data.name, orgId: data.orgId, createdBy: data.createdBy };
    });

    return res.json({
      yourOrgId: ctx.orgId,
      yourUid: uid,
      orgs: orgResults,
      roomCount: rooms.length,
      rooms,
    });
  } catch (err: any) {
    console.error("[eduRooms] POST /admin/patch-orgs error:", err);
    return res.status(500).json({ error: "Internal server error", detail: err?.message });
  }
});

export default router;
