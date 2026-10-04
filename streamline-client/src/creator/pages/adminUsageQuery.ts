/**
 * Pure helpers for the /admin/usage page (unit-tested).
 */

export type UsageQueryInput = {
  plan?: string | null;
  /** Email prefix, searched server-side (users.emailLower). */
  emailPrefix?: string | null;
  cursor?: string | null;
  limit?: number;
};

/**
 * Relative API path for GET /api/admin/usage. Built with URLSearchParams
 * (not `new URL(...)`, which throws when VITE_API_BASE is empty/relative).
 */
export function buildUsagePath(input: UsageQueryInput): string {
  const qs = new URLSearchParams();
  qs.set("limit", String(Math.min(Math.max(Math.floor(input.limit ?? 50), 1), 200)));
  qs.set("counters", "0");
  if (input.plan && input.plan !== "all") qs.set("plan", input.plan);
  const prefix = (input.emailPrefix || "").trim().toLowerCase();
  if (prefix) qs.set("search", prefix);
  if (input.cursor) qs.set("cursor", input.cursor);
  return `/api/admin/usage?${qs.toString()}`;
}

/** Local filter over the loaded page; tolerant of rows without an email or name. */
export function filterUsageRows<T extends { email?: string | null; displayName?: string | null; userId?: string | null }>(
  rows: T[],
  query: string
): T[] {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) =>
    [r.email, r.displayName, r.userId].some((v) => typeof v === "string" && v.toLowerCase().includes(q))
  );
}

export type PlanOption = { id: string; name?: string };

/** Plan display name from the fetched plan list (falls back to the id). */
export function planLabel(plans: PlanOption[], id: string | null | undefined): string {
  const key = String(id || "free");
  const hit = plans.find((p) => p.id === key);
  return hit?.name || key;
}
