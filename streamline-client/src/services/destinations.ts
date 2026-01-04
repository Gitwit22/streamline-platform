export type DestinationStatus = "connected" | "needs_attention" | "disconnected";
export type DestinationStatusReason = "missing_key" | "invalid_format" | "egress_auth" | "egress_failed" | "unknown";

export interface DestinationItem {
  id: string;
  platform: string;
  name?: string;
  enabled: boolean;
  rtmpUrlBase: string;
  status: DestinationStatus;
  statusReason?: DestinationStatusReason | null;
  hasKey: boolean;
  keyPreview?: string | null;
  updatedAt?: number;
}

const API_BASE = import.meta.env.VITE_API_BASE;

async function parseJsonSafe(res: Response) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: "non_json_response", raw: text };
  }
}

export async function fetchDestinations(params?: { platform?: string; includeDisabled?: boolean }) {
  const url = new URL(`${API_BASE}/api/destinations`);
  if (params?.platform) url.searchParams.set("platform", params.platform);
  if (params?.includeDisabled === true) url.searchParams.set("includeDisabled", "true");
  const res = await fetch(url.toString(), { credentials: "include" });
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(String((data && data.error) || res.status));
  return data as { ok: boolean; items: DestinationItem[]; usedCount?: number; limit?: number };
}

export async function createDestination(body: { platform: string; name?: string; rtmpUrlBase: string; enabled?: boolean }) {
  const res = await fetch(`${API_BASE}/api/destinations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(String((data && data.error) || res.status));
  return data as { ok: boolean; destination: DestinationItem; validation?: { status: DestinationStatus; statusReason?: DestinationStatusReason | null }; usedCount?: number; limit?: number };
}

export async function updateDestination(id: string, body: { platform?: string; name?: string; rtmpUrlBase?: string; enabled?: boolean }) {
  const res = await fetch(`${API_BASE}/api/destinations/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body || {}),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(String((data && data.error) || res.status));
  return data as { ok: boolean; destination: DestinationItem; usedCount?: number; limit?: number };
}

export async function deleteDestination(id: string) {
  const res = await fetch(`${API_BASE}/api/destinations/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(String((data && data.error) || res.status));
  return data as { ok: boolean };
}

export async function validateDestinationPreCreate(body: { platform: string; rtmpUrlBase: string }) {
  const res = await fetch(`${API_BASE}/api/destinations/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(String((data && data.error) || res.status));
  return data as { ok: boolean; status: DestinationStatus; statusReason?: DestinationStatusReason | null };
}

export async function preflight(body: { destinationIds?: string[]; video?: any; audio?: any; networkProbeMs?: number }) {
  const res = await fetch(`${API_BASE}/api/live/preflight`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body || {}),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(String((data && data.error) || res.status));
  return data as { ok: boolean; allowed: boolean; destinations: Array<{ id: string; platform: string; status: DestinationStatus; statusReason?: DestinationStatusReason | null }> };
}
