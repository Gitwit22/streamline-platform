import { apiFetchAuth, apiFetch } from "@/lib/api";

/* ── Types ──────────────────────────────────────────────────────── */

export interface OrgCreateResult {
  orgId: string;
  name: string;
  slug: string;
  joinCode: string;
  role: string;
}

export interface OrgJoinResult {
  orgId: string;
  orgName: string;
  role: string;
}

export interface OrgLookupResult {
  exists: boolean;
  slug: string;
  name?: string;
}

export interface OrgInfoResult {
  orgId: string;
  name: string;
  slug: string;
  joinCode: string;
  defaultRole: string;
}

/* ── API calls ──────────────────────────────────────────────────── */

export async function createOrg(name: string, slug: string): Promise<OrgCreateResult> {
  const res = await apiFetchAuth("/api/corp/orgs/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, slug }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || body.message || "org_create_failed");
  return body;
}

export async function joinOrg(slug: string, joinCode: string): Promise<OrgJoinResult> {
  const res = await apiFetchAuth("/api/corp/orgs/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, joinCode }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || body.message || "org_join_failed");
  return body;
}

export async function lookupOrg(slug: string): Promise<OrgLookupResult> {
  const res = await apiFetch(`/api/corp/orgs/lookup?slug=${encodeURIComponent(slug)}`);
  if (!res.ok) throw new Error("lookup_failed");
  return res.json();
}

export async function getOrgInfo(): Promise<OrgInfoResult> {
  const res = await apiFetchAuth("/api/corp/orgs/info");
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "org_info_failed");
  return body;
}
