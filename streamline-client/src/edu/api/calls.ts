import { apiFetchAuth } from "@/lib/api";

/* ── Types ─────────────────────────────────────────────────────── */

export interface EduCall {
  id: string;
  title: string;
  status: "active" | "scheduled" | "completed";
  scheduledAt: number | null;
  startedAt: number | null;
  endedAt: number | null;
  duration: number | null;
  participants: string[];
  department: string;
  hasRecording: boolean;
  hasTranscript: boolean;
  recordingUrl: string;
  createdAt: number | null;
  createdBy: string;
}

/* ── API ───────────────────────────────────────────────────────── */

export async function fetchEduCalls(params?: {
  status?: string;
  hasRecording?: boolean;
  limit?: number;
}): Promise<EduCall[]> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.hasRecording !== undefined) qs.set("hasRecording", String(params.hasRecording));
  if (params?.limit) qs.set("limit", String(params.limit));
  const url = `/api/edu/calls${qs.toString() ? "?" + qs : ""}`;
  const res = await apiFetchAuth(url);
  if (!res.ok) throw new Error("fetch_calls_failed");
  const data = await res.json();
  return data.calls;
}

export async function createEduCall(body: {
  title: string;
  scheduledAt?: number;
  participants?: string[];
  department?: string;
}): Promise<EduCall> {
  const res = await apiFetchAuth("/api/edu/calls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "create_call_failed");
  }
  const data = await res.json();
  return data.call;
}

export async function updateEduCall(
  id: string,
  body: Partial<Pick<EduCall, "status" | "title" | "hasRecording" | "hasTranscript">>,
): Promise<EduCall> {
  const res = await apiFetchAuth(`/api/edu/calls/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "update_call_failed");
  }
  const data = await res.json();
  return data.call;
}

/* ── Pending / incoming calls for the current user ─────────────── */

export interface PendingEduCall extends EduCall {
  callerName: string;
  targetUserId: string;
}

export async function fetchPendingEduCalls(): Promise<PendingEduCall[]> {
  const res = await apiFetchAuth("/api/edu/calls/pending");
  if (!res.ok) return [];
  const data = await res.json();
  return data.calls ?? [];
}

export async function dismissEduCall(id: string): Promise<void> {
  await apiFetchAuth(`/api/edu/calls/${id}/dismiss`, { method: "PATCH" });
}
