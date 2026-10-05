/**
 * Built-in plan catalog in v2 form (null = unlimited, 0 = none).
 *
 * Used by:
 *   - POST /api/admin/plans/seed (writes these documents)
 *   - the entitlement engine when a known plan id has NO Firestore document
 *   - scripts/migratePlansToV2.ts (reference only)
 *
 * Keep in sync with the root seed-plans.js script.
 */
import type { EntitlementFeatures, Limit, LimitKey } from "./types";

export const PLAN_LIMITS_VERSION = 2 as const;

const GB = 1024 * 1024 * 1024;

export type PlanDocV2 = {
  limitsVersion: 2;
  name: string;
  description: string;
  priceMonthly: number;
  visibility: "public" | "hidden" | "admin";
  features: EntitlementFeatures;
  limits: Record<LimitKey, Limit> & { maxPresetId: string | null };
  customizable?: boolean;
  contactSales?: boolean;
};

function features(on: Partial<EntitlementFeatures>): EntitlementFeatures {
  return {
    multistream: false,
    recording: false,
    dualRecording: false,
    hls: false,
    hlsCustomization: false,
    editing: false,
    projects: false,
    contentLibrary: false,
    monetization: false,
    payPerView: false,
    invisibleHost: false,
    audioMixer: true,
    advancedScreenShare: true,
    overages: false,
    watermark: false,
    ...on,
  };
}

const ALL_FEATURES_ON = features({
  multistream: true,
  recording: true,
  dualRecording: true,
  hls: true,
  hlsCustomization: true,
  editing: true,
  projects: true,
  contentLibrary: true,
  monetization: true,
  payPerView: true,
  invisibleHost: true,
  audioMixer: true,
  advancedScreenShare: true,
  overages: true,
});

export const PLAN_CATALOG_V2: Record<string, PlanDocV2> = {
  free: {
    limitsVersion: 2,
    name: "Free",
    description: "Get started – basic in-room experience",
    priceMonthly: 0,
    visibility: "public",
    features: features({}),
    limits: {
      monthlyStreamingMinutes: 180,
      destinations: 0,
      guests: 2,
      storageBytes: 0,
      recordingMinutesPerClip: 0,
      maxSessionMinutes: 60,
      projects: 0,
      hlsMaxMinutesPerSession: null,
      maxPresetId: null,
    },
  },
  basic: {
    limitsVersion: 2,
    name: "Basic",
    description: "For hobbyists – recording & basic editing",
    priceMonthly: 15,
    visibility: "public",
    features: features({ recording: true, editing: true, projects: true, contentLibrary: true }),
    limits: {
      monthlyStreamingMinutes: 360,
      destinations: 0,
      guests: 4,
      storageBytes: 3 * GB,
      recordingMinutesPerClip: 30,
      maxSessionMinutes: 120,
      projects: 2,
      hlsMaxMinutesPerSession: null,
      maxPresetId: null,
    },
  },
  starter: {
    limitsVersion: 2,
    name: "Starter",
    description: "For growing creators – streaming, recording & editing",
    priceMonthly: 29,
    visibility: "public",
    features: features({
      multistream: true,
      recording: true,
      editing: true,
      projects: true,
      contentLibrary: true,
    }),
    limits: {
      monthlyStreamingMinutes: 600,
      destinations: 3,
      guests: 5,
      storageBytes: 15 * GB,
      recordingMinutesPerClip: 15,
      maxSessionMinutes: 240,
      projects: 5,
      hlsMaxMinutesPerSession: null,
      maxPresetId: null,
    },
  },
  pro: {
    limitsVersion: 2,
    name: "Pro",
    description: "For professionals – full suite with HLS & overages",
    priceMonthly: 79,
    visibility: "public",
    features: { ...ALL_FEATURES_ON },
    limits: {
      monthlyStreamingMinutes: 2400,
      destinations: 3,
      guests: 10,
      storageBytes: 25 * GB,
      recordingMinutesPerClip: 60,
      maxSessionMinutes: 480,
      projects: 10,
      hlsMaxMinutesPerSession: null,
      maxPresetId: null,
    },
  },
  enterprise: {
    limitsVersion: 2,
    name: "Enterprise",
    description: "Custom enterprise solution – configured per account",
    priceMonthly: 0,
    visibility: "admin",
    features: { ...ALL_FEATURES_ON },
    limits: {
      monthlyStreamingMinutes: 6000,
      destinations: 10,
      guests: 50,
      storageBytes: null,
      recordingMinutesPerClip: 120,
      maxSessionMinutes: 720,
      projects: null,
      hlsMaxMinutesPerSession: null,
      maxPresetId: null,
    },
    customizable: true,
    contactSales: true,
  },
  internal_unlimited: {
    limitsVersion: 2,
    name: "Internal Unlimited",
    description: "Internal testing – all features unlocked",
    priceMonthly: 0,
    visibility: "admin",
    features: { ...ALL_FEATURES_ON },
    limits: {
      monthlyStreamingMinutes: null,
      destinations: null,
      guests: null,
      storageBytes: null,
      recordingMinutesPerClip: null,
      maxSessionMinutes: null,
      projects: null,
      hlsMaxMinutesPerSession: null,
      maxPresetId: null,
    },
  },
};

/** Plan id used for platform admins and the legacy `adminOverride: true` flag. */
export const INTERNAL_PLAN_ID = "internal_unlimited";
export const FALLBACK_PLAN_ID = "free";

export function getCatalogPlan(planId: string): PlanDocV2 | null {
  const key = String(planId || "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(PLAN_CATALOG_V2, key) ? PLAN_CATALOG_V2[key] : null;
}
