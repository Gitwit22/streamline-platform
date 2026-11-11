/**
 * Account emails sent through Resend (lib/transactionalEmail.ts):
 *   - password reset link   (POST /api/auth/forgot-password/email)
 *   - email verification    (signup, POST /api/auth/verify-email/resend)
 *
 *   authEmailTokens/{sha256(token)}
 *     uid, purpose ("password_reset" | "verify_email"), email,
 *     createdAtMs, expiresAtMs, usedAtMs, ttlAt
 *
 * The raw token only exists in the email; it is never stored or logged.
 * Tokens are consumed inside a Firestore transaction, so a link works once
 * even when it is opened twice at the same time.
 */
import { firestore as db, auth as firebaseAuth } from "../firebaseAdmin";
import { emailConfig, maskEmail, sendTransactionalEmail, type SendResult } from "./transactionalEmail";
import {
  type AccountEmailPurpose,
  type StoredAccountEmailToken,
  type TokenRejection,
  buildAccountEmailLink,
  buildPasswordResetEmail,
  buildVerifyEmailEmail,
  clientBaseUrl,
  evaluateAccountEmailToken,
  generateAccountEmailToken,
  hashAccountEmailToken,
  isWellFormedAccountEmailToken,
  normalizeEmail,
  tokenTtlMs,
} from "./accountEmailPure";

const COLLECTION = "authEmailTokens";
/**
 * Fallback expiry for a Firestore TTL policy on `ttlAt`, if one is configured.
 * The hourly ephemeral-cleanup job deletes these docs a day after expiry anyway.
 */
const TOKEN_DOC_RETENTION_MS = 7 * 24 * 60 * 60_000;

function tokenRef(hash: string) {
  return db.collection(COLLECTION).doc(hash);
}

/** True when account emails can be sent: Resend configured and CLIENT_URL set (links need it). */
export function accountEmailAvailable(env: Record<string, string | undefined> = process.env): boolean {
  return emailConfig(env).enabled && clientBaseUrl(env) !== null;
}

/**
 * Create a single-use token for `uid` and email the link to `email`.
 * Returns the send result; on a failed send the unused token simply expires.
 */
export async function issueAndSendAccountEmail(input: {
  uid: string;
  email: string;
  purpose: AccountEmailPurpose;
}): Promise<SendResult> {
  const baseUrl = clientBaseUrl();
  if (!accountEmailAvailable() || !baseUrl) return { ok: false, retryable: true, error: "email_disabled" };

  const email = normalizeEmail(input.email);
  const token = generateAccountEmailToken();
  const hash = hashAccountEmailToken(token);
  const now = Date.now();
  const doc: StoredAccountEmailToken & { ttlAt: Date } = {
    uid: input.uid,
    purpose: input.purpose,
    email,
    createdAtMs: now,
    expiresAtMs: now + tokenTtlMs(input.purpose),
    usedAtMs: null,
    ttlAt: new Date(now + TOKEN_DOC_RETENTION_MS),
  };
  await tokenRef(hash).create(doc);

  const link = buildAccountEmailLink(baseUrl, input.purpose, token);
  const content = input.purpose === "password_reset" ? buildPasswordResetEmail({ link }) : buildVerifyEmailEmail({ link });
  const result = await sendTransactionalEmail({
    to: email,
    subject: content.subject,
    html: content.html,
    text: content.text,
    // One key per token: a retried request can't send the same link twice,
    // and a new request (new token) is never deduped against an old one.
    idempotencyKey: `auth_${input.purpose}_${hash.slice(0, 40)}`,
    tag: input.purpose,
  });
  if (result.ok === false) {
    console.warn("[account-email] send failed", { purpose: input.purpose, to: maskEmail(email), error: result.error });
  }
  return result;
}

export type ConsumeResult =
  | { ok: true; uid: string; email: string; user: any }
  | { ok: false; reason: TokenRejection };

/**
 * Validate and consume a token in one transaction. `applyToUser` returns the
 * user-doc fields to merge in the same transaction (so the password change or
 * verification and the token's use can't happen one without the other).
 */
export async function consumeAccountEmailToken(
  rawToken: unknown,
  purpose: AccountEmailPurpose,
  applyToUser: (user: any, now: number) => Record<string, unknown>
): Promise<ConsumeResult> {
  if (!isWellFormedAccountEmailToken(rawToken)) return { ok: false, reason: "invalid" };
  const ref = tokenRef(hashAccountEmailToken(rawToken));
  const now = Date.now();

  return db.runTransaction<ConsumeResult>(async (tx) => {
    const tokenSnap = await tx.get(ref);
    const token = tokenSnap.exists ? ((tokenSnap.data() || {}) as StoredAccountEmailToken) : null;
    if (!token || typeof token.uid !== "string" || !token.uid) return { ok: false, reason: "invalid" };

    const userRef = db.collection("users").doc(token.uid);
    const userSnap = await tx.get(userRef);
    const user = userSnap.exists ? userSnap.data() || {} : null;

    const verdict = evaluateAccountEmailToken(token, purpose, user, now);
    if (verdict.ok === false) return { ok: false, reason: verdict.reason };

    tx.update(ref, { usedAtMs: now });
    tx.set(userRef, { ...applyToUser(user, now), updatedAt: now }, { merge: true });
    return { ok: true, uid: token.uid, email: token.email, user };
  });
}

/**
 * Mirror a confirmed address into Firebase Auth (publicPlayback matches PPV
 * purchases to signed-in viewers by Firebase's verified email). Best effort:
 * Firestore `users.emailVerified` stays the source of truth.
 */
export async function syncFirebaseEmailVerified(uid: string, email: string): Promise<void> {
  try {
    const fbUser = await firebaseAuth.getUser(uid);
    if (normalizeEmail(fbUser.email) !== normalizeEmail(email) || fbUser.emailVerified) return;
    await firebaseAuth.updateUser(uid, { emailVerified: true });
  } catch (err: any) {
    if (String(err?.code || "") !== "auth/user-not-found") {
      console.warn("[account-email] Firebase emailVerified sync failed:", err?.code || err?.message || err);
    }
  }
}
