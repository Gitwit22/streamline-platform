const STORAGE_KEY = "sl_displayName";

/**
 * Sanitize a display name: strip non-printable / special chars, keep safe set.
 */
export function sanitizeDisplayName(input: string): string {
  if (!input) return "";
  return input.replace(/[^A-Za-z0-9 \-\u2013'&]/g, "").slice(0, 50);
}

/**
 * Persist a display name to localStorage so it survives across sessions.
 */
export function persistDisplayName(name: string): void {
  try {
    const safe = sanitizeDisplayName(name).trim();
    if (safe) localStorage.setItem(STORAGE_KEY, safe);
  } catch { /* quota / private-mode */ }
}

/**
 * Read persisted display name from localStorage.
 */
export function getPersistedDisplayName(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

/**
 * Resolve the best display name from available sources, in priority order:
 *   1. Authenticated user profile displayName
 *   2. Previously persisted name (localStorage)
 *   3. Empty string (user must enter one)
 */
export function resolveDisplayName(
  profileDisplayName?: string | null,
): string {
  // Priority 1: logged-in user profile
  if (profileDisplayName && profileDisplayName.trim()) {
    return sanitizeDisplayName(profileDisplayName.trim());
  }
  // Priority 2: persisted from a previous session
  const persisted = getPersistedDisplayName();
  if (persisted) return persisted;
  // Priority 3: empty — user must type one
  return "";
}
