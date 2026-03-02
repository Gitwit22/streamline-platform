import { apiFetchAuth } from "@/lib/api";

export interface Call {
  id: string;
  title: string;
  status: string;
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

export async function fetchCalls(params?: {
  status?: string;
  hasRecording?: boolean;
  limit?: number;
}): Promise<Call[]> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.hasRecording !== undefined) qs.set("hasRecording", String(params.hasRecording));
  if (params?.limit) qs.set("limit", String(params.limit));
  const url = `/api/corp/calls${qs.toString() ? "?" + qs : ""}`;
  const res = await apiFetchAuth(url);
  if (!res.ok) throw new Error("fetch_calls_failed");
  const data = await res.json();
  return data.calls;
}

export async function createCall(body: {
  title: string;
  scheduledAt?: number;
  participants?: string[];
  department?: string;
}): Promise<Call> {
  const res = await apiFetchAuth("/api/corp/calls", {
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

export async function updateCall(
  id: string,
  body: Partial<Pick<Call, "status" | "title" | "hasRecording" | "hasTranscript">>
): Promise<Call> {
  const res = await apiFetchAuth(`/api/corp/calls/${id}`, {
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

export interface Transcript {
  callId: string;
  transcript: string | null;
  segments: Array<{ speaker: string; text: string; timestamp: number }>;
}

export async function fetchTranscript(callId: string): Promise<Transcript> {
  const res = await apiFetchAuth(`/api/corp/calls/${callId}/transcript`);
  if (!res.ok) throw new Error("fetch_transcript_failed");
  return res.json();
}
