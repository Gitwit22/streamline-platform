import { isFeatureAvailable, isPlatformEnabled } from "./featureAvailability";
import { isServerEntitlements, type ServerEntitlements } from "./serverEntitlements";

export type EffectiveEntitlementsLike = {
  features?: Record<string, unknown>;
  limits?: Record<string, unknown>;
  planId?: string;
  planName?: string;
};

export type PlatformFlagsLike = {
  hlsEnabled?: unknown;
  hlsSettingsTab?: unknown;
  transcodeEnabled?: unknown;
  recordingEnabled?: unknown;

  // Segmented platform switches (kill-switches):
  // - Server defaults to enabled when the Firestore doc is missing.
  // - Set { enabled: false } in Firestore to disable.
  contentLibraryEnabled?: unknown;
  libraryEnabled?: unknown;
  projectsEnabled?: unknown;
  editorEnabled?: unknown;

  // My Content umbrella + sub-features:
  // - Missing/undefined => fall back to legacy behavior (older servers)
  // - Present but false => disabled (must be explicitly enabled)
  myContentEnabled?: unknown;
  myContentRecordingsEnabled?: unknown;

  // Experimental: publish mixer's program audio instead of raw mic via LiveKit

  // Advanced screen share routing (pop-out, main-stage modes)
  advancedScreenShareEnabled?: unknown;

  // Audio mixer panel (bus routing, ducking, program output)
  audioMixerEnabled?: unknown;

  // Monetization + PPV (opt-in, default disabled)
  monetizationEnabled?: unknown;
  payPerViewEnabled?: unknown;
};

function isNewPlatformFlagEnabled(value: unknown): boolean {
  // Safety-first: new segmented flags default to disabled when missing.
  return value === true;
}

function resolveEntitlementBoolean(features: Record<string, unknown> | null | undefined, keys: string[]): boolean {
  const f: any = features || {};
  for (const key of keys) {
    if (typeof f[key] === "boolean") return f[key];
  }
  // Safety-first: new entitlements default to disabled when missing.
  return false;
}

function resolveEditingAccess(features: Record<string, unknown> | null | undefined): boolean {
  const f: any = features || {};
  // Safety-first: editing must be explicitly enabled by plan.
  const explicit = f.editing ?? f.editingEnabled ?? f.postProduction;
  if (typeof explicit === "boolean") return explicit;
  return false;
}

function resolveRtmpDestinationsMax(effectiveEntitlements: EffectiveEntitlementsLike | null | undefined): number {
  const limits = (effectiveEntitlements && effectiveEntitlements.limits) || {};
  const raw = (limits as any).rtmpDestinationsMax ?? (limits as any).maxDestinations ?? 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

function resolveCanHlsRuntime(features: Record<string, unknown> | null | undefined): boolean {
  const f: any = features || {};
  const runtime = f.hls ?? f.hlsEnabled;
  const legacy = f.canHls;
  if (typeof runtime === "boolean") return runtime;
  if (typeof legacy === "boolean") return legacy;
  return false;
}

function resolveCanHlsSetup(features: Record<string, unknown> | null | undefined): boolean {
  const f: any = features || {};
  const explicit = f.hlsCustomizationEnabled;
  if (typeof explicit === "boolean") return explicit;
  const legacy = f.canCustomizeHlsPage;
  if (typeof legacy === "boolean") return legacy;
  // Back-compat: if a plan has HLS but no explicit setup flag, treat setup as included.
  return resolveCanHlsRuntime(f);
}

export function computeEffectiveFeatureAccess(input: {
  effectiveEntitlements?: EffectiveEntitlementsLike | null;
  platformFlags?: PlatformFlagsLike | null;
}): {
  platform: {
    hlsEnabled: boolean;
    transcodeEnabled: boolean;
    recordingEnabled: boolean;
  };
  usage: {
    broadcastMinutes: {
      visible: boolean;
    };
  };
  plan: {
    /** null = unlimited, 0 = none. */
    rtmpDestinationsMax: number | null;
    hlsRuntime: boolean;
    hlsSetup: boolean;
    destinations: boolean;
    multistream: boolean;
    editing: boolean;
  };
  canUse: {
    hlsRuntime: boolean;
    hlsSetup: boolean;
    destinations: boolean;
    multistream: boolean;
  };
  editing: {
    allowed: boolean;
  };
  contentLibrary: {
    allowed: boolean;
  };
  projects: {
    allowed: boolean;
  };
  editor: {
    allowed: boolean;
  };
  myContent: {
    allowed: boolean;
  };
  myContentRecordings: {
    allowed: boolean;
  };
  advancedScreenShare: {
    allowed: boolean;
  };
  audioMixer: {
    allowed: boolean;
  };
  monetization: {
    allowed: boolean;
    platformEnabled: boolean;
    planIncluded: boolean;
  };
  payPerView: {
    allowed: boolean;
    platformEnabled: boolean;
    planIncluded: boolean;
  };
} {
  // Canonical path: the server's EffectiveEntitlements (null = unlimited,
  // features already ANDed with platform switches, flags sent by the server).
  if (isServerEntitlements(input.effectiveEntitlements)) {
    return computeFromServerEntitlements(input.effectiveEntitlements);
  }

  // Legacy payload path (older servers / synthetic room-level objects).
  const eff = input.effectiveEntitlements || {};
  const pf = (input.platformFlags && typeof input.platformFlags === "object") ? input.platformFlags : {};

  // Prefer explicit platform kill-switches; default to enabled when missing.
  const platformHlsEnabled = isPlatformEnabled((pf as any).hlsEnabled ?? (pf as any).hlsSettingsTab);
  const platformTranscodeEnabled = isPlatformEnabled((pf as any).transcodeEnabled);
  const platformRecordingEnabled = isPlatformEnabled((pf as any).recordingEnabled);

  // Segmented flags: missing => disabled.
  const platformContentLibraryEnabled = isNewPlatformFlagEnabled(
    (pf as any).contentLibraryEnabled ?? (pf as any).libraryEnabled
  );
  const platformProjectsEnabled = isNewPlatformFlagEnabled((pf as any).projectsEnabled);
  const platformEditorEnabled = isNewPlatformFlagEnabled((pf as any).editorEnabled);

  // My Content: prefer explicit flags when present; otherwise fall back to derived behavior.
  const hasMyContentEnabledFlag = Object.prototype.hasOwnProperty.call(pf, "myContentEnabled");
  const platformMyContentEnabled = hasMyContentEnabledFlag
    ? isNewPlatformFlagEnabled((pf as any).myContentEnabled)
    : (platformContentLibraryEnabled || platformProjectsEnabled || platformEditorEnabled);

  const hasMyContentRecordingsEnabledFlag = Object.prototype.hasOwnProperty.call(pf, "myContentRecordingsEnabled");
  const platformMyContentRecordingsEnabled = hasMyContentRecordingsEnabledFlag
    ? isNewPlatformFlagEnabled((pf as any).myContentRecordingsEnabled)
    : platformMyContentEnabled;

  const features = (eff as any).features || {};
  const effLimits = (eff as any).limits || {};
  const rtmpDestinationsMax = resolveRtmpDestinationsMax(eff as any);

  // Canonical usage gating: Broadcast minutes are only meaningful when
  // transcode is enabled platform-wide AND the plan exposes a transcodeMinutes limit.
  // (Server omits transcodeMinutes for plans without broadcast.)
  const canShowBroadcastMinutes =
    platformTranscodeEnabled === true && typeof (effLimits as any).transcodeMinutes === "number";

  const planHlsRuntime = resolveCanHlsRuntime(features);
  const planHlsSetup = resolveCanHlsSetup(features);

  const planEditing = resolveEditingAccess(features);

  const planContentLibrary = resolveEntitlementBoolean(features, ["contentLibrary", "library"]);
  const planProjects = resolveEntitlementBoolean(features, ["projects"]);
  const planEditor = resolveEntitlementBoolean(features, ["editor"]);

  // Back-compat: legacy plan-level editing access implies all segmented editing capabilities
  // until explicit segmented entitlements are provided.
  const effectivePlanContentLibrary = planContentLibrary || planEditing;
  const effectivePlanProjects = planProjects || planEditing;
  const effectivePlanEditor = planEditor || planEditing;

  // Numeric RTMP destinations cap is canonical for availability. Same rule as
  // the server: multistream = Stream Destinations = at least one destination.
  const planDestinations = rtmpDestinationsMax >= 1;
  const planMultistream = planDestinations;

  return {
    platform: {
      hlsEnabled: platformHlsEnabled,
      transcodeEnabled: platformTranscodeEnabled,
      recordingEnabled: platformRecordingEnabled,
    },
    usage: {
      broadcastMinutes: {
        visible: canShowBroadcastMinutes,
      },
    },
    plan: {
      rtmpDestinationsMax,
      hlsRuntime: planHlsRuntime,
      hlsSetup: planHlsSetup,
      destinations: planDestinations,
      multistream: planMultistream,
      editing: planEditing,
    },
    canUse: {
      hlsRuntime: isFeatureAvailable(planHlsRuntime, platformHlsEnabled),
      hlsSetup: isFeatureAvailable(planHlsSetup, platformHlsEnabled),
      destinations: isFeatureAvailable(planDestinations, platformTranscodeEnabled),
      multistream: isFeatureAvailable(planMultistream, platformTranscodeEnabled),
    },
    editing: {
      // Legacy: keep for backwards compatibility (now mapped to editor rules)
      allowed: isFeatureAvailable(effectivePlanEditor, platformEditorEnabled && platformTranscodeEnabled),
    },
    contentLibrary: {
      allowed: isFeatureAvailable(effectivePlanContentLibrary, platformContentLibraryEnabled),
    },
    projects: {
      // Derived: editor implies projects, but projects do not imply editor.
      allowed:
        isFeatureAvailable(effectivePlanProjects, platformProjectsEnabled) ||
        isFeatureAvailable(effectivePlanEditor, platformEditorEnabled && platformTranscodeEnabled),
    },
    editor: {
      allowed: isFeatureAvailable(effectivePlanEditor, platformEditorEnabled && platformTranscodeEnabled),
    },
    myContent: {
      allowed: platformMyContentEnabled,
    },
    myContentRecordings: {
      allowed: platformMyContentEnabled && platformMyContentRecordingsEnabled,
    },
    advancedScreenShare: {
      allowed: isNewPlatformFlagEnabled((pf as any).advancedScreenShareEnabled),
    },
    audioMixer: {
      allowed: isNewPlatformFlagEnabled((pf as any).audioMixerEnabled),
    },
    monetization: (() => {
      const platformEnabled = isNewPlatformFlagEnabled((pf as any).monetizationEnabled);
      const planIncluded = resolveEntitlementBoolean(features, ["monetization"]);
      return { allowed: platformEnabled && planIncluded, platformEnabled, planIncluded };
    })(),
    payPerView: (() => {
      const platformEnabled = isNewPlatformFlagEnabled((pf as any).payPerViewEnabled);
      const planIncluded = resolveEntitlementBoolean(features, ["payPerView"]);
      return { allowed: platformEnabled && planIncluded, platformEnabled, planIncluded };
    })(),
  };
}

type FeatureAccess = ReturnType<typeof computeEffectiveFeatureAccess>;

/** Feature access straight from the server engine (no client-side defaults). */
function computeFromServerEntitlements(ent: ServerEntitlements): FeatureAccess {
  const f = ent.features;
  const pf = ent.planFeatures;
  const flags = ent.platformFlags;
  const destinationsLimit = ent.limits.destinations;
  return {
    platform: {
      hlsEnabled: flags.hlsSettingsTab === true,
      transcodeEnabled: flags.transcodeEnabled === true,
      recordingEnabled: flags.recording === true,
    },
    usage: {
      broadcastMinutes: {
        // Broadcast/transcode is no longer a separate usage bucket.
        visible: false,
      },
    },
    plan: {
      rtmpDestinationsMax: destinationsLimit,
      hlsRuntime: pf.hls,
      hlsSetup: pf.hlsCustomization,
      destinations: pf.multistream,
      multistream: pf.multistream,
      editing: pf.editing,
    },
    canUse: {
      hlsRuntime: f.hls,
      hlsSetup: f.hlsCustomization,
      destinations: f.multistream,
      multistream: f.multistream,
    },
    editing: {
      allowed: f.editing && flags.transcodeEnabled === true,
    },
    contentLibrary: {
      allowed: f.contentLibrary,
    },
    projects: {
      allowed: f.projects || (f.editing && flags.transcodeEnabled === true),
    },
    editor: {
      allowed: f.editing && flags.transcodeEnabled === true,
    },
    myContent: {
      allowed: flags.myContentEnabled === true,
    },
    myContentRecordings: {
      allowed: flags.myContentEnabled === true && flags.myContentRecordingsEnabled === true,
    },
    advancedScreenShare: {
      allowed: flags.advancedScreenShareEnabled === true,
    },
    audioMixer: {
      allowed: flags.audioMixerEnabled === true,
    },
    monetization: {
      allowed: f.monetization,
      platformEnabled: flags.monetizationEnabled === true,
      planIncluded: pf.monetization,
    },
    payPerView: {
      allowed: f.payPerView,
      platformEnabled: flags.payPerViewEnabled === true,
      planIncluded: pf.payPerView,
    },
  };
}
