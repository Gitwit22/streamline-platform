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

/* ── Members ──────────────────────────────────────────────────────── */

export interface OrgMember {
  uid: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  joinedAt: number | null;
  jobTitle?: string;
  department?: string;
  location?: string;
  managerUserId?: string | null;
}

export async function getOrgMembers(): Promise<OrgMember[]> {
  const res = await apiFetchAuth("/api/corp/orgs/members");
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "members_failed");
  return body.members;
}

export async function regenerateJoinCode(): Promise<string> {
  const res = await apiFetchAuth("/api/corp/orgs/regenerate-code", {
    method: "POST",
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "regenerate_failed");
  return body.joinCode;
}

export async function removeMember(targetUid: string): Promise<void> {
  const res = await apiFetchAuth("/api/corp/orgs/remove-member", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetUid }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "remove_failed");
  }
}

export async function changeMemberRole(targetUid: string, newRole: string): Promise<{ uid: string; role: string }> {
  const res = await apiFetchAuth("/api/corp/orgs/change-role", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetUid, newRole }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "role_change_failed");
  return body;
}
