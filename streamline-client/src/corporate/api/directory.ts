import { apiFetchAuth } from "@/lib/api";

/* ── Types ──────────────────────────────────────────────────────── */

export interface DirectoryMember {
  uid: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  jobTitle: string;
  department: string;
  location: string;
  photoURL: string;
  bio: string;
  managerUserId: string | null;
  joinedAt: number | null;
}

export interface DirectoryResult {
  members: DirectoryMember[];
  departments: string[];
}

export interface ProfilePatch {
  targetUid?: string;
  jobTitle?: string;
  department?: string;
  location?: string;
  bio?: string;
  photoURL?: string;
  displayName?: string;
}

/* ── API calls ──────────────────────────────────────────────────── */

export async function fetchDirectory(): Promise<DirectoryResult> {
  const res = await apiFetchAuth("/api/corp/orgs/directory");
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "directory_failed");
  return body;
}

export async function updateProfile(patch: ProfilePatch): Promise<void> {
  const res = await apiFetchAuth("/api/corp/orgs/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "profile_update_failed");
  }
}

export async function setManager(targetUid: string, managerUserId: string | null): Promise<void> {
  const res = await apiFetchAuth("/api/corp/orgs/set-manager", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetUid, managerUserId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || body.message || "set_manager_failed");
  }
}
