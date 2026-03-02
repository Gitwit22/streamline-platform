import { apiFetch, apiFetchAuth } from "../../lib/api";

export type OnboardingConfig = {
  ok: true;
  systemState: {
    isInitialized: boolean;
    mode: "demo" | "live" | null;
    allowFactoryReset: boolean;
    allowSelfServeOrgCreation: boolean;
  };
};

export async function fetchOnboardingConfig(): Promise<OnboardingConfig> {
  const res = await apiFetch("/api/onboarding/config", { method: "GET", cache: "no-store" });
  return res.json();
}

export type CreateTopAdminInput = {
  orgName: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
  phone?: string;
};

export async function createTopAdmin(input: CreateTopAdminInput): Promise<{ ok: true; token: string; orgId: string; userId: string }> {
  const res = await apiFetch("/api/onboarding/create-top-admin", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return res.json();
}

export async function setOnboardingProgress(step: number): Promise<{ ok: true; orgId: string; step: number }> {
  const res = await apiFetchAuth("/api/onboarding/progress", {
    method: "POST",
    body: JSON.stringify({ step }),
  });
  return res.json();
}

export async function resetDemoOrg(): Promise<any> {
  const res = await apiFetchAuth("/api/onboarding/reset-demo", {
    method: "POST",
    body: JSON.stringify({ orgId: "demo" }),
  });
  return res.json();
}
