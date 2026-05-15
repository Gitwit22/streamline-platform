import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { requireAuth } from "../middleware/requireAuth";
import { firestore as db } from "../firebaseAdmin";
import { buildNewUserDoc } from "../lib/newUserDefaults";
import {
  coerceCorporateRole,
  findInviteByToken,
  isValidEmail,
  normalizeEmail,
  upsertCorporateUser,
  validatePassword,
} from "../lib/corporateShared";

const router = Router();

function getJwtSecret(): string {
  const secret = String(process.env.JWT_SECRET || "").trim();
  if (!secret) {
    throw new Error("Missing JWT_SECRET");
  }
  return secret;
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

function rolePermissions(role: string): string[] {
  if (role === "admin") return ["corp:admin", "corp:invite:create", "corp:invite:manage", "corp:member:manage"];
  if (role === "manager") return ["corp:invite:create", "corp:invite:manage", "corp:member:view"];
  if (role === "member") return ["corp:member:view"];
  return ["corp:viewer"];
}

async function getCorporateProfile(uid: string) {
  const [userSnap, corpUserSnap] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("corporateUsers").doc(uid).get(),
  ]);

  const user = (userSnap.data() || {}) as any;
  const corpUser = (corpUserSnap.data() || {}) as any;
  const corporateAccountId =
    String(corpUser.corporateAccountId || user.corporateAccountId || user.orgId || "").trim();

  if (!corporateAccountId) return null;

  const accountSnap = await db.collection("corporateAccounts").doc(corporateAccountId).get();
  const orgSnap = await db.collection("orgs").doc(corporateAccountId).get();
  const account = (accountSnap.data() || orgSnap.data() || {}) as any;

  const role = String(corpUser.role || user.role || "viewer");

  return {
    id: uid,
    email: normalizeEmail(corpUser.email || user.email),
    name: String(corpUser.name || user.displayName || "").trim(),
    role,
    permissions: rolePermissions(role),
    corporateAccountId,
    organizationId: corporateAccountId,
    corporateAccount: {
      id: corporateAccountId,
      name: String(account.name || "Corporate Account"),
      status: String(account.status || "active"),
      planId: String(account.planId || "free"),
      createdAt: account.createdAt || null,
      createdBy: account.createdBy || null,
    },
  };
}

router.post("/register", async (req, res) => {
  try {
    const body = (req.body || {}) as any;
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    const name = String(body.name || "").trim();
    const companyName = String(body.companyName || body.organizationName || "").trim();
    const inviteToken = String(body.inviteToken || "").trim();

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: "invalid_email" });
    }

    const passwordValidation = validatePassword(password);
    if (passwordValidation) {
      return res.status(400).json({ error: "invalid_password", message: passwordValidation });
    }

    if (!name) {
      return res.status(400).json({ error: "name_required" });
    }

    const existingUserByEmail = await db.collection("users").where("email", "==", email).limit(1).get();
    if (!existingUserByEmail.empty) {
      return res.status(409).json({ error: "email_already_exists" });
    }

    const now = Date.now();
    const passwordHash = await bcrypt.hash(password, 10);

    let corporateAccountId = "";
    let role: "admin" | "manager" | "member" | "viewer" = "admin";
    let inviteId: string | null = null;

    if (inviteToken) {
      const inviteLookup = await findInviteByToken(inviteToken);
      if (!inviteLookup) {
        return res.status(400).json({ error: "invalid_invite_token" });
      }

      inviteId = inviteLookup.inviteId;
      const invite = inviteLookup.invite as any;
      if (String(invite.status || "") !== "pending") {
        return res.status(400).json({ error: "invite_not_usable" });
      }

      const invitedEmail = normalizeEmail(invite.invitedEmail);
      if (invitedEmail !== email) {
        return res.status(400).json({ error: "invite_email_mismatch" });
      }

      const expiresAt = typeof invite.expiresAt === "number" ? invite.expiresAt : null;
      if (typeof expiresAt === "number" && expiresAt <= now) {
        await db.collection("corporateInvites").doc(inviteId).set(
          { status: "expired", updatedAt: now },
          { merge: true }
        );
        return res.status(400).json({ error: "invite_expired" });
      }

      corporateAccountId = String(invite.corporateAccountId || invite.organizationId || "").trim();
      const parsedRole = coerceCorporateRole(invite.invitedRole);
      role = parsedRole || "member";

      if (!corporateAccountId) {
        return res.status(400).json({ error: "invite_missing_account" });
      }
    } else {
      if (!companyName) {
        return res.status(400).json({ error: "company_name_required" });
      }
      corporateAccountId = db.collection("corporateAccounts").doc().id;
      role = "admin";
    }

    const userRef = db.collection("users").doc();
    const uid = userRef.id;

    const userData = buildNewUserDoc({
      email,
      passwordHash,
      displayName: name,
      nowMs: now,
      tosAcceptedIp: req.ip || undefined,
      tosUserAgent: req.get("user-agent") || undefined,
    });

    await userRef.set({
      ...userData,
      orgType: "corporate",
      orgId: corporateAccountId,
      corporateAccountId,
      role,
      status: "active",
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });

    if (!inviteToken) {
      const accountDoc = {
        id: corporateAccountId,
        name: companyName,
        status: "active",
        planId: "free",
        createdAt: now,
        createdBy: uid,
        updatedAt: now,
      };

      await Promise.all([
        db.collection("corporateAccounts").doc(corporateAccountId).set(accountDoc, { merge: true }),
        db.collection("orgs").doc(corporateAccountId).set(
          {
            id: corporateAccountId,
            name: companyName,
            orgType: "corporate",
            status: "active",
            planId: "free",
            createdAt: now,
            createdBy: uid,
            updatedAt: now,
          },
          { merge: true }
        ),
      ]);
    }

    await upsertCorporateUser({
      uid,
      corporateAccountId,
      email,
      name,
      role,
      status: "active",
      createdBy: inviteToken ? "invite" : uid,
      now,
    });

    if (inviteId) {
      await db.collection("corporateInvites").doc(inviteId).set(
        {
          status: "accepted",
          acceptedAt: now,
          acceptedBy: uid,
          updatedAt: now,
        },
        { merge: true }
      );
    }

    const token = jwt.sign({ uid }, getJwtSecret(), { expiresIn: "7d" });
    res.cookie("token", token, cookieOptions());

    const profile = await getCorporateProfile(uid);
    return res.json({ token, user: profile });
  } catch (err: any) {
    console.error("[corporate/auth/register] failed", err?.message || err);
    return res.status(500).json({ error: "register_failed" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const email = normalizeEmail((req.body || {}).email);
    const password = String((req.body || {}).password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "missing_credentials" });
    }

    const userSnap = await db.collection("users").where("email", "==", email).limit(1).get();
    if (userSnap.empty) {
      return res.status(401).json({ error: "invalid_credentials" });
    }

    const userDoc = userSnap.docs[0];
    const user = userDoc.data() as any;

    const passwordHash = String(user.passwordHash || "");
    if (!passwordHash) {
      return res.status(401).json({ error: "invalid_credentials" });
    }

    const passwordMatches = await bcrypt.compare(password, passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({ error: "invalid_credentials" });
    }

    const uid = userDoc.id;
    const profile = await getCorporateProfile(uid);

    if (!profile || !profile.corporateAccountId) {
      return res.status(403).json({ error: "not_corporate_user" });
    }

    await Promise.all([
      db.collection("users").doc(uid).set({ lastLoginAt: Date.now(), updatedAt: Date.now() }, { merge: true }),
      db.collection("corporateUsers").doc(uid).set({ lastLoginAt: Date.now(), updatedAt: Date.now() }, { merge: true }),
    ]);

    const token = jwt.sign({ uid }, getJwtSecret(), { expiresIn: "7d" });
    res.cookie("token", token, cookieOptions());

    return res.json({ token, user: profile });
  } catch (err: any) {
    console.error("[corporate/auth/login] failed", err?.message || err);
    return res.status(500).json({ error: "login_failed" });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  try {
    const uid = String((req as any).user?.uid || "").trim();
    if (!uid) return res.status(401).json({ error: "unauthorized" });

    const profile = await getCorporateProfile(uid);
    if (!profile) return res.status(404).json({ error: "corporate_profile_not_found" });

    return res.json(profile);
  } catch (err: any) {
    console.error("[corporate/auth/me] failed", err?.message || err);
    return res.status(500).json({ error: "me_failed" });
  }
});

router.post("/logout", (_req, res) => {
  res.clearCookie("token", { path: "/" });
  return res.json({ ok: true });
});

export default router;
