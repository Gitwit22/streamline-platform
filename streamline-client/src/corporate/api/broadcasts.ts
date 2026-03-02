import { apiFetchAuth } from "@/lib/api";

export interface Broadcast {
  id: string;
  title: string;
  description: string;
  team: string;
  scope: string;
  status: string;
  required: boolean;
  scheduledAt: number | null;
  startedAt: number | null;
  endedAt: number | null;
  viewers: number;
  createdAt: number | null;
  createdBy: string;
  roomId?: string;
  livekitRoomName?: string;
  playlistUrl?: string | null;
  egressId?: string | null;
}

export interface GoLiveResponse {
  broadcast: Broadcast;
  lkToken: string;
  roomAccessToken: string;
  livekitUrl: string;
  playlistUrl: string | null;
}

export interface WatchResponse {
  id: string;
  title: string;
  team: string;
  status: string;
  playlistUrl: string | null;
  viewerCount: number;
  startedAt: number | null;
}

export async function fetchBroadcasts(params?: {
  status?: string;
  limit?: number;
}): Promise<Broadcast[]> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.limit) qs.set("limit", String(params.limit));
  const url = `/api/corp/broadcasts${qs.toString() ? "?" + qs : ""}`;
  const res = await apiFetchAuth(url);
  if (!res.ok) throw new Error("fetch_broadcasts_failed");
  const data = await res.json();
  return data.broadcasts;
}

export async function createBroadcast(body: {
  title: string;
  description?: string;
  team?: string;
  scope?: string;
  required?: boolean;
  scheduledAt?: number;
}): Promise<Broadcast> {
  const res = await apiFetchAuth("/api/corp/broadcasts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "create_broadcast_failed");
  }
  const data = await res.json();
  return data.broadcast;
}

export async function updateBroadcast(
  id: string,
  body: Partial<Pick<Broadcast, "title" | "description" | "status" | "scheduledAt" | "required" | "viewers">>
): Promise<Broadcast> {
  const res = await apiFetchAuth(`/api/corp/broadcasts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "update_broadcast_failed");
  }
  const data = await res.json();
  return data.broadcast;
}

export async function deleteBroadcast(id: string): Promise<void> {
  const res = await apiFetchAuth(`/api/corp/broadcasts/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "delete_broadcast_failed");
  }
}

/**
 * Go live: creates a LiveKit room, starts HLS egress, returns host tokens.
 */
export async function goLiveBroadcast(id: string): Promise<GoLiveResponse> {
  const res = await apiFetchAuth(`/api/corp/broadcasts/${id}/go-live`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "go_live_failed");
  }
  return await res.json();
}

/**
 * Stop a live broadcast: stops egress, marks completed.
 */
export async function stopBroadcast(id: string): Promise<{ broadcast: Broadcast }> {
  const res = await apiFetchAuth(`/api/corp/broadcasts/${id}/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "stop_broadcast_failed");
  }
  return await res.json();
}

/**
 * Watch: returns HLS playlist URL + viewer count for a broadcast.
 */
export async function watchBroadcast(id: string): Promise<WatchResponse> {
  const res = await apiFetchAuth(`/api/corp/broadcasts/${id}/watch`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "watch_failed");
  }
  return await res.json();
}
