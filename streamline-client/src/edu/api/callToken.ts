import { apiFetchAuth } from "@/lib/api";

export interface CallTokenResult {
  roomName: string;
  token: string;
  livekitUrl: string | null;
}

/**
 * Mint a LiveKit token for a 1-on-1 DM call with another EDU org member.
 */
export async function getEduCallTokenDM(targetUserId: string): Promise<CallTokenResult> {
  const res = await apiFetchAuth("/api/edu/calls/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "dm", targetUserId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `call-token request failed (${res.status})`);
  }
  return res.json();
}
