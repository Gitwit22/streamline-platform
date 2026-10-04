import { describe, expect, it } from "vitest";
import { computeEffectiveFeatureAccess } from "../effectiveFeatureAccess";
import {
  formatEntitlementLimit,
  formatStorageLimit,
  hasRoomFor,
  isServerEntitlements,
  type ServerEntitlements,
} from "../serverEntitlements";
import { formatLimitLabel } from "../entitlements";

const FEATURES_OFF = {
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
  overages: false,
  watermark: false,
};

const FLAGS = {
  recording: true,
  hlsSettingsTab: true,
  contentLibraryEnabled: true,
  projectsEnabled: true,
  editorEnabled: true,
  myContentEnabled: true,
  myContentRecordingsEnabled: true,
  audioMixerEnabled: false,
  advancedScreenShareEnabled: false,
  monetizationEnabled: false,
  payPerViewEnabled: false,
  invisibleHostEnabled: false,
  collaboratorDelegationEnabled: false,
  transcodeEnabled: true,
};

function ent(overrides: Partial<ServerEntitlements> = {}): ServerEntitlements {
  return {
    planId: "pro",
    planName: "Pro",
    features: { ...FEATURES_OFF },
    planFeatures: { ...FEATURES_OFF },
    limits: {
      monthlyStreamingMinutes: 2400,
      destinations: 3,
      guests: 10,
      storageBytes: null,
      recordingMinutesPerClip: 60,
      maxSessionMinutes: 480,
      projects: 10,
      hlsMaxMinutesPerSession: null,
      maxPresetId: "sports_1080p60",
    },
    source: {
      basePlan: "free",
      subscription: { status: "none", subscriptionId: null, blocked: false, blockedReason: null, billingEnforced: true },
      adminOverride: { planId: "pro", reason: "r", createdBy: "a", startsAt: 0 },
      internalAdmin: false,
      decidedBy: "override",
      grants: [],
    },
    platformFlags: { ...FLAGS },
    computedAt: 0,
    ...overrides,
  };
}

describe("computeEffectiveFeatureAccess with server EffectiveEntitlements", () => {
  it("uses server features (already ANDed with kill switches) and server flags", () => {
    const e = ent({
      features: { ...FEATURES_OFF, multistream: true, hls: true, monetization: false },
      planFeatures: { ...FEATURES_OFF, multistream: true, hls: true, monetization: true },
    });
    const a = computeEffectiveFeatureAccess({ effectiveEntitlements: e, platformFlags: {} });
    expect(isServerEntitlements(e)).toBe(true);
    expect(a.canUse.multistream).toBe(true);
    expect(a.canUse.destinations).toBe(true);
    expect(a.canUse.hlsRuntime).toBe(true);
    // Plan includes monetization but the platform switch is off.
    expect(a.monetization.allowed).toBe(false);
    expect(a.monetization.planIncluded).toBe(true);
    expect(a.monetization.platformEnabled).toBe(false);
    // Segmented flags come from the server (default ON there), not client defaults.
    expect(a.myContent.allowed).toBe(true);
    expect(a.plan.rtmpDestinationsMax).toBe(3);
  });

  it("server platformFlags win over the separately-fetched flags", () => {
    const e = ent({ platformFlags: { ...FLAGS, myContentEnabled: false } });
    const a = computeEffectiveFeatureAccess({ effectiveEntitlements: e, platformFlags: { myContentEnabled: true } });
    expect(a.myContent.allowed).toBe(false);
  });

  it("null destinations = unlimited; feature off = none", () => {
    const unlimited = computeEffectiveFeatureAccess({
      effectiveEntitlements: ent({
        features: { ...FEATURES_OFF, multistream: true },
        planFeatures: { ...FEATURES_OFF, multistream: true },
        limits: { ...ent().limits, destinations: null },
      }),
    });
    expect(unlimited.plan.rtmpDestinationsMax).toBeNull();
    expect(unlimited.canUse.multistream).toBe(true);

    const none = computeEffectiveFeatureAccess({
      effectiveEntitlements: ent({ limits: { ...ent().limits, destinations: 0 } }),
    });
    expect(none.plan.destinations).toBe(false);
    expect(none.canUse.multistream).toBe(false);
  });
});

describe("legacy payload path matches the server multistream rule", () => {
  it("one destination is enough for multistream (server: >= 1)", () => {
    const a = computeEffectiveFeatureAccess({
      effectiveEntitlements: { features: {}, limits: { rtmpDestinationsMax: 1 } },
      platformFlags: { transcodeEnabled: true },
    });
    expect(a.plan.destinations).toBe(true);
    expect(a.plan.multistream).toBe(true);
    expect(a.canUse.multistream).toBe(true);
  });
});

describe("limit formatting: null = Unlimited, 0 = none", () => {
  it("formats limits", () => {
    expect(formatEntitlementLimit(null)).toBe("Unlimited");
    expect(formatEntitlementLimit(null, "guest")).toBe("Unlimited guests");
    expect(formatEntitlementLimit(0, "guest")).toBe("None");
    expect(formatEntitlementLimit(1, "guest")).toBe("1 guest");
    expect(formatEntitlementLimit(3, "guest")).toBe("3 guests");
    expect(formatStorageLimit(null)).toBe("Unlimited");
    expect(formatStorageLimit(0)).toBe("None");
    expect(formatStorageLimit(25 * 1024 * 1024 * 1024)).toBe("25 GB");
    expect(formatLimitLabel(null)).toBe("Unlimited");
    expect(formatLimitLabel(0)).toBe("Not included");
    expect(formatLimitLabel(-1)).toBe("Unlimited");
  });

  it("hasRoomFor", () => {
    expect(hasRoomFor(100, null)).toBe(true);
    expect(hasRoomFor(0, 0)).toBe(false);
    expect(hasRoomFor(2, 3)).toBe(true);
    expect(hasRoomFor(3, 3)).toBe(false);
  });
});
