import express from "express";
import admin from "firebase-admin";
import { requireAuth } from "../middleware/requireAuth";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { tenantCol, globalCol } from "../lib/dbPaths";
import { writeEduAudit } from "../lib/eduAudit";

const router = express.Router();

type EduOrgRole = "faculty_admin" | "faculty_teacher" | "student_producer" | "student_producer_assigned" | "talent" | "viewer";

const EVENT_TYPES = ["concert", "game", "assembly", "address"] as const;

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

function serializeEvent(id: string, data: any) {
  return {
    id,
    title: asString(data.title),
    type: asString(data.type) || "concert",
    startsAt: asString(data.startsAt),
    endsAt: asString(data.endsAt),
    timezone: asString(data.timezone) || "America/New_York",
    notes: asString(data.notes),
    producerName: typeof data.producerName === "string" ? data.producerName : null,
    talent: Array.isArray(data.talent) ? data.talent.filter((t: any) => typeof t === "string") : [],
    studentProducerCanStart: !!data.studentProducerCanStart,
    outputs: {
      publishHls: !!(data.outputs?.publishHls ?? true),
      recordMp4: !!(data.outputs?.recordMp4 ?? true),
      youtube: !!data.outputs?.youtube,
      youtubeDestinationId: typeof data.outputs?.youtubeDestinationId === "string" ? data.outputs.youtubeDestinationId : null,
    },
    assignedRoomId: typeof data.assignedRoomId === "string" ? data.assignedRoomId : null,
    savedEmbedId: typeof data.savedEmbedId === "string" ? data.savedEmbedId : null,
    isLive: !!data.isLive,
    endedAt: typeof data.endedAt === "string" ? data.endedAt : null,
    canceledAt: typeof data.canceledAt === "string" ? data.canceledAt : null,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : (data.createdAt?.toDate?.()?.toISOString?.() ?? new Date().toISOString()),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : (data.updatedAt?.toDate?.()?.toISOString?.() ?? new Date().toISOString()),
  };
}

// ── GET /api/edu/events ─────────────────────────────────────────
// List events for the user's org (shared across all org members).
router.get("/events", requireAuth as any, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "No org context" });

    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 100;

    const snap = await tenantCol("events")
      .where("orgId", "==", ctx.orgId)
      .limit(limit)
      .get();

    const events = snap.docs.map((d) => serializeEvent(d.id, d.data()));

    // Sort by startsAt ascending in-memory (avoids composite index)
    events.sort((a, b) => {
      const ta = new Date(a.startsAt).getTime() || 0;
      const tb = new Date(b.startsAt).getTime() || 0;
      return ta - tb;
    });

    return res.json({ events });
  } catch (err: any) {
    console.error("GET /api/edu/events error", err);
    return res.status(500).json({ error: "internal" });
  }
});

// ── GET /api/edu/events/:eventId ────────────────────────────────
router.get("/events/:eventId", requireAuth as any, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "No org context" });

    const eventId = req.params.eventId;
    const snap = await tenantCol("events").doc(eventId).get();
    if (!snap.exists) return res.status(404).json({ error: "Event not found" });

    const data = snap.data() as any;
    if (data.orgId !== ctx.orgId) return res.status(403).json({ error: "Not in your org" });

    return res.json({ event: serializeEvent(snap.id, data) });
  } catch (err: any) {
    console.error("GET /api/edu/events/:eventId error", err);
    return res.status(500).json({ error: "internal" });
  }
});

// ── POST /api/edu/events ────────────────────────────────────────
// Create a new event. Faculty admin or student producer.
router.post("/events", requireAuth as any, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "No org context" });

    // Faculty admin and student producers can create events
    const allowedRoles: string[] = ["faculty_admin", "faculty_teacher", "student_producer", "student_producer_assigned"];
    if (ctx.orgRole && !allowedRoles.includes(ctx.orgRole)) {
      return res.status(403).json({ error: "Insufficient role" });
    }

    const title = asString(req.body?.title).trim();
    if (!title) return res.status(400).json({ error: "Title is required" });

    const typeRaw = asString(req.body?.type);
    const type = (EVENT_TYPES as readonly string[]).includes(typeRaw) ? typeRaw : "concert";

    const startsAt = asString(req.body?.startsAt);
    if (!startsAt) return res.status(400).json({ error: "startsAt is required" });

    const endsAt = asString(req.body?.endsAt) || new Date(new Date(startsAt).getTime() + 60 * 60_000).toISOString();
    const timezone = asString(req.body?.timezone).trim() || "America/New_York";

    const outputsRaw = req.body?.outputs || {};
    const now = new Date().toISOString();

    const eventData: Record<string, any> = {
      orgId: ctx.orgId,
      createdBy: uid,
      title,
      type,
      startsAt,
      endsAt,
      timezone,
      notes: asString(req.body?.notes),
      producerName: typeof req.body?.producerName === "string" ? req.body.producerName.trim() || null : null,
      talent: Array.isArray(req.body?.talent)
        ? req.body.talent.filter((t: any) => typeof t === "string" && t.trim()).map((t: string) => t.trim())
        : [],
      studentProducerCanStart: !!req.body?.studentProducerCanStart,
      outputs: {
        publishHls: outputsRaw.publishHls ?? true,
        recordMp4: outputsRaw.recordMp4 ?? true,
        youtube: !!outputsRaw.youtube,
        youtubeDestinationId: typeof outputsRaw.youtubeDestinationId === "string" ? outputsRaw.youtubeDestinationId : null,
      },
      assignedRoomId: typeof req.body?.assignedRoomId === "string" ? req.body.assignedRoomId : null,
      savedEmbedId: null,
      isLive: false,
      endedAt: null,
      canceledAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const ref = tenantCol("events").doc();
    await ref.set(eventData);

    console.log("[eduEvents] Event created:", { id: ref.id, title, orgId: ctx.orgId, createdBy: uid });

    writeEduAudit({
      orgId: ctx.orgId,
      actorUid: uid,
      actorName: "",
      action: "event.create",
      targetId: ref.id,
    });

    return res.status(201).json({ event: serializeEvent(ref.id, eventData) });
  } catch (err: any) {
    console.error("POST /api/edu/events error", err);
    return res.status(500).json({ error: "internal" });
  }
});

// ── PATCH /api/edu/events/:eventId ──────────────────────────────
// Update an event. Faculty admin or the creator.
router.patch("/events/:eventId", requireAuth as any, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "No org context" });

    const eventId = req.params.eventId;
    const ref = tenantCol("events").doc(eventId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Event not found" });

    const existing = snap.data() as any;
    if (existing.orgId !== ctx.orgId) return res.status(403).json({ error: "Not in your org" });

    const patch: Record<string, any> = { updatedAt: new Date().toISOString() };

    if (req.body?.title !== undefined) patch.title = asString(req.body.title).trim();
    if (req.body?.type !== undefined) {
      const t = asString(req.body.type);
      if ((EVENT_TYPES as readonly string[]).includes(t)) patch.type = t;
    }
    if (req.body?.startsAt !== undefined) patch.startsAt = asString(req.body.startsAt);
    if (req.body?.endsAt !== undefined) patch.endsAt = asString(req.body.endsAt);
    if (req.body?.timezone !== undefined) patch.timezone = asString(req.body.timezone);
    if (req.body?.notes !== undefined) patch.notes = asString(req.body.notes);
    if (req.body?.producerName !== undefined) {
      patch.producerName = typeof req.body.producerName === "string" ? req.body.producerName.trim() || null : null;
    }
    if (req.body?.talent !== undefined) {
      patch.talent = Array.isArray(req.body.talent)
        ? req.body.talent.filter((t: any) => typeof t === "string" && t.trim()).map((t: string) => t.trim())
        : [];
    }
    if (req.body?.studentProducerCanStart !== undefined) patch.studentProducerCanStart = !!req.body.studentProducerCanStart;
    if (req.body?.outputs !== undefined) {
      const o = req.body.outputs;
      patch.outputs = {
        publishHls: o.publishHls ?? existing.outputs?.publishHls ?? true,
        recordMp4: o.recordMp4 ?? existing.outputs?.recordMp4 ?? true,
        youtube: !!o.youtube,
        youtubeDestinationId: typeof o.youtubeDestinationId === "string" ? o.youtubeDestinationId : existing.outputs?.youtubeDestinationId ?? null,
      };
    }
    if (req.body?.assignedRoomId !== undefined) {
      patch.assignedRoomId = typeof req.body.assignedRoomId === "string" ? req.body.assignedRoomId : null;
    }
    if (req.body?.savedEmbedId !== undefined) {
      patch.savedEmbedId = typeof req.body.savedEmbedId === "string" ? req.body.savedEmbedId : null;
    }
    if (req.body?.isLive !== undefined) patch.isLive = !!req.body.isLive;
    if (req.body?.endedAt !== undefined) {
      patch.endedAt = typeof req.body.endedAt === "string" ? req.body.endedAt : null;
    }
    if (req.body?.canceledAt !== undefined) {
      patch.canceledAt = typeof req.body.canceledAt === "string" ? req.body.canceledAt : null;
    }

    await ref.update(patch);

    writeEduAudit({
      orgId: ctx.orgId,
      actorUid: uid,
      actorName: "",
      action: "event.update",
      targetId: eventId,
    });

    // Return the merged doc
    const merged = { ...existing, ...patch };
    return res.json({ event: serializeEvent(eventId, merged) });
  } catch (err: any) {
    console.error("PATCH /api/edu/events/:eventId error", err);
    return res.status(500).json({ error: "internal" });
  }
});

// ── POST /api/edu/events/:eventId/cancel ────────────────────────
router.post("/events/:eventId/cancel", requireAuth as any, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "No org context" });

    const eventId = req.params.eventId;
    const ref = tenantCol("events").doc(eventId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Event not found" });

    const existing = snap.data() as any;
    if (existing.orgId !== ctx.orgId) return res.status(403).json({ error: "Not in your org" });
    if (existing.canceledAt) return res.json({ event: serializeEvent(eventId, existing) });

    const now = new Date().toISOString();
    const patch = { isLive: false, canceledAt: now, updatedAt: now };
    await ref.update(patch);

    writeEduAudit({
      orgId: ctx.orgId,
      actorUid: uid,
      actorName: "",
      action: "event.cancel",
      targetId: eventId,
    });

    return res.json({ event: serializeEvent(eventId, { ...existing, ...patch }) });
  } catch (err: any) {
    console.error("POST /api/edu/events/:eventId/cancel error", err);
    return res.status(500).json({ error: "internal" });
  }
});

// ── POST /api/edu/events/:eventId/set-live ──────────────────────
router.post("/events/:eventId/set-live", requireAuth as any, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "No org context" });

    const eventId = req.params.eventId;
    const ref = tenantCol("events").doc(eventId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Event not found" });

    const existing = snap.data() as any;
    if (existing.orgId !== ctx.orgId) return res.status(403).json({ error: "Not in your org" });
    if (existing.canceledAt) return res.status(400).json({ error: "Event is canceled" });

    const live = !!req.body?.live;
    const now = new Date().toISOString();
    const patch: Record<string, any> = { updatedAt: now };

    if (live) {
      patch.isLive = true;
      patch.endedAt = null;
    } else {
      patch.isLive = false;
      patch.endedAt = existing.endedAt || now;
    }

    await ref.update(patch);
    return res.json({ event: serializeEvent(eventId, { ...existing, ...patch }) });
  } catch (err: any) {
    console.error("POST /api/edu/events/:eventId/set-live error", err);
    return res.status(500).json({ error: "internal" });
  }
});

// ── POST /api/edu/events/:eventId/duplicate ─────────────────────
router.post("/events/:eventId/duplicate", requireAuth as any, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const ctx = await getOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "No org context" });

    const eventId = req.params.eventId;
    const snap = await tenantCol("events").doc(eventId).get();
    if (!snap.exists) return res.status(404).json({ error: "Event not found" });

    const existing = snap.data() as any;
    if (existing.orgId !== ctx.orgId) return res.status(403).json({ error: "Not in your org" });

    const now = new Date().toISOString();
    const newData: Record<string, any> = {
      ...existing,
      title: `${asString(existing.title)} (Copy)`,
      isLive: false,
      endedAt: null,
      canceledAt: null,
      savedEmbedId: null,
      createdBy: uid,
      createdAt: now,
      updatedAt: now,
    };

    const ref = tenantCol("events").doc();
    await ref.set(newData);

    writeEduAudit({
      orgId: ctx.orgId,
      actorUid: uid,
      actorName: "",
      action: "event.duplicate",
      targetId: ref.id,
    });

    return res.status(201).json({ event: serializeEvent(ref.id, newData) });
  } catch (err: any) {
    console.error("POST /api/edu/events/:eventId/duplicate error", err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
