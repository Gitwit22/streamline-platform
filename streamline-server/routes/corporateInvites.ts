import { Router } from "express";
import bcrypt from "bcryptjs";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth, tryGetAuthUserAny } from "../middleware/requireAuth";
import { getCorpOrgContext } from "../lib/corpOrg";
import { buildNewUserDoc } from "../lib/newUserDefaults";
import { sendCorporateInviteEmail } from "../lib/corporateEmail";
import {
  coerceCorporateRole,
  findInviteByToken,
  generateInviteToken,
  hashInviteToken,
  isValidEmail,
  normalizeEmail,
  upsertCorporateUser,
  validatePassword,
} from "../lib/corporateShared";

const router = Router();

function isCorpAdmin(role: string | null | undefined): boolean {
  return String(role || "") === "admin";
}

function getInviteBaseUrl(): string {
  const configured = String(process.env.CORPORATE_INVITE_BASE_URL || "").trim();
  if (configured) return configured.replace(/\/$/, "");

  const clientBase = String(process.env.CLIENT_URL || "http://localhost:5173").trim().replace(/\/$/, "");
  return `${clientBase}/corporate/invite`;
}

async function requireCorporateAdmin(uid: string) {
  const ctx = await getCorpOrgContext(uid);
  if (!ctx) return { ok: false as const, status: 403, error: "not_corporate_member" };
  if (!isCorpAdmin(ctx.orgRole)) return { ok: false as const, status: 403, error: "insufficient_permissions" };
  return { ok: true as const, ctx };
}

async function hydrateInviteDoc(id: string, raw: any) {
  const now = Date.now();
  const invite = { ...(raw || {}) };
  const expiresAt =
    typeof invite.expiresAt === "number"
      ? invite.expiresAt
      : invite.expiresAt && typeof invite.expiresAt.toMillis === "function"
        ? invite.expiresAt.toMillis()
        : null;

  if (String(invite.status || "pending") === "pending" && typeof expiresAt === "number" && expiresAt <= now) {
    invite.status = "expired";
    invite.updatedAt = now;
    await db.collection("corporateInvites").doc(id).set({ status: "expired", updatedAt: now }, { merge: true });
  }

  return invite;
}

router.post("/invites", requireAuth, async (req, res) => {
  try {
    const uid = String((req as any).user?.uid || "").trim();
    if (!uid) return res.status(401).json({ error: "unauthorized" });

    const authz = await requireCorporateAdmin(uid);
    if (!authz.ok) return res.status(authz.status).json({ error: authz.error });

    const invitedEmail = normalizeEmail((req.body || {}).invitedEmail || (req.body || {}).email);
    const invitedRole = coerceCorporateRole((req.body || {}).invitedRole || (req.body || {}).role) || "member";

    if (!invitedEmail || !isValidEmail(invitedEmail)) {
      return res.status(400).json({ error: "invalid_email" });
    }

    const now = Date.now();
    const expiresAt = now + 7 * 24 * 60 * 60 * 1000;

    const duplicateSnap = await db
      .collection("corporateInvites")
      .where("corporateAccountId", "==", authz.ctx.orgId)
      .where("invitedEmail", "==", invitedEmail)
      .where("status", "==", "pending")
      .limit(10)
      .get();

    for (const doc of duplicateSnap.docs) {
      const invite = await hydrateInviteDoc(doc.id, doc.data() || {});
      const inviteExpiresAt = typeof invite.expiresAt === "number" ? invite.expiresAt : 0;
      if (invite.status === "pending" && inviteExpiresAt > now) {
        return res.status(409).json({ error: "duplicate_active_invite" });
      }
    }

    const token = generateInviteToken();
    const tokenHash = hashInviteToken(token);
    const inviteRef = db.collection("corporateInvites").doc();
    const inviteId = inviteRef.id;

    const inviteDoc = {
      id: inviteId,
      inviteId,
      corporateAccountId: authz.ctx.orgId,
      organizationId: authz.ctx.orgId,
      invitedEmail,
      invitedRole,
      status: "pending",
      tokenHash,
      expiresAt,
      createdBy: uid,
      createdAt: now,
      updatedAt: now,
      acceptedAt: null,
      revokedAt: null,
    };

    await inviteRef.set(inviteDoc);

    const inviteLink = `${getInviteBaseUrl()}/${encodeURIComponent(token)}`;

    const emailResult = await sendCorporateInviteEmail({
      to: invitedEmail,
      inviteLink,
      role: invitedRole,
      orgName: authz.ctx.orgName,
      expiresAtIso: new Date(expiresAt).toISOString(),
    });

    return res.json({
      ok: true,
      invite: {
        inviteId,
        corporateAccountId: authz.ctx.orgId,
        invitedEmail,
        invitedRole,
        status: "pending",
        expiresAt,
        createdBy: uid,
        createdAt: now,
      },
      email: emailResult,
    });
  } catch (err: any) {
    console.error("[corporate/invites:create] failed", err?.message || err);
    return res.status(500).json({ error: "invite_create_failed" });
  }
});

router.get("/invites", requireAuth, async (req, res) => {
  try {
    const uid = String((req as any).user?.uid || "").trim();
    if (!uid) return res.status(401).json({ error: "unauthorized" });

    const authz = await requireCorporateAdmin(uid);
    if (!authz.ok) return res.status(authz.status).json({ error: authz.error });

    const snap = await db
      .collection("corporateInvites")
      .where("corporateAccountId", "==", authz.ctx.orgId)
      .orderBy("createdAt", "desc")
      .limit(250)
      .get();

    const invites = [] as any[];
    for (const doc of snap.docs) {
      const invite = await hydrateInviteDoc(doc.id, doc.data() || {});
      invites.push({
        inviteId: doc.id,
        corporateAccountId: invite.corporateAccountId,
        invitedEmail: invite.invitedEmail,
        invitedRole: invite.invitedRole,
        status: invite.status,
        expiresAt: invite.expiresAt || null,
        acceptedAt: invite.acceptedAt || null,
        createdBy: invite.createdBy || null,
        createdAt: invite.createdAt || null,
        updatedAt: invite.updatedAt || null,
      });
    }

    return res.json({ invites });
  } catch (err: any) {
    console.error("[corporate/invites:list] failed", err?.message || err);
    return res.status(500).json({ error: "invite_list_failed" });
  }
});

router.post("/invites/:inviteId/resend", requireAuth, async (req, res) => {
  try {
    const uid = String((req as any).user?.uid || "").trim();
    if (!uid) return res.status(401).json({ error: "unauthorized" });

    const authz = await requireCorporateAdmin(uid);
    if (!authz.ok) return res.status(authz.status).json({ error: authz.error });

    const inviteId = String(req.params.inviteId || "").trim();
    if (!inviteId) return res.status(400).json({ error: "invite_id_required" });

    const inviteRef = db.collection("corporateInvites").doc(inviteId);
    const inviteSnap = await inviteRef.get();
    if (!inviteSnap.exists) return res.status(404).json({ error: "invite_not_found" });

    const invite = await hydrateInviteDoc(inviteId, inviteSnap.data() || {});
    if (invite.corporateAccountId !== authz.ctx.orgId) {
      return res.status(403).json({ error: "wrong_corporate_account" });
    }

    if (invite.status !== "pending") {
      return res.status(400).json({ error: "invite_not_pending" });
    }

    const now = Date.now();
    const token = generateInviteToken();
    const tokenHash = hashInviteToken(token);
    const expiresAt = now + 7 * 24 * 60 * 60 * 1000;

    await inviteRef.set(
      {
        tokenHash,
        expiresAt,
        resentAt: now,
        updatedAt: now,
      },
      { merge: true }
    );

    const inviteLink = `${getInviteBaseUrl()}/${encodeURIComponent(token)}`;

    const emailResult = await sendCorporateInviteEmail({
      to: normalizeEmail(invite.invitedEmail),
      inviteLink,
      role: String(invite.invitedRole || "member"),
      orgName: authz.ctx.orgName,
      expiresAtIso: new Date(expiresAt).toISOString(),
    });

    return res.json({ ok: true, email: emailResult });
  } catch (err: any) {
    console.error("[corporate/invites:resend] failed", err?.message || err);
    return res.status(500).json({ error: "invite_resend_failed" });
  }
});

router.post("/invites/:inviteId/revoke", requireAuth, async (req, res) => {
  try {
    const uid = String((req as any).user?.uid || "").trim();
    if (!uid) return res.status(401).json({ error: "unauthorized" });

    const authz = await requireCorporateAdmin(uid);
    if (!authz.ok) return res.status(authz.status).json({ error: authz.error });

    const inviteId = String(req.params.inviteId || "").trim();
    if (!inviteId) return res.status(400).json({ error: "invite_id_required" });

    const inviteRef = db.collection("corporateInvites").doc(inviteId);
    const inviteSnap = await inviteRef.get();
    if (!inviteSnap.exists) return res.status(404).json({ error: "invite_not_found" });

    const invite = inviteSnap.data() as any;
    if (String(invite.corporateAccountId || "") !== authz.ctx.orgId) {
      return res.status(403).json({ error: "wrong_corporate_account" });
    }

    await inviteRef.set(
      {
        status: "revoked",
        revokedAt: Date.now(),
        revokedBy: uid,
        updatedAt: Date.now(),
      },
      { merge: true }
    );

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[corporate/invites:revoke] failed", err?.message || err);
    return res.status(500).json({ error: "invite_revoke_failed" });
  }
});

router.get("/invites/validate/:token", async (req, res) => {
  try {
    const token = String(req.params.token || "").trim();
    if (!token) return res.status(400).json({ error: "token_required" });

    const inviteLookup = await findInviteByToken(token);
    if (!inviteLookup) return res.status(404).json({ error: "invite_not_found", usable: false });

    const inviteId = inviteLookup.inviteId;
    const invite = await hydrateInviteDoc(inviteId, inviteLookup.invite || {});
    const accountId = String(invite.corporateAccountId || invite.organizationId || "").trim();
    const accountSnap = accountId ? await db.collection("corporateAccounts").doc(accountId).get() : null;
    const account = (accountSnap?.data() || {}) as any;

    const status = String(invite.status || "pending");
    const usable = status === "pending";

    return res.json({
      usable,
      status,
      invite: {
        invitedEmail: normalizeEmail(invite.invitedEmail),
        invitedRole: String(invite.invitedRole || "member"),
        corporateAccountName: String(account.name || "Corporate Account"),
        expiresAt: invite.expiresAt || null,
      },
    });
  } catch (err: any) {
    console.error("[corporate/invites:validate] failed", err?.message || err);
    return res.status(500).json({ error: "invite_validate_failed", usable: false });
  }
});

router.post("/invites/accept", async (req, res) => {
  try {
    const token = String((req.body || {}).token || (req.body || {}).inviteToken || "").trim();
    if (!token) return res.status(400).json({ error: "token_required" });

    const inviteLookup = await findInviteByToken(token);
    if (!inviteLookup) return res.status(400).json({ error: "invalid_invite_token" });

    const inviteId = inviteLookup.inviteId;
    const invite = await hydrateInviteDoc(inviteId, inviteLookup.invite || {});

    if (String(invite.status || "") !== "pending") {
      return res.status(400).json({ error: "invite_not_usable" });
    }

    const now = Date.now();
    const accountId = String(invite.corporateAccountId || invite.organizationId || "").trim();
    const invitedRole = coerceCorporateRole(invite.invitedRole) || "member";
    const invitedEmail = normalizeEmail(invite.invitedEmail);

    if (!accountId || !invitedEmail) {
      return res.status(400).json({ error: "invite_corrupt" });
    }

    const authUser = await tryGetAuthUserAny(req as any);

    let uid = "";
    let name = "";

    if (authUser?.uid) {
      uid = String(authUser.uid);
      const userSnap = await db.collection("users").doc(uid).get();
      const user = (userSnap.data() || {}) as any;
      const userEmail = normalizeEmail(user.email);
      if (!userEmail || userEmail !== invitedEmail) {
        return res.status(403).json({ error: "invite_email_mismatch" });
      }
      name = String(user.displayName || user.name || "").trim() || "Corporate User";
    } else {
      const body = (req.body || {}) as any;
      const email = normalizeEmail(body.email);
      const password = String(body.password || "");
      const reqName = String(body.name || "").trim();

      if (!email || email !== invitedEmail) {
        return res.status(400).json({ error: "invite_email_mismatch" });
      }

      const passwordValidation = validatePassword(password);
      if (passwordValidation) {
        return res.status(400).json({ error: "invalid_password", message: passwordValidation });
      }

      const existingUserByEmail = await db.collection("users").where("email", "==", email).limit(1).get();
      if (!existingUserByEmail.empty) {
        const existingDoc = existingUserByEmail.docs[0];
        const existing = (existingDoc.data() || {}) as any;
        const hash = String(existing.passwordHash || "");
        if (!hash) return res.status(401).json({ error: "password_required_for_existing_user" });

        const passwordMatches = await bcrypt.compare(password, hash);
        if (!passwordMatches) return res.status(401).json({ error: "invalid_credentials" });

        uid = existingDoc.id;
        name = String(existing.displayName || reqName || "").trim() || "Corporate User";
      } else {
        uid = db.collection("users").doc().id;
        name = reqName || "Corporate User";

        const passwordHash = await bcrypt.hash(password, 10);
        const userData = buildNewUserDoc({
          email,
          passwordHash,
          displayName: name,
          nowMs: now,
          tosAcceptedIp: req.ip || undefined,
          tosUserAgent: req.get("user-agent") || undefined,
        });

        await db.collection("users").doc(uid).set(
          {
            ...userData,
            status: "active",
            createdAt: now,
            updatedAt: now,
          },
          { merge: true }
        );
      }
    }

    await upsertCorporateUser({
      uid,
      corporateAccountId: accountId,
      email: invitedEmail,
      name,
      role: invitedRole,
      status: "active",
      createdBy: String(invite.createdBy || "invite"),
      now,
    });

    await db.collection("corporateInvites").doc(inviteId).set(
      {
        status: "accepted",
        acceptedAt: now,
        acceptedBy: uid,
        updatedAt: now,
      },
      { merge: true }
    );

    return res.json({ ok: true, uid, corporateAccountId: accountId, role: invitedRole });
  } catch (err: any) {
    console.error("[corporate/invites:accept] failed", err?.message || err);
    return res.status(500).json({ error: "invite_accept_failed" });
  }
});

export default router;
