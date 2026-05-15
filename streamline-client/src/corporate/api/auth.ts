import { apiFetch, apiFetchAuth } from "@/lib/api";

export type CorporateAuthUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
  corporateAccountId: string;
  organizationId: string;
  corporateAccount: {
    id: string;
    name: string;
    status: string;
    planId: string;
  };
};

export type CorporateAuthResponse = {
  token: string;
  user: CorporateAuthUser;
};

export async function corporateLogin(input: { email: string; password: string }): Promise<CorporateAuthResponse> {
  const res = await apiFetch(
    "/api/corporate/auth/login",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    { allowNonOk: true }
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any)?.error || "corporate_login_failed");
  }

  return res.json();
}

export async function corporateRegister(input: {
  name: string;
  email: string;
  password: string;
  companyName?: string;
  inviteToken?: string;
}): Promise<CorporateAuthResponse> {
  const res = await apiFetch(
    "/api/corporate/auth/register",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    { allowNonOk: true }
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = (body as any)?.error || "corporate_register_failed";
    const message = (body as any)?.message;
    throw new Error(message ? `${err}: ${message}` : err);
  }

  return res.json();
}

export async function corporateMe() {
  const res = await apiFetchAuth("/api/corporate/auth/me", undefined, {
    suppressAuthSideEffects: true,
    allowNonOk: true,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any)?.error || "corporate_me_failed");
  }

  return res.json();
}

export async function corporateLogout() {
  await apiFetch("/api/corporate/auth/logout", {
    method: "POST",
  });
}
