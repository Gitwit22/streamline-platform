import { apiFetchAuth } from "../lib/api";

export type DestinationStatus = "connected" | "needs_attention" | "disconnected";
export type DestinationStatusReason = "missing_key" | "invalid_format" | "egress_auth" | "egress_failed" | "unknown";

export interface DestinationItem {
  id: string;
  targetId: string;
  platform: string;
  name?: string;
  enabled: boolean;
  mode?: "manual" | "connected";
  persistent?: boolean;
  oauthRef?: string | null;
  rtmpUrlBase: string;
  status: DestinationStatus;
  statusReason?: DestinationStatusReason | null;
  hasKey: boolean;
  keyPreview?: string | null;
  updatedAt?: number;
}

export async function fetchDestinations(params?: { platform?: string; includeDisabled?: boolean }) {
  const qs = new URLSearchParams();
  if (params?.platform) qs.set("platform", params.platform);
  if (params?.includeDisabled === true) qs.set("includeDisabled", "true");
  const path = `/api/destinations${qs.toString() ? `?${qs.toString()}` : ""}`;
  const res = await apiFetchAuth(path);
  const data = await res.json();
  return data as { ok: boolean; items: DestinationItem[]; usedCount?: number; limit?: number };
}

export async function createDestination(body: { platform: string; name?: string; rtmpUrlBase: string; enabled?: boolean; streamKeyPlain?: string; mode?: "manual" | "connected"; persistent?: boolean; oauthRef?: string | null }) {
  const res = await apiFetchAuth("/api/destinations", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data as { ok: boolean; destination: DestinationItem; validation?: { status: DestinationStatus; statusReason?: DestinationStatusReason | null }; usedCount?: number; limit?: number };
}

export async function updateDestination(id: string, body: { platform?: string; name?: string; rtmpUrlBase?: string; enabled?: boolean; streamKeyPlain?: string; streamKeyEnc?: any; mode?: "manual" | "connected"; persistent?: boolean; oauthRef?: string | null }) {
  const res = await apiFetchAuth(`/api/destinations/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(body || {}),
  });
  const data = await res.json();
  return data as { ok: boolean; destination: DestinationItem; usedCount?: number; limit?: number };
}

export async function deleteDestination(id: string) {
  const res = await apiFetchAuth(`/api/destinations/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  const data = await res.json();
  return data as { ok: boolean };
}

export async function validateDestinationPreCreate(body: { platform: string; rtmpUrlBase: string; streamKeyPlain?: string }) {
  const res = await apiFetchAuth("/api/destinations/validate", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data as { ok: boolean; status: DestinationStatus; statusReason?: DestinationStatusReason | null };
}

export async function preflight(body: { destinationIds?: string[]; video?: any; audio?: any; networkProbeMs?: number }) {
  const res = await apiFetchAuth("/api/live/preflight", {
    method: "POST",
    body: JSON.stringify(body || {}),
  });
  const data = await res.json();
  return data as { ok: boolean; allowed: boolean; destinations: Array<{ id: string; platform: string; status: DestinationStatus; statusReason?: DestinationStatusReason | null }> };
}
