import { isFeatureAvailable, isPlatformEnabled } from "./featureAvailability";

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

  // Segmented, safety-first platform switches:
  // - Missing/undefined => disabled (must be explicitly enabled)
  contentLibraryEnabled?: unknown;
  libraryEnabled?: unknown;
  projectsEnabled?: unknown;
  editorEnabled?: unknown;

  // My Content umbrella + sub-features:
  // - Missing/undefined => fall back to legacy behavior (older servers)
  // - Present but false => disabled (must be explicitly enabled)
  myContentEnabled?: unknown;
  myContentRecordingsEnabled?: unknown;
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

function resolveLegacyEditingPlatformEnabled(platformFlags: Record<string, unknown> | null | undefined): boolean {
  const f: any = platformFlags || {};
  // Safety-first: only opt-in when explicitly enabled.
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
    rtmpDestinationsMax: number;
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
} {
  const eff = input.effectiveEntitlements || {};
  const pf = (input.platformFlags && typeof input.platformFlags === "object") ? input.platformFlags : {};

  const platformLegacyEditingEnabled = resolveLegacyEditingPlatformEnabled(pf as any);

  // Prefer explicit platform kill-switches; default to enabled when missing.
  const platformHlsEnabled = isPlatformEnabled((pf as any).hlsEnabled ?? (pf as any).hlsSettingsTab);
  const platformTranscodeEnabled = isPlatformEnabled((pf as any).transcodeEnabled);
  const platformRecordingEnabled = isPlatformEnabled((pf as any).recordingEnabled);

  // New segmented flags: missing => disabled.
  const platformContentLibraryEnabled = isNewPlatformFlagEnabled(
    (pf as any).contentLibraryEnabled ?? (pf as any).libraryEnabled
  ) || platformLegacyEditingEnabled;
  const platformProjectsEnabled = isNewPlatformFlagEnabled((pf as any).projectsEnabled) || platformLegacyEditingEnabled;
  const platformEditorEnabled = isNewPlatformFlagEnabled((pf as any).editorEnabled) || platformLegacyEditingEnabled;

  // My Content: prefer explicit flags when present; otherwise fall back to legacy behavior.
  const hasMyContentEnabledFlag = Object.prototype.hasOwnProperty.call(pf, "myContentEnabled");
  const platformMyContentEnabled = hasMyContentEnabledFlag
    ? isNewPlatformFlagEnabled((pf as any).myContentEnabled)
    : (platformContentLibraryEnabled || platformProjectsEnabled || platformEditorEnabled || platformLegacyEditingEnabled);

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

  // Numeric RTMP destinations cap is canonical for availability.
  const planDestinations = rtmpDestinationsMax >= 1;
  const planMultistream = rtmpDestinationsMax >= 2;

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
  };
}
