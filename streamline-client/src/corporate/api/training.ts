import { apiFetchAuth } from "@/lib/api";

export interface TrainingModule {
  id: string;
  title: string;
  description: string;
  department: string;
  type: string;
  status: string;
  durationMinutes: number;
  deadline: number | null;
  assignedTo: string;
  completionRate: number;
  totalAssigned: number;
  totalCompleted: number;
  icon: string;
  createdAt: number | null;
  createdBy: string;
  userProgress: number;
  userStatus: string;
  userCompletedAt: number | null;
}

export async function fetchTraining(params?: {
  filter?: string;
  limit?: number;
}): Promise<TrainingModule[]> {
  const qs = new URLSearchParams();
  if (params?.filter) qs.set("filter", params.filter);
  if (params?.limit) qs.set("limit", String(params.limit));
  const url = `/api/corp/training${qs.toString() ? "?" + qs : ""}`;
  const res = await apiFetchAuth(url);
  if (!res.ok) throw new Error("fetch_training_failed");
  const data = await res.json();
  return data.modules;
}

export async function createTraining(body: {
  title: string;
  description?: string;
  department?: string;
  type?: string;
  durationMinutes?: number;
  deadline?: number;
  assignedTo?: string;
  icon?: string;
}): Promise<TrainingModule> {
  const res = await apiFetchAuth("/api/corp/training", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "create_training_failed");
  }
  const data = await res.json();
  return data.module;
}

export async function updateProgress(
  moduleId: string,
  progress: number
): Promise<{ progress: number; status: string }> {
  const res = await apiFetchAuth(`/api/corp/training/${moduleId}/progress`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ progress }),
  });
  if (!res.ok) throw new Error("update_progress_failed");
  const data = await res.json();
  return data.progress;
}

export async function assignTraining(
  moduleId: string,
  body: { assignedTo?: string; deadline?: number }
): Promise<void> {
  const res = await apiFetchAuth(`/api/corp/training/${moduleId}/assign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("assign_training_failed");
}
