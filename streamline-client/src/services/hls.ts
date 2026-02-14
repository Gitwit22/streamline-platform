import { API_BASE } from "../lib/apiBase";
import { apiFetchAuth } from "../lib/api";

export type HlsStatus = "idle" | "starting" | "live" | "error" | string;

export type HlsStatusResponse = {
  status?: HlsStatus;
  playlistUrl?: string | null;
  egressId?: string | null;
  error?: string | null;
};

function buildAuthHeaders(roomAccessToken?: string): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (roomAccessToken) {
    headers["x-room-access-token"] = roomAccessToken;
  }
  return headers;
}

export async function startHls(roomId: string, roomAccessToken?: string) {
  const url = `${API_BASE}/api/hls/start/${encodeURIComponent(roomId)}`;
  const res = await apiFetchAuth(
    url,
    {
      method: "POST",
      headers: buildAuthHeaders(roomAccessToken),
      body: JSON.stringify({ presetId: "hls_720p" }),
    },
    { allowNonOk: true }
  );
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const error = (data && (data.error || data.reason)) || `HTTP_${res.status}`;
    throw new Error(String(error));
  }
  return data as {
    roomId: string;
    status: HlsStatus;
    playlistUrl?: string | null;
    egressId?: string | null;
  };
}

export async function stopHls(roomId: string, roomAccessToken?: string) {
  const url = `${API_BASE}/api/hls/stop/${encodeURIComponent(roomId)}`;
  const res = await apiFetchAuth(
    url,
    {
      method: "POST",
      headers: roomAccessToken ? { "x-room-access-token": roomAccessToken } : undefined,
    },
    { allowNonOk: true }
  );
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const error = (data && (data.error || data.reason)) || `HTTP_${res.status}`;
    throw new Error(String(error));
  }
  return data as { roomId: string; hls: HlsStatusResponse };
}

export async function getHlsStatus(roomId: string, roomAccessToken?: string) {
  const url = `${API_BASE}/api/hls/status/${encodeURIComponent(roomId)}`;
  const headers = roomAccessToken ? { "x-room-access-token": roomAccessToken } : undefined;
  const res = await apiFetchAuth(url, { headers }, { allowNonOk: true });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`status_failed_${res.status}:${text}`);
  }
  return (await res.json()) as HlsStatusResponse;
}

export async function getPublicHls(roomId: string) {
  const url = `${API_BASE}/api/public/hls/${encodeURIComponent(roomId)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`public_status_failed_${res.status}:${text}`);
  }
  return (await res.json()) as {
    status?: "idle" | "starting" | "live" | "error" | string;
    playlistUrl?: string | null;
    viewerCount?: number;
    error?: string | null;
  };
}
