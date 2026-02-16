import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import admin from "firebase-admin";
import { firestore } from "../firebaseAdmin";
import { requireAdmin } from "../middleware/adminAuth";
import { requireAuth } from "../middleware/requireAuth";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { writeEduAudit } from "../lib/eduAudit";
import { buildNewUserDoc } from "../lib/newUserDefaults";

const router = Router();

function asString(v: any): string {
  return typeof v === "string" ? v : "";
}

function coerceEmail(value: any): string | null {
  const email = asString(value).trim().toLowerCase();
  if (!email) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return email;
}

function getJwtSecret(): string {
  const raw = asString(process.env.JWT_SECRET).trim();
  const env = String(process.env.NODE_ENV || "development").toLowerCase();
  if ((env === "production" || env === "staging") && (!raw || raw === "dev-secret")) {
    throw new Error("Missing JWT_SECRET (no dev-secret in production)");
  }
  return raw || "dev-secret";
}

function cookieOptions() {
  const clientUrl = process.env.CLIENT_URL || process.env.CLIENT_URL_2 || "";
  const isLocal = clientUrl.startsWith("http://localhost") || clientUrl.startsWith("http://127.0.0.1");
  const secure = !isLocal;
  const sameSite: "none" | "lax" = secure ? "none" : "lax";

  return {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

type SystemStateDoc = {
  isInitialized: boolean;
  mode?: "demo" | "live";
  initializedAt?: any;
  initializedByUid?: string;
  demoSeedVersion?: string;
  allowFactoryReset?: boolean;
  allowSelfServeOrgCreation?: boolean;
};

async function getOrCreateSystemState(): Promise<SystemStateDoc> {
  const ref = firestore.collection("system").doc("state");
  const snap = await ref.get().catch(() => null as any);
  const data = snap && snap.exists ? ((snap.data() as any) || {}) : null;

  if (data) {
    return {
      isInitialized: data.isInitialized === true,
      mode: data.mode === "demo" ? "demo" : data.mode === "live" ? "live" : undefined,
      initializedAt: data.initializedAt,
      initializedByUid: typeof data.initializedByUid === "string" ? data.initializedByUid : undefined,
      demoSeedVersion: typeof data.demoSeedVersion === "string" ? data.demoSeedVersion : undefined,
      allowFactoryReset: data.allowFactoryReset === true,
      allowSelfServeOrgCreation: data.allowSelfServeOrgCreation === true,
    };
  }

  const seed: SystemStateDoc = {
    isInitialized: false,
    mode: (String(process.env.STREAMLINE_MODE || "").toLowerCase() === "demo" ? "demo" : undefined) as any,
    allowFactoryReset: String(process.env.ALLOW_FACTORY_RESET || "").toLowerCase() === "true",
    allowSelfServeOrgCreation: String(process.env.ALLOW_SELF_SERVE_ORG_CREATION || "").toLowerCase() === "true",
  };

  await ref.set({
    ...seed,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }, { merge: true });

  return seed;
}

function canRunUnauthedOnboarding(): boolean {
  const env = String(process.env.NODE_ENV || "development").toLowerCase();
  if (env !== "production") return true;
  return String(process.env.ALLOW_ONBOARDING_IN_PROD || "").toLowerCase() === "true";
}

function checkOnboardingKey(req: any): boolean {
  const key = asString(process.env.ONBOARDING_KEY).trim();
  if (!key) return false;

  const headerKey = asString(req.headers["x-onboarding-key"]).trim();
  const authHeader = req.headers["authorization"] || req.headers["Authorization"];
  const bearer = typeof authHeader === "string" && authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";

  if (headerKey && headerKey === key) return true;
  if (bearer && bearer === key) return true;
  return false;
}

async function deleteByQuery(q: FirebaseFirestore.Query, max = 5000) {
  let deleted = 0;

  while (deleted < max) {
    const snap = await q.limit(250).get().catch(() => null as any);
    const docs = snap?.docs || [];
    if (!docs.length) break;

    const batch = firestore.batch();
    for (const d of docs) batch.delete(d.ref);
    await batch.commit();
    deleted += docs.length;

    if (docs.length < 250) break;
  }

  return deleted;
}

async function markUsersDisabledForOrg(orgId: string) {
  const usersSnap = await firestore.collection("users").where("orgId", "==", orgId).limit(250).get().catch(() => null as any);
  const docs = usersSnap?.docs || [];
  if (!docs.length) return 0;

  const now = Date.now();
  const batch = firestore.batch();
  for (const d of docs) {
    batch.set(d.ref, {
      disabledAtMs: now,
      orgId: admin.firestore.FieldValue.delete(),
      orgType: admin.firestore.FieldValue.delete(),
      orgName: admin.firestore.FieldValue.delete(),
      updatedAt: now,
    }, { merge: true });
  }
  await batch.commit();
  return docs.length;
}

// GET /api/onboarding/config
// Public config for login/onboarding UI.
router.get("/config", async (_req, res) => {
  try {
    const state = await getOrCreateSystemState();
    return res.json({
      ok: true,
      systemState: {
        isInitialized: !!state.isInitialized,
        mode: state.mode || null,
        allowFactoryReset: !!state.allowFactoryReset,
        allowSelfServeOrgCreation: !!state.allowSelfServeOrgCreation,
      },
    });
  } catch (err: any) {
    console.error("GET /api/onboarding/config error", err);
    return res.status(500).json({ error: "internal" });
  }
});

// POST /api/onboarding/reset-demo
// Deletes demo org-scoped docs only (never global wipe).
router.post("/reset-demo", async (req, res) => {
  try {
    const allowByKey = checkOnboardingKey(req);

    // If no onboarding key provided, require platform admin.
    let actorUid: string | null = null;
    if (!allowByKey) {
      if (!canRunUnauthedOnboarding()) {
        return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
      }
      // If in non-prod we still want to allow unauth resets ONLY when key is present.
      // Otherwise, require admin to reduce accidental calls.
      await new Promise<void>((resolve, reject) => {
        requireAdmin(req as any, res as any, (err?: any) => (err ? reject(err) : resolve()));
      });
      actorUid = (req as any).adminUser?.uid || null;
    }

    const demoOrgId = asString(req.body?.orgId).trim() || "demo";
    if (demoOrgId !== "demo") {
      return res.status(400).json({ error: "demo_only" });
    }

    const orgRef = firestore.collection("orgs").doc(demoOrgId);
    const orgSnap = await orgRef.get().catch(() => null as any);
    const org = orgSnap && orgSnap.exists ? ((orgSnap.data() as any) || {}) : null;

    // Hard guardrail: only allow when orgId is demo OR explicitly flagged as demo.
    const isDemo = demoOrgId === "demo" || org?.isDemo === true;
    if (!isDemo) {
      return res.status(403).json({ error: "demo_only" });
    }

    // Delete org-scoped data.
    const deletedOrgMembers = await deleteByQuery(firestore.collection("orgMembers").where("orgId", "==", demoOrgId));

    // Best-effort: delete events/rooms/invites/etc when orgId exists.
    const deletedEvents = await deleteByQuery(firestore.collection("events").where("orgId", "==", demoOrgId)).catch(() => 0);
    const deletedRooms = await deleteByQuery(firestore.collection("rooms").where("orgId", "==", demoOrgId)).catch(() => 0);
    const deletedInvites = await deleteByQuery(firestore.collection("invites").where("orgId", "==", demoOrgId)).catch(() => 0);
    const deletedEmbeds = await deleteByQuery(firestore.collection("embeds").where("orgId", "==", demoOrgId)).catch(() => 0);

    const disabledUsers = await markUsersDisabledForOrg(demoOrgId).catch(() => 0);

    // Reset org doc to baseline instead of deleting (safer for references).
    await orgRef.set({
      id: demoOrgId,
      name: "EDU Demo",
      orgType: "edu",
      isDemo: true,
      onboardingStep: 1,
      onboardingCompletedAt: admin.firestore.FieldValue.delete(),
      updatedAt: Date.now(),
      createdAt: org?.createdAt || Date.now(),
    }, { merge: true });

    await writeEduAudit({
      orgId: demoOrgId,
      action: "onboarding.reset_demo",
      actorUid: actorUid || "system",
      actorName: actorUid ? "Platform Admin" : "System",
      targetId: demoOrgId,
    }).catch(() => void 0);

    return res.json({
      ok: true,
      deleted: {
        orgMembers: deletedOrgMembers,
        events: deletedEvents,
        rooms: deletedRooms,
        invites: deletedInvites,
        embeds: deletedEmbeds,
        usersDisabled: disabledUsers,
      },
    });
  } catch (err: any) {
    console.error("POST /api/onboarding/reset-demo error", err);
    return res.status(500).json({ error: "internal" });
  }
});

async function orgAlreadyHasFacultyAdmin(orgId: string): Promise<boolean> {
  try {
    const snap = await firestore
      .collection("orgMembers")
      .where("orgId", "==", orgId)
      .where("role", "==", "faculty_admin")
      .limit(1)
      .get();
    return !snap.empty;
  } catch {
    // Index-free fallback: scan a small window.
    const snap = await firestore.collection("orgMembers").where("orgId", "==", orgId).limit(50).get().catch(() => null as any);
    const docs = snap?.docs || [];
    return docs.some((d: any) => String((d.data() || {}).role || "") === "faculty_admin");
  }
}

// POST /api/onboarding/create-top-admin
// Creates a brand-new org (edu) and the first Faculty Admin user.
router.post("/create-top-admin", async (req, res) => {
  try {
    if (!canRunUnauthedOnboarding() && !checkOnboardingKey(req)) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const firstName = asString(req.body?.firstName).trim();
    const lastName = asString(req.body?.lastName).trim();
    const email = coerceEmail(req.body?.email);
    const password = asString(req.body?.password);
    const confirmPassword = asString(req.body?.confirmPassword);
    const phone = asString(req.body?.phone).trim();

    const orgName = asString(req.body?.orgName).trim() || "Your School";

    if (!firstName || !lastName) return res.status(400).json({ error: "name_required" });
    if (!email) return res.status(400).json({ error: "email_invalid" });
    if (!password || password.length < 8) return res.status(400).json({ error: "password_too_short" });
    if (password !== confirmPassword) return res.status(400).json({ error: "password_mismatch" });

    // Prevent creating an EDU top admin using an existing email.
    const existing = await firestore.collection("users").where("email", "==", email).limit(1).get();
    if (!existing.empty) {
      return res.status(409).json({ error: "email_in_use" });
    }

    const now = Date.now();

    const orgId = firestore.collection("orgs").doc().id;

    // Hard rule: only allow top admin creation when there is no existing top admin.
    // (This should always be true for a new orgId, but keep the guard for safety.)
    if (await orgAlreadyHasFacultyAdmin(orgId)) {
      return res.status(409).json({ error: "top_admin_exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const displayName = `${firstName} ${lastName}`.trim();

    const userRef = firestore.collection("users").doc();
    const uid = userRef.id;

    const memberId = `${orgId}_${uid}`;

    await firestore.runTransaction(async (tx) => {
      // Create org
      tx.set(
        firestore.collection("orgs").doc(orgId),
        {
          id: orgId,
          name: orgName,
          orgType: "edu",
          isDemo: false,
          contactEmail: email,
          primaryContactEmail: email,
          phone: phone || null,
          onboardingStep: 3,
          onboardingCompletedAt: admin.firestore.FieldValue.delete(),
          createdAt: now,
          updatedAt: now,
        },
        { merge: true },
      );

      // Create user
      const baseUser = buildNewUserDoc({
        email,
        passwordHash,
        displayName,
        nowMs: now,
        tosAcceptedIp: asString(req.ip) || undefined,
        tosUserAgent: asString(req.get("user-agent")) || undefined,
      });

      tx.set(userRef, {
        ...baseUser,
        name: displayName,
        orgId,
        orgType: "edu",
        orgName,
        phone: phone || null,
        updatedAt: now,
      });

      // Create membership
      tx.set(
        firestore.collection("orgMembers").doc(memberId),
        {
          orgId,
          uid,
          email,
          name: displayName,
          role: "faculty_admin",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        { merge: true },
      );
    });

    // Mint session token/cookie
    const token = jwt.sign({ uid }, getJwtSecret(), { expiresIn: "7d" });
    (res as any).cookie("token", token, cookieOptions());

    await writeEduAudit({
      orgId,
      action: "onboarding.create_top_admin",
      actorUid: uid,
      actorName: displayName,
      targetId: memberId,
    }).catch(() => void 0);

    return res.json({
      ok: true,
      token,
      orgId,
      userId: uid,
    });
  } catch (err: any) {
    console.error("POST /api/onboarding/create-top-admin error", err);
    return res.status(500).json({ error: "internal" });
  }
});

// POST /api/onboarding/progress
// Updates org onboardingStep for the current authenticated org (faculty_admin only).
router.post("/progress", requireAuth, async (req, res) => {
  try {
    const uid = (req as any).user?.uid as string | undefined;
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const stepRaw = Number((req.body as any)?.step);
    const step = Number.isFinite(stepRaw) ? Math.max(1, Math.min(5, Math.floor(stepRaw))) : null;
    if (!step) return res.status(400).json({ error: "invalid_step" });

    const userSnap = await firestore.collection("users").doc(uid).get();
    const user = (userSnap.data() as any) || {};
    const orgId = typeof user.orgId === "string" ? user.orgId : "";
    if (!orgId) return res.status(400).json({ error: "missing_org" });

    const memberId = `${orgId}_${uid}`;
    const mSnap = await firestore.collection("orgMembers").doc(memberId).get();
    const member = (mSnap.data() as any) || {};
    const role = String(member.role || "");
    if (role !== "faculty_admin") return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });

    const orgRef = firestore.collection("orgs").doc(orgId);
    const now = Date.now();
    await orgRef.set(
      {
        onboardingStep: step,
        onboardingCompletedAt: step >= 5 ? now : admin.firestore.FieldValue.delete(),
        updatedAt: now,
      },
      { merge: true },
    );

    await writeEduAudit({
      orgId,
      action: "onboarding.progress",
      actorUid: uid,
      actorName: typeof user.displayName === "string" && user.displayName ? user.displayName : typeof user.name === "string" ? user.name : "User",
      targetId: `step:${step}`,
    }).catch(() => void 0);

    return res.json({ ok: true, orgId, step });
  } catch (err: any) {
    console.error("POST /api/onboarding/progress error", err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
