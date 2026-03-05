import express from "express";
import crypto from "crypto";
import admin from "firebase-admin";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { tenantCol, globalCol } from "../lib/dbPaths";
import { asString, coerceCorpRole, type CorpOrgRole } from "../lib/corpOrg";

const router = express.Router();

/* ── helpers ───────────────────────────────────────────────────────── */

/** Generate a join code like "ACME-4829" */
function generateJoinCode(slug: string): string {
  const prefix = slug.toUpperCase().slice(0, 6);
  const digits = crypto.randomInt(1000, 9999);
  return `${prefix}-${digits}`;
}

/** Normalise slug: lowercase, alphanumeric + hyphens only */
function normaliseSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

/* ── POST /orgs/create — create a new corporate org ─────────────── */
router.post("/orgs/create", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: "unauthorized" });

  try {
    const { name, slug: rawSlug } = req.body || ({} as any);

    const orgName = asString(name).trim();
    if (!orgName || orgName.length < 2) {
      return res.status(400).json({ error: "Organization name is required (2+ chars)." });
    }

    const slug = normaliseSlug(asString(rawSlug).trim() || orgName);
    if (!slug || slug.length < 2) {
      return res.status(400).json({ error: "Slug must be at least 2 alphanumeric characters." });
    }

    // Check slug uniqueness
    const slugCheck = await tenantCol("orgs", undefined, "corporate")
      .where("slug", "==", slug)
      .limit(1)
      .get();

    if (!slugCheck.empty) {
      return res.status(409).json({ error: "slug_taken", message: "That slug is already in use." });
    }

    // Check user doesn't already belong to an org
    const userSnap = await globalCol("users").doc(uid).get();
    const userData = userSnap.exists ? (userSnap.data() as any) : null;
    if (!userData) {
      return res.status(404).json({ error: "user_not_found" });
    }
    if (userData.orgId) {
      return res.status(409).json({ error: "already_in_org", message: "You already belong to an organization." });
    }

    const now = Date.now();
    const joinCode = generateJoinCode(slug);
    const orgRef = tenantCol("orgs", undefined, "corporate").doc();
    const orgId = orgRef.id;

    const orgDoc = {
      name: orgName,
      slug,
      joinCode,
      orgType: "corporate",
      defaultRole: "employee" as CorpOrgRole,
      timezone: userData.timeZone || "America/Chicago",
      createdAt: now,
      updatedAt: now,
      createdBy: uid,
    };

    // Write org + orgMember + update user in a batch
    const batch = db.batch();
    batch.set(orgRef, orgDoc);

    const memberId = `${orgId}_${uid}`;
    const memberRef = tenantCol("orgMembers", undefined, "corporate").doc(memberId);
    batch.set(memberRef, {
      orgId,
      uid,
      email: asString(userData.email),
      displayName: asString(userData.displayName || userData.name || ""),
      role: "owner" as CorpOrgRole,
      status: "active",
      joinedAt: now,
      createdAt: now,
    });

    batch.update(globalCol("users").doc(uid), { orgId, updatedAt: now });

    await batch.commit();

    return res.json({
      orgId,
      name: orgName,
      slug,
      joinCode,
      role: "owner",
    });
  } catch (err: any) {
    console.error("[corpOrgs] create error:", err?.message || err);
    return res.status(500).json({ error: "org_create_failed" });
  }
});

/* ── POST /orgs/join — join an existing org with slug + joinCode ── */
router.post("/orgs/join", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: "unauthorized" });

  try {
    const { slug: rawSlug, joinCode: rawCode } = req.body || ({} as any);

    const slug = normaliseSlug(asString(rawSlug));
    const joinCode = asString(rawCode).trim().toUpperCase();

    if (!slug) return res.status(400).json({ error: "slug_required" });
    if (!joinCode) return res.status(400).json({ error: "join_code_required" });

    // Check user doesn't already belong to an org
    const userSnap = await globalCol("users").doc(uid).get();
    const userData = userSnap.exists ? (userSnap.data() as any) : null;
    if (!userData) return res.status(404).json({ error: "user_not_found" });
    if (userData.orgId) {
      return res.status(409).json({ error: "already_in_org", message: "You already belong to an organization." });
    }

    // Look up org by slug
    const orgSnaps = await tenantCol("orgs", undefined, "corporate")
      .where("slug", "==", slug)
      .limit(1)
      .get();

    if (orgSnaps.empty) {
      return res.status(404).json({ error: "org_not_found", message: "No organization found with that slug." });
    }

    const orgSnap = orgSnaps.docs[0];
    const org = orgSnap.data() as any;
    const orgId = orgSnap.id;

    // Validate join code
    if ((org.joinCode || "").toUpperCase() !== joinCode) {
      return res.status(403).json({ error: "invalid_join_code", message: "The join code is incorrect." });
    }

    const now = Date.now();
    const defaultRole = coerceCorpRole(org.defaultRole) || "employee";

    // Check not already a member
    const memberId = `${orgId}_${uid}`;
    const existingMember = await tenantCol("orgMembers", undefined, "corporate")
      .doc(memberId)
      .get();

    if (existingMember.exists) {
      return res.status(409).json({ error: "already_member", message: "You are already a member of this organization." });
    }

    // Write membership + update user
    const batch = db.batch();
    batch.set(tenantCol("orgMembers", undefined, "corporate").doc(memberId), {
      orgId,
      uid,
      email: asString(userData.email),
      displayName: asString(userData.displayName || userData.name || ""),
      role: defaultRole,
      status: "active",
      joinedAt: now,
      createdAt: now,
    });

    batch.update(globalCol("users").doc(uid), { orgId, updatedAt: now });

    await batch.commit();

    return res.json({
      orgId,
      orgName: asString(org.name),
      role: defaultRole,
    });
  } catch (err: any) {
    console.error("[corpOrgs] join error:", err?.message || err);
    return res.status(500).json({ error: "org_join_failed" });
  }
});

/* ── GET /orgs/lookup?slug=... — public org lookup for UX ──────── */
router.get("/orgs/lookup", async (req, res) => {
  try {
    const slug = normaliseSlug(asString(req.query.slug));
    if (!slug) return res.status(400).json({ error: "slug_required" });

    const snaps = await tenantCol("orgs", undefined, "corporate")
      .where("slug", "==", slug)
      .limit(1)
      .get();

    if (snaps.empty) {
      return res.json({ exists: false, slug });
    }

    const org = snaps.docs[0].data() as any;
    return res.json({
      exists: true,
      slug,
      name: asString(org.name),
    });
  } catch (err: any) {
    console.error("[corpOrgs] lookup error:", err?.message || err);
    return res.status(500).json({ error: "lookup_failed" });
  }
});

/* ── GET /orgs/info — returns org details for an authenticated member */
router.get("/orgs/info", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: "unauthorized" });

  try {
    const userSnap = await globalCol("users").doc(uid).get();
    const userData = userSnap.exists ? (userSnap.data() as any) : null;
    if (!userData?.orgId) return res.status(404).json({ error: "no_org" });

    const orgSnap = await tenantCol("orgs", undefined, "corporate").doc(userData.orgId).get();
    if (!orgSnap.exists) return res.status(404).json({ error: "org_not_found" });

    const org = orgSnap.data() as any;
    return res.json({
      orgId: userData.orgId,
      name: asString(org.name),
      slug: asString(org.slug),
      joinCode: asString(org.joinCode),
      defaultRole: asString(org.defaultRole || "employee"),
    });
  } catch (err: any) {
    console.error("[corpOrgs] info error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── GET /orgs/members — list org members (admin only) ──────────── */
router.get("/orgs/members", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: "unauthorized" });

  try {
    const userSnap = await globalCol("users").doc(uid).get();
    const userData = userSnap.exists ? (userSnap.data() as any) : null;
    if (!userData?.orgId) return res.status(404).json({ error: "no_org" });

    const orgId = userData.orgId;

    // Verify caller is leader
    const callerMember = await tenantCol("orgMembers", undefined, "corporate")
      .doc(`${orgId}_${uid}`)
      .get();
    const callerRole = callerMember.exists ? (callerMember.data() as any).role : null;
    if (callerRole !== "owner" && callerRole !== "admin") {
      return res.status(403).json({ error: "admin_required" });
    }

    const membersSnap = await tenantCol("orgMembers", undefined, "corporate")
      .where("orgId", "==", orgId)
      .orderBy("joinedAt", "asc")
      .get();

    const members = membersSnap.docs.map((d) => {
      const m = d.data() as any;
      return {
        uid: asString(m.uid),
        email: asString(m.email),
        displayName: asString(m.displayName),
        role: asString(m.role),
        status: asString(m.status || "active"),
        jobTitle: asString(m.jobTitle || ""),
        department: asString(m.department || ""),
        location: asString(m.location || ""),
        managerUserId: m.managerUserId ? asString(m.managerUserId) : null,
        joinedAt: m.joinedAt || null,
      };
    });

    return res.json({ members });
  } catch (err: any) {
    console.error("[corpOrgs] members error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── POST /orgs/regenerate-code — regenerate join code (admin only) */
router.post("/orgs/regenerate-code", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: "unauthorized" });

  try {
    const userSnap = await globalCol("users").doc(uid).get();
    const userData = userSnap.exists ? (userSnap.data() as any) : null;
    if (!userData?.orgId) return res.status(404).json({ error: "no_org" });

    const orgId = userData.orgId;

    // Verify caller is leader
    const callerMember = await tenantCol("orgMembers", undefined, "corporate")
      .doc(`${orgId}_${uid}`)
      .get();
    const callerRole = callerMember.exists ? (callerMember.data() as any).role : null;
    if (callerRole !== "owner" && callerRole !== "admin") {
      return res.status(403).json({ error: "admin_required" });
    }

    const orgSnap = await tenantCol("orgs", undefined, "corporate").doc(orgId).get();
    if (!orgSnap.exists) return res.status(404).json({ error: "org_not_found" });

    const org = orgSnap.data() as any;
    const newCode = generateJoinCode(asString(org.slug));

    await tenantCol("orgs", undefined, "corporate").doc(orgId).update({
      joinCode: newCode,
      updatedAt: Date.now(),
    });

    return res.json({ joinCode: newCode });
  } catch (err: any) {
    console.error("[corpOrgs] regenerate-code error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── POST /orgs/remove-member — remove a member (admin only) ───── */
router.post("/orgs/remove-member", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: "unauthorized" });

  try {
    const { targetUid } = req.body || ({} as any);
    const target = asString(targetUid).trim();
    if (!target) return res.status(400).json({ error: "target_uid_required" });

    // Can't remove yourself
    if (target === uid) {
      return res.status(400).json({ error: "cannot_remove_self" });
    }

    const userSnap = await globalCol("users").doc(uid).get();
    const userData = userSnap.exists ? (userSnap.data() as any) : null;
    if (!userData?.orgId) return res.status(404).json({ error: "no_org" });

    const orgId = userData.orgId;

    // Verify caller is leader
    const callerMember = await tenantCol("orgMembers", undefined, "corporate")
      .doc(`${orgId}_${uid}`)
      .get();
    const callerRole = callerMember.exists ? (callerMember.data() as any).role : null;
    if (callerRole !== "owner" && callerRole !== "admin") {
      return res.status(403).json({ error: "admin_required" });
    }

    // Delete member + clear user's orgId
    const batch = db.batch();
    batch.delete(tenantCol("orgMembers", undefined, "corporate").doc(`${orgId}_${target}`));
    batch.update(globalCol("users").doc(target), {
      orgId: admin.firestore.FieldValue.delete(),
      updatedAt: Date.now(),
    });
    await batch.commit();

    return res.json({ removed: target });
  } catch (err: any) {
    console.error("[corpOrgs] remove-member error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── POST /orgs/change-role — change a member's role (owner/admin) ── */
router.post("/orgs/change-role", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: "unauthorized" });

  try {
    const { targetUid, newRole } = req.body || ({} as any);
    const target = asString(targetUid).trim();
    const role = coerceCorpRole(newRole);
    if (!target) return res.status(400).json({ error: "target_uid_required" });
    if (!role) return res.status(400).json({ error: "invalid_role" });

    const userSnap = await globalCol("users").doc(uid).get();
    const userData = userSnap.exists ? (userSnap.data() as any) : null;
    if (!userData?.orgId) return res.status(404).json({ error: "no_org" });

    const orgId = userData.orgId;

    // Verify caller is owner or admin
    const callerMember = await tenantCol("orgMembers", undefined, "corporate")
      .doc(`${orgId}_${uid}`)
      .get();
    const callerRole = callerMember.exists ? (callerMember.data() as any).role : null;
    if (callerRole !== "owner" && callerRole !== "admin") {
      return res.status(403).json({ error: "admin_required" });
    }

    // Cannot change own role
    if (target === uid) {
      return res.status(400).json({ error: "cannot_change_own_role" });
    }

    // Only owner can promote to admin or owner
    if ((role === "owner" || role === "admin") && callerRole !== "owner") {
      return res.status(403).json({ error: "owner_only" });
    }

    // Verify target is in the same org
    const targetMember = await tenantCol("orgMembers", undefined, "corporate")
      .doc(`${orgId}_${target}`)
      .get();
    if (!targetMember.exists) {
      return res.status(404).json({ error: "member_not_found" });
    }

    // Cannot demote the owner
    const targetRole = (targetMember.data() as any).role;
    if (targetRole === "owner" && callerRole !== "owner") {
      return res.status(403).json({ error: "cannot_demote_owner" });
    }

    await tenantCol("orgMembers", undefined, "corporate")
      .doc(`${orgId}_${target}`)
      .update({ role, updatedAt: Date.now() });

    return res.json({ uid: target, role });
  } catch (err: any) {
    console.error("[corpOrgs] change-role error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── GET /orgs/directory — all org members (any authenticated member) */
router.get("/orgs/directory", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: "unauthorized" });

  try {
    const userSnap = await globalCol("users").doc(uid).get();
    const userData = userSnap.exists ? (userSnap.data() as any) : null;
    if (!userData?.orgId) return res.status(404).json({ error: "no_org" });

    const orgId = userData.orgId;

    // Verify caller is a member of this org
    const callerMember = await tenantCol("orgMembers", undefined, "corporate")
      .doc(`${orgId}_${uid}`)
      .get();
    if (!callerMember.exists) {
      return res.status(403).json({ error: "not_a_member" });
    }

    const membersSnap = await tenantCol("orgMembers", undefined, "corporate")
      .where("orgId", "==", orgId)
      .orderBy("displayName", "asc")
      .get();

    const members = membersSnap.docs.map((d) => {
      const m = d.data() as any;
      return {
        uid: asString(m.uid),
        email: asString(m.email),
        displayName: asString(m.displayName),
        role: asString(m.role),
        status: asString(m.status || "active"),
        jobTitle: asString(m.jobTitle || ""),
        department: asString(m.department || ""),
        location: asString(m.location || ""),
        photoURL: asString(m.photoURL || ""),
        bio: asString(m.bio || ""),
        managerUserId: m.managerUserId ? asString(m.managerUserId) : null,
        joinedAt: m.joinedAt || null,
      };
    });

    // Collect unique departments for filter dropdown
    const departments = [...new Set(members.map((m) => m.department).filter(Boolean))].sort();

    return res.json({ members, departments });
  } catch (err: any) {
    console.error("[corpOrgs] directory error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── PATCH /orgs/profile — update directory profile fields ─────── */
router.patch("/orgs/profile", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: "unauthorized" });

  try {
    const userSnap = await globalCol("users").doc(uid).get();
    const userData = userSnap.exists ? (userSnap.data() as any) : null;
    if (!userData?.orgId) return res.status(404).json({ error: "no_org" });

    const orgId = userData.orgId;

    // Determine target (self or another member if admin)
    let targetUid = uid;
    const rawTarget = asString(req.body?.targetUid).trim();
    if (rawTarget && rawTarget !== uid) {
      // Must be admin to edit another user's profile
      const callerMember = await tenantCol("orgMembers", undefined, "corporate")
        .doc(`${orgId}_${uid}`)
        .get();
      const callerRole = callerMember.exists ? (callerMember.data() as any).role : null;
      if (callerRole !== "owner" && callerRole !== "admin") {
        return res.status(403).json({ error: "admin_required" });
      }
      targetUid = rawTarget;
    }

    const memberId = `${orgId}_${targetUid}`;
    const memberRef = tenantCol("orgMembers", undefined, "corporate").doc(memberId);
    const memberSnap = await memberRef.get();
    if (!memberSnap.exists) {
      return res.status(404).json({ error: "member_not_found" });
    }

    // Allowlisted profile fields
    const allowedFields = ["jobTitle", "department", "location", "bio", "photoURL", "displayName"];
    const patch: Record<string, any> = {};
    for (const field of allowedFields) {
      if (req.body?.[field] !== undefined) {
        patch[field] = asString(req.body[field]).slice(0, field === "bio" ? 500 : 200);
      }
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "no_fields" });
    }

    patch.updatedAt = Date.now();
    await memberRef.update(patch);

    return res.json({ uid: targetUid, ...patch });
  } catch (err: any) {
    console.error("[corpOrgs] profile error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── POST /orgs/set-manager — assign a manager (admin only) ────── */
router.post("/orgs/set-manager", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: "unauthorized" });

  try {
    const { targetUid, managerUserId } = req.body || ({} as any);
    const target = asString(targetUid).trim();
    const manager = managerUserId === null ? null : asString(managerUserId).trim() || null;

    if (!target) return res.status(400).json({ error: "target_uid_required" });

    const userSnap = await globalCol("users").doc(uid).get();
    const userData = userSnap.exists ? (userSnap.data() as any) : null;
    if (!userData?.orgId) return res.status(404).json({ error: "no_org" });

    const orgId = userData.orgId;

    // Verify caller is admin
    const callerMember = await tenantCol("orgMembers", undefined, "corporate")
      .doc(`${orgId}_${uid}`)
      .get();
    const callerRole = callerMember.exists ? (callerMember.data() as any).role : null;
    if (callerRole !== "owner" && callerRole !== "admin") {
      return res.status(403).json({ error: "admin_required" });
    }

    // Cannot be own manager
    if (manager && manager === target) {
      return res.status(400).json({ error: "cannot_be_own_manager" });
    }

    // Verify target exists in org
    const targetRef = tenantCol("orgMembers", undefined, "corporate").doc(`${orgId}_${target}`);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) {
      return res.status(404).json({ error: "member_not_found" });
    }

    // If setting a manager, verify manager exists in the same org
    if (manager) {
      const managerSnap = await tenantCol("orgMembers", undefined, "corporate")
        .doc(`${orgId}_${manager}`)
        .get();
      if (!managerSnap.exists) {
        return res.status(404).json({ error: "manager_not_found" });
      }

      // Cycle detection: walk the manager chain from `manager` upward.
      // If we encounter `target`, that would create a cycle.
      const visited = new Set<string>();
      let current: string | null = manager;
      while (current) {
        if (current === target) {
          return res.status(400).json({ error: "circular_manager", message: "This assignment would create a circular reporting chain." });
        }
        if (visited.has(current)) break; // already visited = existing cycle in data, stop
        visited.add(current);
        const snap = await tenantCol("orgMembers", undefined, "corporate")
          .doc(`${orgId}_${current}`)
          .get();
        const data = snap.exists ? (snap.data() as any) : null;
        current = data?.managerUserId ? asString(data.managerUserId) : null;
      }
    }

    // Apply the update
    await targetRef.update({
      managerUserId: manager || admin.firestore.FieldValue.delete(),
      updatedAt: Date.now(),
    });

    return res.json({ uid: target, managerUserId: manager });
  } catch (err: any) {
    console.error("[corpOrgs] set-manager error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
