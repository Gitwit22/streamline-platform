import { apiFetchAuth } from "@/lib/api";

export interface OrgUser {
  id: string;
  uid: string;
  name: string;
  email: string;
  role: string;
  status: string;
  department: string;
  lastActiveAt: number | null;
  joinedAt: number | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  actorUid: string;
  actorName: string;
  targetId: string;
  meta: any;
  createdAt: number | null;
}

export interface OrgSettings {
  orgId: string;
  name: string;
  orgType: string;
  timezone: string;
  branding: any;
  retentionDays: number;
  ssoEnabled: boolean;
  ssoProvider: string;
  mfaRequired: boolean;
  defaultRole: string;
}

export interface AnalyticsOverview {
  overview: {
    totalBroadcasts: number;
    liveBroadcasts: number;
    scheduledBroadcasts: number;
    completedBroadcasts: number;
    totalCalls: number;
    activeCalls: number;
    totalTrainingModules: number;
    avgCompletionRate: number;
    totalMembers: number;
    activeMembers: number;
    totalMessages: number;
  };
  departments: Array<{ name: string; complianceRate: number; totalModules: number }>;
}

export async function fetchUsers(params?: {
  search?: string;
  role?: string;
  status?: string;
  limit?: number;
}): Promise<{ users: OrgUser[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set("search", params.search);
  if (params?.role) qs.set("role", params.role);
  if (params?.status) qs.set("status", params.status);
  if (params?.limit) qs.set("limit", String(params.limit));
  const url = `/api/corp/admin/users${qs.toString() ? "?" + qs : ""}`;
  const res = await apiFetchAuth(url);
  if (!res.ok) throw new Error("fetch_users_failed");
  return res.json();
}

export async function updateUserRole(
  memberId: string,
  role: string
): Promise<void> {
  const res = await apiFetchAuth(`/api/corp/admin/users/${memberId}/role`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "update_role_failed");
  }
}

export async function inviteUser(body: {
  email: string;
  name?: string;
  role?: string;
  department?: string;
}): Promise<{ inviteId: string }> {
  const res = await apiFetchAuth("/api/corp/admin/users/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "invite_failed");
  }
  return res.json();
}

export async function fetchAuditLog(params?: {
  limit?: number;
  action?: string;
}): Promise<{ entries: AuditEntry[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.action) qs.set("action", params.action);
  const url = `/api/corp/admin/audit${qs.toString() ? "?" + qs : ""}`;
  const res = await apiFetchAuth(url);
  if (!res.ok) throw new Error("fetch_audit_failed");
  return res.json();
}

export async function fetchSettings(): Promise<OrgSettings> {
  const res = await apiFetchAuth("/api/corp/admin/settings");
  if (!res.ok) throw new Error("fetch_settings_failed");
  return res.json();
}

export async function updateSettings(
  body: Partial<Pick<OrgSettings, "name" | "timezone" | "retentionDays" | "ssoEnabled" | "ssoProvider" | "mfaRequired" | "defaultRole">>
): Promise<void> {
  const res = await apiFetchAuth("/api/corp/admin/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("update_settings_failed");
}

export async function fetchAnalytics(): Promise<AnalyticsOverview> {
  const res = await apiFetchAuth("/api/corp/admin/analytics");
  if (!res.ok) throw new Error("fetch_analytics_failed");
  return res.json();
}
