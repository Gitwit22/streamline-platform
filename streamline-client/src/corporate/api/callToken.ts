import { apiFetchAuth } from "@/lib/api";

/* ── Types ──────────────────────────────────────────────────────── */

export interface CallTokenResult {
  roomName: string;
  token: string;
  livekitUrl: string | null;
}

/* ── API calls ──────────────────────────────────────────────────── */

/**
 * Mint a LiveKit token for a DM call with another org member.
 */
export async function getCallTokenDM(targetUserId: string): Promise<CallTokenResult> {
  const res = await apiFetchAuth("/api/corp/calls/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "dm", targetUserId }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "call_token_failed");
  return body;
}

/**
 * Mint a LiveKit token for a channel group call.
 */
export async function getCallTokenChannel(channelId: string): Promise<CallTokenResult> {
  const res = await apiFetchAuth("/api/corp/calls/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "channel", channelId }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "call_token_failed");
  return body;
}
