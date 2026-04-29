/**
 * Email address validation and normalisation helpers.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns true when the value looks like a valid email address. */
export function isValidEmail(email: unknown): email is string {
  if (typeof email !== "string") return false;
  const trimmed = email.trim();
  if (!trimmed) return false;
  return EMAIL_RE.test(trimmed);
}

/**
 * Normalises an email for storage and comparison.
 * Trims whitespace and lowercases the entire address.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
