import { apiFetchAuth } from "../../lib/api";

export type EduOrgSettings = {
  id: string;
  name: string;
  branding: {
    logoDataUrl: string | null;
    accentColor: string | null;
    playerTitleText: string | null;
  };
  defaults: {
    publishToWebsite: boolean;
    recordToArchive: boolean;
    defaultLayout: "grid" | "speaker";
    studentProducersCanStart: boolean;
    requireAssignmentToStart: boolean;
  };
  accessPolicy: {
    embedVisibility: "public" | "unlisted";
    restrictedToSchoolLogin: "coming_soon";
  };
  retentionDays: number | null;
};

export type EduStorageSummary = {
  recordingsCount: number;
  storageBytes: number;
  updatedAt: number;
};

export type EduAuditAction = {
  id: string;
  action: string;
  actorUid: string;
  actorName: string;
  eventId: string | null;
  eventTitle: string | null;
  targetId: string | null;
  createdAt: number | null;
};

async function readJson<T>(res: Response): Promise<T> {
  const payload = await res.json().catch(() => null);
  return payload as T;
}

export async function fetchEduOrg(): Promise<EduOrgSettings> {
  const res = await apiFetchAuth("/api/edu/org", {}, { allowNonOk: true });
  if (!res.ok) {
    const body: any = await readJson(res);
    throw new Error(String(body?.error || body?.message || `HTTP ${res.status}`));
  }
  const body: any = await readJson(res);
  if (!body?.ok || !body?.org) throw new Error("Invalid org response");
  return body.org as EduOrgSettings;
}

export async function patchEduOrg(patch: Partial<EduOrgSettings>): Promise<EduOrgSettings> {
  const res = await apiFetchAuth(
    "/api/edu/org",
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    },
    { allowNonOk: true }
  );

  if (!res.ok) {
    const body: any = await readJson(res);
    throw new Error(String(body?.error || body?.message || `HTTP ${res.status}`));
  }

  const body: any = await readJson(res);
  if (!body?.ok || !body?.org) throw new Error("Invalid org response");
  return body.org as EduOrgSettings;
}

export async function fetchEduStorageSummary(): Promise<EduStorageSummary> {
  const res = await apiFetchAuth("/api/edu/storage-summary", {}, { allowNonOk: true });
  if (!res.ok) {
    const body: any = await readJson(res);
    throw new Error(String(body?.error || body?.message || `HTTP ${res.status}`));
  }
  const body: any = await readJson(res);
  if (!body?.ok) throw new Error("Invalid storage summary response");
  return {
    recordingsCount: Number(body.recordingsCount || 0),
    storageBytes: Number(body.storageBytes || 0),
    updatedAt: Number(body.updatedAt || 0),
  };
}

export async function fetchEduAudit(limit = 10): Promise<EduAuditAction[]> {
  const res = await apiFetchAuth(`/api/edu/audit?limit=${encodeURIComponent(String(limit))}`, {}, { allowNonOk: true });
  if (!res.ok) {
    const body: any = await readJson(res);
    throw new Error(String(body?.error || body?.message || `HTTP ${res.status}`));
  }
  const body: any = await readJson(res);
  if (!body?.ok || !Array.isArray(body.actions)) throw new Error("Invalid audit response");
  return body.actions as EduAuditAction[];
}

export async function postEduAudit(input: {
  action: string;
  eventId?: string | null;
  eventTitle?: string | null;
  targetId?: string | null;
}): Promise<void> {
  const res = await apiFetchAuth(
    "/api/edu/audit",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    { allowNonOk: true }
  );

  if (!res.ok) {
    const body: any = await readJson(res);
    throw new Error(String(body?.error || body?.message || `HTTP ${res.status}`));
  }
}
