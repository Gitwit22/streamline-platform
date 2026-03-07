import { apiFetchAuth } from "@/lib/api";

export interface EduBroadcast {
  id: string;
  title: string;
  description: string;
  templateId: string;
  layout: string;
  status: string;
  publishHls: boolean;
  recordMp4: boolean;
  alsoYoutube: boolean;
  scheduledAt: number | null;
  startedAt: number | null;
  endedAt: number | null;
  viewers: number;
  createdAt: number | null;
  createdBy: string;
  eventId: string | null;
  roomId: string | null;
  livekitRoomName: string | null;
  playlistUrl: string | null;
  egressId: string | null;
}

export interface GoLiveResponse {
  broadcast: EduBroadcast;
  lkToken: string;
  roomAccessToken: string;
  livekitUrl: string;
  playlistUrl: string | null;
}

export interface WatchResponse {
  id: string;
  title: string;
  status: string;
  playlistUrl: string | null;
  viewerCount: number;
  startedAt: number | null;
}

/**
 * POST /api/edu/broadcasts/go-live
 * Creates a broadcast, a LiveKit room, starts HLS egress, and
 * returns a host LiveKit token.
 */
export async function goLiveEduBroadcast(body: {
  title: string;
  templateId: string;
  layout: string;
  publishHls: boolean;
  recordMp4: boolean;
  eventId?: string | null;
  assignedRoomId?: string | null;
}): Promise<GoLiveResponse> {
  const res = await apiFetchAuth("/api/edu/broadcasts/go-live", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "go_live_failed");
  }
  return res.json();
}

/**
 * POST /api/edu/broadcasts/:id/stop
 * Stops HLS egress and marks broadcast as completed.
 */
export async function stopEduBroadcast(id: string): Promise<{ broadcast: EduBroadcast }> {
  const res = await apiFetchAuth(`/api/edu/broadcasts/${id}/stop`, {
    method: "POST",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "stop_failed");
  }
  return res.json();
}

/**
 * GET /api/edu/broadcasts/:id/watch
 * Returns live status, playlist URL, and viewer count.
 */
export async function watchEduBroadcast(id: string): Promise<WatchResponse> {
  const res = await apiFetchAuth(`/api/edu/broadcasts/${id}/watch`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "watch_failed");
  }
  return res.json();
}

/**
 * GET /api/edu/broadcasts
 * List org broadcasts.
 */
export async function fetchEduBroadcasts(params?: {
  limit?: number;
}): Promise<EduBroadcast[]> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  const url = `/api/edu/broadcasts${qs.toString() ? "?" + qs : ""}`;
  const res = await apiFetchAuth(url);
  if (!res.ok) throw new Error("fetch_broadcasts_failed");
  const data = await res.json();
  return data.broadcasts;
}
