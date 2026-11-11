/**
 * Account emails (password reset link, email verification): token rules,
 * link building and message content. Pure; unit-tested in
 * accountEmailPure.test.ts. Side effects live in accountEmail.ts.
 *
 * Tokens are 32 random bytes (base64url). Only their sha256 is stored, as the
 * Firestore doc id, so a database read can't be turned into a working link.
 */
import crypto from "crypto";
import { escapeHtml } from "./ppvCodeEmailPure";

export type AccountEmailPurpose = "password_reset" | "verify_email";

export const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60_000; // 1 hour
export const VERIFY_EMAIL_TOKEN_TTL_MS = 72 * 60 * 60_000; // 3 days

const TOKEN_BYTES = 32;
/** base64url of 32 bytes, no padding. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function tokenTtlMs(purpose: AccountEmailPurpose): number {
  return purpose === "password_reset" ? PASSWORD_RESET_TOKEN_TTL_MS : VERIFY_EMAIL_TOKEN_TTL_MS;
}

export function generateAccountEmailToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

export function isWellFormedAccountEmailToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token.trim());
}

export function hashAccountEmailToken(token: string): string {
  return crypto.createHash("sha256").update(String(token).trim()).digest("hex");
}

export function normalizeEmail(v: unknown): string {
  return String(v || "").trim().toLowerCase();
}

/** Base URL of the web app, without a trailing slash; null when unset or not http(s). */
export function clientBaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  const raw = String(env.CLIENT_URL || "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^\s]+$/i.test(raw) ? raw : null;
}

/**
 * The token goes in the URL fragment: fragments are never sent to servers or
 * in the Referer header, so the token stays out of hosting and proxy logs.
 */
export function buildAccountEmailLink(baseUrl: string, purpose: AccountEmailPurpose, token: string): string {
  const path = purpose === "password_reset" ? "/reset-password" : "/verify-email";
  return `${baseUrl}${path}#token=${encodeURIComponent(token)}`;
}

export type StoredAccountEmailToken = {
  uid: string;
  purpose: AccountEmailPurpose;
  email: string;
  createdAtMs: number;
  expiresAtMs: number;
  usedAtMs: number | null;
};

export type TokenRejection = "invalid" | "expired" | "used" | "superseded";

/**
 * Whether a stored token may be used now for `purpose` on this user.
 * - The user must still exist, not be deleted, and still own the address the
 *   link was sent to (a changed email voids old links).
 * - Password reset links also die when sessions were revoked after they were
 *   issued (another reset, admin "sign out everywhere", account deletion).
 */
export function evaluateAccountEmailToken(
  token: Partial<StoredAccountEmailToken> | null | undefined,
  purpose: AccountEmailPurpose,
  user: any,
  now: number
): { ok: true } | { ok: false; reason: TokenRejection } {
  if (!token || token.purpose !== purpose || typeof token.uid !== "string" || !token.uid) {
    return { ok: false, reason: "invalid" };
  }
  if (!user || isDeletedUser(user)) return { ok: false, reason: "invalid" };
  if (!token.email || normalizeEmail(user.email) !== normalizeEmail(token.email)) {
    return { ok: false, reason: "invalid" };
  }
  if (typeof token.usedAtMs === "number" && token.usedAtMs > 0) return { ok: false, reason: "used" };
  if (typeof token.expiresAtMs !== "number" || now > token.expiresAtMs) return { ok: false, reason: "expired" };
  if (purpose === "password_reset") {
    const revokedAt = typeof user.authRevokedAtMs === "number" ? user.authRevokedAtMs : 0;
    const createdAt = typeof token.createdAtMs === "number" ? token.createdAtMs : 0;
    if (revokedAt > 0 && createdAt < revokedAt) return { ok: false, reason: "superseded" };
  }
  return { ok: true };
}

function isDeletedUser(user: any): boolean {
  if (String(user?.accountStatus || "").toLowerCase() === "deleted") return true;
  const deletedAtMs =
    typeof user?.deletedAtMs === "number" ? user.deletedAtMs : typeof user?.deletedAt === "number" ? user.deletedAt : 0;
  return deletedAtMs > 0;
}

export function isEmailVerified(user: any): boolean {
  return user?.emailVerified === true;
}

type EmailContent = { subject: string; html: string; text: string };

function layout(title: string, paragraphs: string[], button: { label: string; url: string }, footer: string): string {
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>
${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n")}
<p style="margin:20px 0"><a href="${escapeHtml(button.url)}" style="display:inline-block;background:#dc2626;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">${escapeHtml(button.label)}</a></p>
<p style="color:#666;font-size:13px">If the button doesn't work, copy this link into your browser:<br><span style="word-break:break-all">${escapeHtml(button.url)}</span></p>
<p style="color:#666;font-size:13px">${escapeHtml(footer)}</p>
</body></html>`;
}

export function buildPasswordResetEmail(input: { link: string }): EmailContent {
  const minutes = Math.round(PASSWORD_RESET_TOKEN_TTL_MS / 60_000);
  const subject = "Reset your StreamLine password";
  const intro = "We received a request to reset the password for your StreamLine account.";
  const action = `Use the link below to choose a new password. It works once and expires in ${minutes} minutes.`;
  const footer = "If you didn't ask for this, you can ignore this email. Your password won't change.";
  const text = [intro, "", action, "", input.link, "", footer].join("\n");
  return { subject, text, html: layout(subject, [intro, action], { label: "Reset password", url: input.link }, footer) };
}

export function buildVerifyEmailEmail(input: { link: string }): EmailContent {
  const days = Math.round(VERIFY_EMAIL_TOKEN_TTL_MS / (24 * 60 * 60_000));
  const subject = "Confirm your StreamLine email";
  const intro = "Thanks for signing up for StreamLine.";
  const action = `Confirm this is your email address. The link expires in ${days} days.`;
  const footer = "If you didn't create a StreamLine account, you can ignore this email.";
  const text = [intro, "", action, "", input.link, "", footer].join("\n");
  return { subject, text, html: layout(subject, [intro, action], { label: "Confirm email", url: input.link }, footer) };
}
