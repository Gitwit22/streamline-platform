import { apiFetch, apiFetchAuth } from "@/lib/api";

export type CorporateInvite = {
  inviteId: string;
  corporateAccountId: string;
  invitedEmail: string;
  invitedRole: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  expiresAt: number | null;
  acceptedAt: number | null;
  createdBy: string | null;
  createdAt: number | null;
  updatedAt: number | null;
};

export async function createCorporateInvite(input: { invitedEmail: string; invitedRole: string }) {
  const res = await apiFetchAuth("/api/corporate/invites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return res.json();
}

export async function fetchCorporateInvites(): Promise<{ invites: CorporateInvite[] }> {
  const res = await apiFetchAuth("/api/corporate/invites");
  return res.json();
}

export async function resendCorporateInvite(inviteId: string) {
  const res = await apiFetchAuth(`/api/corporate/invites/${encodeURIComponent(inviteId)}/resend`, {
    method: "POST",
  });
  return res.json();
}

export async function revokeCorporateInvite(inviteId: string) {
  const res = await apiFetchAuth(`/api/corporate/invites/${encodeURIComponent(inviteId)}/revoke`, {
    method: "POST",
  });
  return res.json();
}

export async function validateCorporateInvite(token: string) {
  const res = await apiFetch(`/api/corporate/invites/validate/${encodeURIComponent(token)}`, undefined, {
    allowNonOk: true,
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as any)?.error || "invite_validate_failed");
  }

  return body;
}

export async function acceptCorporateInvite(input: {
  token: string;
  name?: string;
  email?: string;
  password?: string;
}) {
  const res = await apiFetch("/api/corporate/invites/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }, { allowNonOk: true });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as any)?.error || "invite_accept_failed");
  }

  return body;
}
