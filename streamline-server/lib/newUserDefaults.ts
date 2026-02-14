import { normalizeBillingTruthFromUser } from "./billingTruth";
import { CURRENT_TOS_VERSION } from "./tos";

export type NewUserDocInput = {
  email: string;
  passwordHash: string;
  displayName?: string;
  timeZone?: string;
  nowMs?: number;
  tosAcceptedIp?: string;
  tosUserAgent?: string;
};

export function buildNewUserDoc(input: NewUserDocInput) {
  const now = typeof input.nowMs === "number" ? input.nowMs : Date.now();

  const planId = "free" as const;

  const base = {
    email: input.email,
    displayName: input.displayName ? String(input.displayName) : "",
    passwordHash: input.passwordHash,

    // Billing defaults
    planId,
    billingEnabled: true,
    billingTruth: normalizeBillingTruthFromUser({ planId }, now),

    // Legacy billing fields (still used by some gates/UI)
    billingActive: false,
    billingStatus: "free",

    createdAt: now,
    timeZone: input.timeZone ? String(input.timeZone) : "America/Chicago",

    // Terms of Service
    tosVersion: CURRENT_TOS_VERSION,
    tosAcceptedAt: now,
    tosAcceptedIp: input.tosAcceptedIp,
    tosUserAgent: input.tosUserAgent,
  };

  return base;
}
