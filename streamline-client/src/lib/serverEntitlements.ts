/**
 * Client mirror of the server entitlement engine's EffectiveEntitlements
 * (streamline-server/lib/entitlements/types.ts), as sent on
 * /api/account/me (`entitlements`), the room token response and
 * /api/usage/* (`entitlements`).
 *
 * LIMIT CONVENTION: null = UNLIMITED, 0 = NONE (never "0 = unlimited").
 * The server already ANDs plan features with platform kill switches in
 * `features`; `planFeatures` is the plan alone. Clients must not apply their
 * own defaults for platform flags: `platformFlags` comes from the server.
 */

export type Limit = number | null;

export type ServerFeatureKey =
  | "multistream"
  | "recording"
  | "dualRecording"
  | "hls"
  | "hlsCustomization"
  | "editing"
  | "projects"
  | "contentLibrary"
  | "monetization"
  | "payPerView"
  | "invisibleHost"
  | "overages"
  | "watermark";

export type ServerLimitKey =
  | "monthlyStreamingMinutes"
  | "destinations"
  | "guests"
  | "storageBytes"
  | "recordingMinutesPerClip"
  | "maxSessionMinutes"
  | "projects"
  | "hlsMaxMinutesPerSession";

export type ServerPlatformFlags = {
  recording: boolean;
  hlsSettingsTab: boolean;
  contentLibraryEnabled: boolean;
  projectsEnabled: boolean;
  editorEnabled: boolean;
  myContentEnabled: boolean;
  myContentRecordingsEnabled: boolean;
  audioMixerEnabled: boolean;
  advancedScreenShareEnabled: boolean;
  mixedAudioPublishEnabled: boolean;
  monetizationEnabled: boolean;
  payPerViewEnabled: boolean;
  invisibleHostEnabled: boolean;
  collaboratorDelegationEnabled: boolean;
  transcodeEnabled: boolean;
};

export type ServerPlanOverride = {
  planId: string;
  reason: string;
  createdBy: string;
  startsAt: number;
  expiresAt?: number | null;
  legacy?: boolean;
};

export type ServerEntitlements = {
  planId: string;
  planName: string;
  features: Record<ServerFeatureKey, boolean>;
  planFeatures: Record<ServerFeatureKey, boolean>;
  limits: Record<ServerLimitKey, Limit> & { maxPresetId: string };
  source: {
    basePlan: string;
    subscription: {
      status: string;
      subscriptionId: string | null;
      blocked: boolean;
      blockedReason: string | null;
      billingEnforced: boolean;
    };
    adminOverride: ServerPlanOverride | null;
    internalAdmin: boolean;
    decidedBy: "base" | "override" | "internal_admin" | "billing_block";
    grants: ServerFeatureKey[];
  };
  platformFlags: ServerPlatformFlags;
  computedAt: number;
};

/** True for the engine's EffectiveEntitlements shape (vs. the legacy payload). */
export function isServerEntitlements(value: unknown): value is ServerEntitlements {
  const v = value as any;
  return (
    !!v &&
    typeof v === "object" &&
    !!v.features &&
    !!v.planFeatures &&
    !!v.limits &&
    !!v.platformFlags &&
    Object.prototype.hasOwnProperty.call(v.limits, "destinations")
  );
}

/** "Unlimited" for null, "None" for 0, else the number (+ unit, pluralized). */
export function formatEntitlementLimit(limit: Limit | undefined, unit?: string): string {
  if (limit === null) return unit ? `Unlimited ${unit.endsWith("s") ? unit : `${unit}s`}` : "Unlimited";
  if (limit === undefined || !Number.isFinite(Number(limit))) return "—";
  if (limit === 0) return "None";
  if (!unit) return String(limit);
  const plural = limit === 1 ? unit : unit.endsWith("s") ? unit : `${unit}s`;
  return `${limit} ${plural}`;
}

/** Bytes limit as GB label: "Unlimited", "None" or "25 GB". */
export function formatStorageLimit(bytes: Limit | undefined): string {
  if (bytes === null) return "Unlimited";
  if (bytes === undefined) return "—";
  if (bytes === 0) return "None";
  const gb = bytes / (1024 * 1024 * 1024);
  return `${Math.round(gb * 100) / 100} GB`;
}

/** May `amount` more units be used? (null = unlimited, 0 = none). */
export function hasRoomFor(used: number, limit: Limit, amount = 1): boolean {
  if (limit === null) return true;
  return Math.max(0, Number(used) || 0) + amount <= limit;
}
