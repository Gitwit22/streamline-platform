import crypto from "crypto";
import admin from "firebase-admin";
import { firestore as db } from "../firebaseAdmin";

export type CorporateRole = "admin" | "manager" | "member" | "viewer";
export type CorporateInviteStatus = "pending" | "accepted" | "expired" | "revoked";

export function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function coerceCorporateRole(value: unknown): CorporateRole | null {
  const role = String(value || "").trim().toLowerCase();
  if (role === "admin" || role === "manager" || role === "member" || role === "viewer") {
    return role;
  }
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (!/[a-z]/.test(password)) return "Password must include at least one lowercase letter.";
  if (!/[A-Z]/.test(password)) return "Password must include at least one uppercase letter.";
  if (!/[0-9]/.test(password)) return "Password must include at least one number.";
  return null;
}

export function hashInviteToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateInviteToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export async function ensureInviteStatus(inviteId: string, rawInvite: any) {
  const now = Date.now();
  const status = String(rawInvite?.status || "pending") as CorporateInviteStatus;
  const expiresAtMs =
    typeof rawInvite?.expiresAt === "number"
      ? rawInvite.expiresAt
      : rawInvite?.expiresAt && typeof rawInvite.expiresAt.toMillis === "function"
        ? rawInvite.expiresAt.toMillis()
        : null;

  if (status === "pending" && typeof expiresAtMs === "number" && expiresAtMs <= now) {
    await db.collection("corporateInvites").doc(inviteId).set(
      {
        status: "expired",
        updatedAt: now,
      },
      { merge: true }
    );
    return { ...rawInvite, status: "expired", updatedAt: now };
  }

  return rawInvite;
}

export async function findInviteByToken(token: string) {
  const tokenHash = hashInviteToken(token);
  const snap = await db
    .collection("corporateInvites")
    .where("tokenHash", "==", tokenHash)
    .limit(1)
    .get();

  if (snap.empty) return null;
  const doc = snap.docs[0];
  const data = await ensureInviteStatus(doc.id, doc.data() || {});
  return { inviteId: doc.id, invite: data };
}

export async function upsertCorporateUser(input: {
  uid: string;
  corporateAccountId: string;
  email: string;
  name: string;
  role: CorporateRole;
  status?: "active" | "disabled";
  createdBy?: string;
  now?: number;
}) {
  const now = typeof input.now === "number" ? input.now : Date.now();
  const memberId = `${input.corporateAccountId}_${input.uid}`;

  await Promise.all([
    db.collection("corporateUsers").doc(input.uid).set(
      {
        id: input.uid,
        corporateAccountId: input.corporateAccountId,
        organizationId: input.corporateAccountId,
        name: input.name,
        email: normalizeEmail(input.email),
        role: input.role,
        status: input.status || "active",
        createdAt: now,
        updatedAt: now,
        ...(input.createdBy ? { createdBy: input.createdBy } : {}),
      },
      { merge: true }
    ),
    db.collection("orgMembers").doc(memberId).set(
      {
        orgId: input.corporateAccountId,
        uid: input.uid,
        name: input.name,
        email: normalizeEmail(input.email),
        role: input.role,
        status: input.status || "active",
        joinedAt: now,
        updatedAt: now,
        ...(input.createdBy ? { invitedBy: input.createdBy } : {}),
      },
      { merge: true }
    ),
    db.collection("users").doc(input.uid).set(
      {
        orgType: "corporate",
        orgId: input.corporateAccountId,
        corporateAccountId: input.corporateAccountId,
        role: input.role,
        email: normalizeEmail(input.email),
        displayName: input.name,
        updatedAt: now,
        lastLoginAt: now,
      },
      { merge: true }
    ),
  ]);
}

export function serverTimestamp() {
  return admin.firestore.FieldValue.serverTimestamp();
}
