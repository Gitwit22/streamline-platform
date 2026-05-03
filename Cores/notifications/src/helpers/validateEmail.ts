/**
 * Email address validation and normalisation helpers.
 */

/**
 * Returns true when the value looks like a valid email address.
 *
 * Uses a structural check rather than a complex regex to avoid ReDoS
 * vulnerabilities while still catching obviously invalid inputs.
 */
export function isValidEmail(email: unknown): email is string {
  if (typeof email !== "string") return false;
  const trimmed = email.trim();
  if (!trimmed) return false;

  // Must have exactly one "@" character
  const atIndex = trimmed.indexOf("@");
  if (atIndex <= 0) return false;
  if (trimmed.indexOf("@", atIndex + 1) !== -1) return false;

  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);

  // Local part must be non-empty; domain must have at least one dot
  if (!local || !domain) return false;
  const dotIndex = domain.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex >= domain.length - 1) return false;

  // Reject whitespace anywhere in the address
  if (/\s/.test(trimmed)) return false;

  return true;
}

/**
 * Normalises an email for storage and comparison.
 * Trims whitespace and lowercases the entire address.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
