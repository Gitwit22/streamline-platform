import { useCallback } from "react";

export type PlatformKey = "youtube" | "facebook" | "twitch" | "instagram" | "custom";

export type PlatformState = {
  selected: boolean;
  manualFields: Array<{ id: string; value: string; base?: string }>;
  error: string | null;
  info: string | null;
};

export type EffectiveDestinationPayload = {
  platform: PlatformKey;
  source: "main" | "session";
  streamKey?: string;
  destinationId?: string;
  targetId?: string;
  rtmpUrlBase?: string;
};

export type SessionRtmpDestination = {
  type: "instagram";
  protocol: "rtmp";
  rtmpUrl: string;
  streamKey: string;
  label?: string;
  layoutPreset?: "instagram_reels_9x16";
  videoFit?: "cover" | "contain";
};

export type DestinationsStartPayload = {
  youtubeKey?: string;
  facebookKey?: string;
  twitchKey?: string;
  enabledTargetIds?: string[];
  sessionKeys?: Record<string, { rtmpUrlBase?: string; streamKey?: string }>;
  destinations?: EffectiveDestinationPayload[];
  extraDestinations?: SessionRtmpDestination[];
  presetId?: string;
};

export type DestinationsStartMeta = {
  hasSelection: boolean;
  hasErrors: boolean;
};

export type DestinationsStartComputeResult = {
  isValid: boolean;
  startError: string | null;
  nextPlatformState: Record<PlatformKey, PlatformState>;
  payload: DestinationsStartPayload | null;
  errors: string[];
  meta: DestinationsStartMeta;
};

export type UseDestinationsStartPayloadArgs = {
  platformState: Record<PlatformKey, PlatformState>;
  platformOrder: PlatformKey[];
  mainByPlatform: Record<PlatformKey, any>;
  selectedPresetId?: string;
};

export function useDestinationsStartPayload({
  platformState,
  platformOrder,
  mainByPlatform,
  selectedPresetId,
}: UseDestinationsStartPayloadArgs) {
  const compute = useCallback((): DestinationsStartComputeResult => {
    let startError: string | null = null;
    let nextPlatformStateOuter: Record<PlatformKey, PlatformState> | null = null;
    const errors: string[] = [];

    const setStartError = (s: string | null) => {
      startError = s;
      if (typeof s === "string" && s) errors.push(s);
    };

    const setPlatformState = (s: Record<PlatformKey, PlatformState>) => {
      nextPlatformStateOuter = s;
    };

    let computedPayload: DestinationsStartPayload | null = null;

    const runFrozen = () => {
      const sessionKeyPayload: Record<string, { rtmpUrlBase?: string; streamKey?: string }> = {};
      const instagramDestinations: SessionRtmpDestination[] = [];
      const enabledTargetIds: string[] = [];
      const effectiveDestinations: EffectiveDestinationPayload[] = [];
      let youtubeKey: string | undefined;
      let facebookKey: string | undefined;
      let twitchKey: string | undefined;

      let hasSelection = false;
      let hasErrors = false;
      setStartError(null);

      const nextPlatformState = { ...platformState };

      platformOrder.forEach((platform) => {
        const state = platformState[platform];
        nextPlatformState[platform] = { ...state, error: null, info: state.info };

        if (platform === "instagram") {
          const main = mainByPlatform[platform];
          const hasMain = !!main;
          const firstManual = state.manualFields.find((f) => (f.value && f.value.trim()) || (f.base && f.base.trim()));
          const treatedAsSelected = state.selected || !!firstManual;
          if (!treatedAsSelected) return;
          hasSelection = true;

          const rtmpUrl = (firstManual?.base || "").trim();
          const streamKey = (firstManual?.value || "").trim();

          if (!rtmpUrl || !streamKey) {
            nextPlatformState[platform].error = !rtmpUrl ? "RTMP URL required." : "Stream key required.";
            hasErrors = true;
            return;
          }

          const hasValidScheme = rtmpUrl.startsWith("rtmp://") || rtmpUrl.startsWith("rtmps://");
          if (!hasValidScheme) {
            nextPlatformState[platform].error = "RTMP URL must start with rtmp:// or rtmps://.";
            hasErrors = true;
            return;
          }

          instagramDestinations.push({
            type: "instagram",
            protocol: "rtmp",
            rtmpUrl,
            streamKey,
            label: "Instagram",
            layoutPreset: "instagram_reels_9x16",
            videoFit: "cover",
          });

          if (!hasMain && !state.manualFields.length) {
            nextPlatformState[platform].info = "Session-only. Not saved for reuse.";
          }
          return;
        }

        const main = mainByPlatform[platform];
        const mainUsable = !!(main && main.hasKey && main.mode !== "connected");
        const manualField = state.manualFields.find((f) => f.value.trim());
        const treatedAsSelected = state.selected || (platform === "custom" && !!manualField);
        if (!treatedAsSelected) return;
        hasSelection = true;
        let sessionKey = manualField?.value.trim() || "";
        const customBase = manualField?.base?.trim();
        const hasKey = mainUsable || !!sessionKey;
        const targetId = main?.targetId || main?.id;
        let rtmpBase = customBase || main?.rtmpUrlBase || getDefaultRtmpBase(platform);

        // Allow a full RTMP URL in the key box (base optional for custom)
        if (platform === "custom" && !rtmpBase && sessionKey) {
          const idx = sessionKey.lastIndexOf("/");
          const maybeProto = sessionKey.slice(0, idx);
          if (idx > 8 && maybeProto.startsWith("rtmp")) {
            const fullBase = sessionKey.slice(0, idx);
            const tailKey = sessionKey.slice(idx + 1);
            if (fullBase && tailKey) {
              rtmpBase = fullBase;
              sessionKey = tailKey;
            }
          }
        }

        if (platform === "custom") {
          if (!sessionKey) {
            nextPlatformState[platform].error = "Add a stream key (or full RTMP URL).";
            hasErrors = true;
            return;
          }
          // Base URL is optional; will be parsed from full RTMP if provided, otherwise handled server-side.
        }

        if (platform === "custom" && !rtmpBase) {
          nextPlatformState[platform].error = "RTMP ingest URL required.";
          hasErrors = true;
          return;
        }

        if (!hasKey) {
          nextPlatformState[platform].error = "No stream key set.";
          hasErrors = true;
          return;
        }

        effectiveDestinations.push({
          platform,
          source: sessionKey ? "session" : "main",
          streamKey: sessionKey || undefined,
          destinationId: main?.id,
          targetId,
          rtmpUrlBase: rtmpBase,
        });

        if (mainUsable && main) {
          enabledTargetIds.push(main.id);
          if (sessionKey) {
            sessionKeyPayload[targetId || main.id] = {
              rtmpUrlBase: rtmpBase,
              streamKey: sessionKey,
            };
          }
        } else if (sessionKey) {
          if (platform === "youtube") youtubeKey = sessionKey;
          if (platform === "facebook") facebookKey = sessionKey;
          if (platform === "twitch") twitchKey = sessionKey;
        }
      });

      setPlatformState(nextPlatformState);

      if (!hasSelection) {
        setStartError("Add at least one stream destination or custom RTMP key.");
        return;
      }

      if (hasErrors) {
        setStartError("Fix the highlighted destinations before starting.");
        return;
      }

      computedPayload = {
        youtubeKey,
        facebookKey,
        twitchKey,
        enabledTargetIds: enabledTargetIds.length ? enabledTargetIds : undefined,
        sessionKeys: Object.keys(sessionKeyPayload).length ? sessionKeyPayload : undefined,
        destinations: effectiveDestinations,
        extraDestinations: instagramDestinations.length ? instagramDestinations : undefined,
        presetId: selectedPresetId,
      };
    };

    runFrozen();

    const resolvedNextPlatformState = nextPlatformStateOuter || platformState;
    const platformErrors = platformOrder
      .map((p) => resolvedNextPlatformState[p]?.error)
      .filter((e): e is string => typeof e === "string" && !!e);

    platformErrors.forEach((e) => {
      if (!errors.includes(e)) errors.push(e);
    });

    const isValid = !!computedPayload;

    const meta: DestinationsStartMeta =
      startError === "Add at least one stream destination or custom RTMP key."
        ? { hasSelection: false, hasErrors: false }
        : startError === "Fix the highlighted destinations before starting."
          ? { hasSelection: true, hasErrors: true }
          : isValid
            ? { hasSelection: true, hasErrors: false }
            : { hasSelection: false, hasErrors: false };

    return {
      isValid,
      startError,
      nextPlatformState: resolvedNextPlatformState,
      payload: isValid ? computedPayload : null,
      errors,
      meta,
    };
  }, [mainByPlatform, platformOrder, platformState, selectedPresetId]);

  return { compute };
}

export function normalizeStartLivePayloadFromDestinationsKeys(keys: {
  youtubeKey?: string;
  facebookKey?: string;
  twitchKey?: string;
  enabledTargetIds?: string[];
  sessionKeys?: Record<string, { rtmpUrlBase?: string; streamKey?: string }>;
  destinations?: Array<{
    platform: "youtube" | "facebook" | "twitch" | "custom";
    source: "main" | "session";
    streamKey?: string;
    destinationId?: string;
    targetId?: string;
    rtmpUrlBase?: string;
  }>;
  extraDestinations?: Array<{
    type: "instagram";
    protocol: "rtmp";
    rtmpUrl: string;
    streamKey: string;
    label?: string;
  }>;
  presetId?: string;
}) {
  const selectedPresetId = keys.presetId;
  const destinationInputs = Array.isArray(keys.destinations) ? keys.destinations : [];
  let youtubeKey = keys.youtubeKey;
  let facebookKey = keys.facebookKey;
  let twitchKey = keys.twitchKey;
  let enabledTargetIds = Array.isArray(keys.enabledTargetIds) ? keys.enabledTargetIds.filter((id) => !!id) : [];
  let sessionKeyMap: Record<string, { rtmpUrlBase?: string; streamKey?: string }> = keys.sessionKeys ? { ...keys.sessionKeys } : {};
  const extraDestinations = Array.isArray(keys.extraDestinations) ? keys.extraDestinations : [];

  if (destinationInputs.length) {
    const fromDestinations: string[] = [];
    destinationInputs.forEach((item) => {
      const trimmed = (item.streamKey || "").trim();
      if (item.source === "main" && item.destinationId) {
        fromDestinations.push(item.destinationId);
      }
      if (item.source === "session" && trimmed) {
        if (item.destinationId || item.targetId) {
          const keyId = item.targetId || item.destinationId!;
          sessionKeyMap[keyId] = { rtmpUrlBase: item.rtmpUrlBase, streamKey: trimmed };
        } else {
          if (item.platform === "youtube") youtubeKey = trimmed;
          if (item.platform === "facebook") facebookKey = trimmed;
          if (item.platform === "twitch") twitchKey = trimmed;
          if (item.platform === "custom") {
            let base = item.rtmpUrlBase;
            let key = trimmed;
            if (!base && trimmed.startsWith("rtmp")) {
              const idx = trimmed.lastIndexOf("/");
              if (idx > 8) {
                const maybeBase = trimmed.slice(0, idx);
                const maybeKey = trimmed.slice(idx + 1);
                if (maybeBase && maybeKey) {
                  base = maybeBase;
                  key = maybeKey;
                }
              }
            }
            const keyId = `custom-${Object.keys(sessionKeyMap).length + 1}`;
            sessionKeyMap[keyId] = { rtmpUrlBase: base, streamKey: key };
          }
        }
      }
    });
    if (fromDestinations.length) {
      const merged = [...enabledTargetIds];
      fromDestinations.forEach((id) => {
        if (!merged.includes(id)) merged.push(id);
      });
      enabledTargetIds = merged;
    }
  }

  const destIds = Array.isArray(enabledTargetIds)
    ? enabledTargetIds.filter((id) => !!id)
    : [];
  const hasSessionKeys = Object.values(sessionKeyMap || {}).some((entry) => !!entry?.streamKey);
  const hasDirectKeys = !!(youtubeKey || facebookKey || twitchKey);
  const hasExtraDestinations = (extraDestinations || []).some((d) => {
    const rtmpUrl = typeof (d as any)?.rtmpUrl === "string" ? (d as any).rtmpUrl.trim() : "";
    const streamKey = typeof (d as any)?.streamKey === "string" ? (d as any).streamKey.trim() : "";
    return !!(rtmpUrl && streamKey);
  });

  const startLivePayload = {
    youtubeStreamKey: youtubeKey,
    facebookStreamKey: facebookKey,
    twitchStreamKey: twitchKey,
    enabledTargetIds: destIds.length ? destIds : undefined,
    sessionKeys: hasSessionKeys ? sessionKeyMap : undefined,
    extraDestinations: hasExtraDestinations ? (extraDestinations as any) : undefined,
    presetId: selectedPresetId,
  };

  return startLivePayload;
}

function getDefaultRtmpBase(p: PlatformKey): string {
  switch (p) {
    case "youtube":
      return "rtmp://a.rtmp.youtube.com/live2";
    case "facebook":
      return "rtmps://live-api-s.facebook.com:443/rtmp/";
    case "twitch":
      return "rtmp://live.twitch.tv/app";
    case "instagram":
      return "rtmps://edgetee-upload-det1-1.xx.fbcdn.net:443/rtmp/";
    case "custom":
      return "";
    default:
      return "";
  }
}
