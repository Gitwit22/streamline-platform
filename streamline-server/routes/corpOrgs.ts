import express from "express";
import crypto from "crypto";
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
      defaultRole: "member" as CorpOrgRole,
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
      role: "admin" as CorpOrgRole,
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
      role: "admin",
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
    const defaultRole = coerceCorpRole(org.defaultRole) || "member";

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
      defaultRole: asString(org.defaultRole || "member"),
    });
  } catch (err: any) {
    console.error("[corpOrgs] info error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
