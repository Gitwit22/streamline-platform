
import { API_BASE } from "./apiBase";

export async function apiFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    let errBody: any = null;
    try { errBody = await res.json(); } catch {}
    throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, body: errBody });
  }
  return res;
}

export async function getToken(
  roomId: string,
  userId: string,
  role: "host" | "guest"
) {
  const res = await apiFetch(`${API_BASE}/v1/rooms/token`, {
    method: "POST",
    body: JSON.stringify({ roomId, userId, role }),
  });
  return res.json() as Promise<{ token: string; wsUrl: string }>;
}

export async function apiStartRecording(
  roomName: string,
  layout: "speaker" | "grid",
  mode: "cloud" | "dual" = "cloud",
  presetId?: string
) {
  const res = await apiFetch(`${API_BASE}/api/recordings/start`, {
    method: "POST",
    body: JSON.stringify({ roomName, layout, mode, presetId }),
  });
  return res.json();
}

export async function apiStopRecording(recordingId: string) {
  const res = await apiFetch(`${API_BASE}/api/recordings/stop`, {
    method: "POST",
    body: JSON.stringify({ recordingId }),
  });
  return res.json() as Promise<{ ok: true }>;
}
