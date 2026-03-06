import { apiFetch, apiFetchAuth } from "../../lib/api";
import { demoDocId, demoDbPath } from "../../lib/demoPaths";
import { isEduBypassEnabled } from "../state/eduMode";

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
  district?: string;
  city?: string;
  state?: string;
  schoolType?: string;
};

export async function createTopAdmin(input: CreateTopAdminInput): Promise<{ ok: true; token: string; orgId: string; userId: string }> {
  if (isEduBypassEnabled()) {
    // In demo mode, simulate a successful top-admin creation and store
    // a fake admin identity in localStorage so subsequent pages work.
    // Maps to: env/test/tenants/edu/users/{fakeUserId}
    const fakeUserId = demoDocId("edu", "admin");
    const orgId = "test-edu-org";
    try {
      localStorage.setItem("sl_user", JSON.stringify({
        uid: fakeUserId, email: input.email,
        displayName: `${input.firstName} ${input.lastName}`,
        orgId, orgType: "edu", orgRole: "faculty_admin",
      }));
    } catch {}
    return { ok: true, token: "demo-token", orgId, userId: fakeUserId };
  }
  const res = await apiFetch("/api/onboarding/create-top-admin", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return res.json();
}

export async function setOnboardingProgress(step: number): Promise<{ ok: true; orgId: string; step: number }> {
  if (isEduBypassEnabled()) return { ok: true, orgId: "test-edu-org", step };
  const res = await apiFetchAuth("/api/onboarding/progress", {
    method: "POST",
    body: JSON.stringify({ step }),
  });
  return res.json();
}

export async function resetDemoOrg(): Promise<any> {
  if (isEduBypassEnabled()) return { ok: true };
  const res = await apiFetchAuth("/api/onboarding/reset-demo", {
    method: "POST",
    body: JSON.stringify({ orgId: "demo" }),
  });
  return res.json();
}
