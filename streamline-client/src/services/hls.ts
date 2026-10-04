import { API_BASE } from "../lib/apiBase";
import { apiFetchAuth } from "../lib/api";
import { getSelectedOwnerContext } from "../lib/producerDelegation";

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
  const ownerUid = getSelectedOwnerContext().ownerUid;
  if (ownerUid) {
    headers["x-owner-context-uid"] = ownerUid;
  }
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
      headers: buildAuthHeaders(roomAccessToken),
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

/**
 * Read-only HLS status poll. This runs in the background, so it must never
 * trigger the global "session expired" flow (sl:unauthorized / token wipe):
 * a 401/403 here only means this user can't manage the stream. Errors carry
 * `status` so pollers can stop on 401/403 instead of retrying forever.
 */
export async function getHlsStatus(roomId: string, roomAccessToken?: string) {
  const url = `${API_BASE}/api/hls/status/${encodeURIComponent(roomId)}`;
  let res: Response;
  try {
    res = await apiFetchAuth(
      url,
      { headers: buildAuthHeaders(roomAccessToken) },
      { allowNonOk: true, suppressAuthSideEffects: true },
    );
  } catch (err: any) {
    if (err?.name === "ApiUnauthorizedError" || err?.status === 401) {
      throw Object.assign(new Error("status_failed_401:unauthorized"), { status: 401 });
    }
    throw err;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`status_failed_${res.status}:${text}`), { status: res.status });
  }
  return (await res.json()) as HlsStatusResponse;
}

/** True for errors that mean "stop polling" (no access), not "try again". */
export function isHlsAuthError(err: unknown): boolean {
  const status = (err as any)?.status;
  return status === 401 || status === 403;
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
