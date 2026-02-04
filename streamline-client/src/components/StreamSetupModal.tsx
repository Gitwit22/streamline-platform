import { useEffect, useMemo, useState } from "react";
import { type DestinationItem } from "../services/destinations";
import { formatLimitLabel } from "../lib/entitlements";
import { API_BASE } from "../lib/apiBase";
import { apiFetchAuth } from "../lib/api";
import { APP_BASE } from "../lib/appBase";
import { getHlsStatus, startHls, stopHls } from "../services/hls";
import CollapsibleSection from "./CollapsibleSection";
import { getFeatureErrorMessage } from "../lib/featureErrors";

type PlatformKey = "youtube" | "facebook" | "twitch" | "instagram" | "custom";

const PLATFORM_CONFIG: Record<PlatformKey, { label: string; accent: string }> = {
  youtube: { label: "YouTube", accent: "#ef4444" },
  facebook: { label: "Facebook", accent: "#3b82f6" },
  twitch: { label: "Twitch", accent: "#a855f7" },
  instagram: { label: "Instagram", accent: "#f97316" },
  custom: { label: "Custom (RTMP)", accent: "#14b8a6" },
};

const MAX_MANUAL_FIELDS = 3;

type PlatformState = {
  selected: boolean;
  manualFields: Array<{ id: string; value: string; base?: string }>;
  error: string | null;
  info: string | null;
};

type EffectiveDestinationPayload = {
  platform: PlatformKey;
  source: "main" | "session";
  streamKey?: string;
  destinationId?: string;
  targetId?: string;
  rtmpUrlBase?: string;
};

const buildDefaultPlatformState = (): Record<PlatformKey, PlatformState> => ({
  youtube: { selected: false, manualFields: [], error: null, info: null },
  facebook: { selected: false, manualFields: [], error: null, info: null },
  twitch: { selected: false, manualFields: [], error: null, info: null },
  instagram: { selected: false, manualFields: [], error: null, info: null },
  custom: { selected: false, manualFields: [], error: null, info: null },
});

type RoomUiSectionKey = "destinations" | "recording" | "layout" | "audio" | "hls";

type RoomUiState = Record<RoomUiSectionKey, boolean>;

const DEFAULT_ROOM_UI_STATE: RoomUiState = {
  destinations: false,
  recording: false,
  layout: false,
  audio: false,
  hls: false,
};

const ROOM_UI_STORAGE_PREFIX = "sl_room_ui_v1";

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

type SessionRtmpDestination = {
  type: "instagram";
  protocol: "rtmp";
  rtmpUrl: string;
  streamKey: string;
  label?: string;
  // Optional per-destination layout hints (kept minimal in UI; defaults applied automatically)
  layoutPreset?: "instagram_reels_9x16";
  videoFit?: "cover" | "contain";
};

interface Props {
  open: boolean;
  onClose: () => void;
  roomName: string;
  roomId: string;
  roomAccessToken?: string;
  selectedPresetId?: string;
  defaultRecordingMode?: "cloud" | "dual";
  
  // Stream state
  streamStatus: "idle" | "starting" | "live" | "stopping";
  onStartStream: (params: {
    youtubeKey?: string;
    facebookKey?: string;
    twitchKey?: string;
    enabledTargetIds?: string[];
    sessionKeys?: Record<string, { rtmpUrlBase?: string; streamKey?: string }>;
    destinations?: EffectiveDestinationPayload[];
    extraDestinations?: SessionRtmpDestination[];
    presetId?: string;
  }) => Promise<void>;
  onStopStream: () => Promise<void>;
  
  // Recording state (independent from stream)
  recordingStatus: "idle" | "recording" | "stopping" | "stopped" | "error";
  onStartRecording: (params: { mode: "cloud" | "dual"; presetId?: string }) => Promise<void>;
  onStopRecording: () => Promise<void>;
  recordingEnabled?: boolean;
  recordingElapsedSeconds?: number;
  dualRecordingAllowed?: boolean;
  maxGuests?: number;
  multistreamAllowed?: boolean;
  // Numeric RTMP destinations cap from plan/entitlements. 0 = disabled,
  // 1 = single destination, >1 = multistream up to this number.
  rtmpDestinationsMax?: number;
  hlsEnabled?: boolean;
  hlsCustomizationEnabled?: boolean;
  onUpgradeHls?: () => void;
  // Controls whether the HLS Setup (branding/config) section is rendered at all (platform-level flag).
  showHlsSection?: boolean;

  // Optional: whether this caller has permission to start/stop HLS.
  canStartStopHls?: boolean;

  // Optional: whether plan/platform entitlements have hydrated.
  entitlementsReady?: boolean;

  // Optional: plan + per-clip recording cap (in minutes)
  planId?: string;
  recordingMaxMinutes?: number;

  // Optional: per-platform main destination (already saved)
  savedDestinations?: Array<DestinationItem & { label?: string }>;
}

export default function StreamSetupModalV2({
  open,
  onClose,
  roomName,
  roomId,
  roomAccessToken,
  selectedPresetId,
  defaultRecordingMode = "cloud",
  streamStatus,
  onStartStream,
  onStopStream,
  recordingStatus,
  onStartRecording,
  onStopRecording,
  recordingEnabled = true,
  recordingElapsedSeconds = 0,
  dualRecordingAllowed = false,
  maxGuests,
  multistreamAllowed = true,
  rtmpDestinationsMax,
  hlsEnabled = true,
  hlsCustomizationEnabled = false,
  onUpgradeHls,
  showHlsSection = true,
  canStartStopHls = true,
  entitlementsReady = true,
  planId,
  recordingMaxMinutes,
  savedDestinations,
}: Props) {
  const [destinations, setDestinations] = useState<Array<DestinationItem & { label?: string }>>(savedDestinations || []);
  const [platformState, setPlatformState] = useState<Record<PlatformKey, PlatformState>>(buildDefaultPlatformState);
  const [startError, setStartError] = useState<string | null>(null);
  const [warmupActive, setWarmupActive] = useState(false);
  const [warmupStartedAt, setWarmupStartedAt] = useState<number | null>(null);
  const [warmupPlatforms, setWarmupPlatforms] = useState<PlatformKey[]>([]);
  const [warmupReadyMap, setWarmupReadyMap] = useState<Record<PlatformKey, boolean>>({
    youtube: false,
    facebook: false,
    twitch: false,
    instagram: false,
    custom: false,
  });
  const [warmupLogged, setWarmupLogged] = useState(false);

  const [roomUiState, setRoomUiState] = useState<RoomUiState>(DEFAULT_ROOM_UI_STATE);

  const [hlsStatus, setHlsStatus] = useState<"idle" | "starting" | "live" | "error">("idle");
  const [hlsPlaylistUrl, setHlsPlaylistUrl] = useState<string | null>(null);
  const [hlsEgressId, setHlsEgressId] = useState<string | null>(null);
  const [hlsError, setHlsError] = useState<string | null>(null);
  const [hlsBusy, setHlsBusy] = useState(false);
  const [boundEmbedId, setBoundEmbedId] = useState<string | null>(null);
  const [boundEmbedName, setBoundEmbedName] = useState<string>("");
  const [boundEmbedViewerPath, setBoundEmbedViewerPath] = useState<string>("");
  const [boundEmbedLoading, setBoundEmbedLoading] = useState(false);
  const [boundEmbedError, setBoundEmbedError] = useState<string | null>(null);
  const [hlsAdvancedOpen, setHlsAdvancedOpen] = useState(false);

  const platformOrder: PlatformKey[] = ["youtube", "facebook", "twitch", "instagram", "custom"];

  const [recordingMode, setRecordingMode] = useState<"cloud" | "dual">(defaultRecordingMode);

  // Canonical: HLS is always keyed by Firestore roomId.
  const hlsRoomId = roomId?.trim() || "";

  const looksLikeName =
    hlsRoomId.includes(" ") || hlsRoomId.includes("–") || hlsRoomId.includes("#");

  // HLS controls unlock once we have a canonical Firestore roomId
  // (and not a human-readable name). This matches the host/control-plane
  // contract where everything is keyed by roomId.
  const hlsRoomReady = !!hlsRoomId && !looksLikeName;

  const effectiveHlsRoomId = hlsRoomId;

  const hlsViewerUrl = boundEmbedId
    ? `${APP_BASE || (typeof window !== "undefined" ? window.location.origin : "")}/live/${encodeURIComponent(
        boundEmbedId,
      )}`
    : "";

  const authHeaders = useMemo(() => {
    const token = typeof window !== "undefined" ? window.localStorage.getItem("authToken") : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  useEffect(() => {
    setRecordingMode(defaultRecordingMode);
  }, [defaultRecordingMode]);

  useEffect(() => {
    setDestinations(savedDestinations || []);
  }, [savedDestinations]);

  // Load per-room UI state (collapsible sections) from localStorage on first open
  useEffect(() => {
    if (!hlsRoomId) return;
    try {
      const key = `${ROOM_UI_STORAGE_PREFIX}:${hlsRoomId}`;
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        setRoomUiState(DEFAULT_ROOM_UI_STATE);
        return;
      }
      const parsed = JSON.parse(raw) || {};
      const next: RoomUiState = {
        destinations: !!parsed.destinations,
        recording: !!parsed.recording,
        layout: !!parsed.layout,
        audio: !!parsed.audio,
        hls: !!parsed.hls,
      };
      setRoomUiState(next);
    } catch {
      setRoomUiState(DEFAULT_ROOM_UI_STATE);
    }
  }, [hlsRoomId]);

  // Whenever the modal opens for a different room, clear any previous
  // bound embed state so we never show a "ghost" connection while
  // the new room's binding is being resolved.
  useEffect(() => {
    if (!open) {
      setBoundEmbedId(null);
      setBoundEmbedName("");
      setBoundEmbedViewerPath("");
      setBoundEmbedError(null);
      setBoundEmbedLoading(false);
      return;
    }

    // On open/room change, clear to a neutral state; the
    // active-embed fetch will repopulate as needed.
    setBoundEmbedId(null);
    setBoundEmbedName("");
    setBoundEmbedViewerPath("");
    setBoundEmbedError(null);
  }, [open, hlsRoomId]);

  const updateRoomUiSection = (section: RoomUiSectionKey, open: boolean) => {
    setRoomUiState((prev) => {
      const safePrev = prev || DEFAULT_ROOM_UI_STATE;
      const next: RoomUiState = { ...DEFAULT_ROOM_UI_STATE, ...safePrev, [section]: open };
      try {
        const key = `${ROOM_UI_STORAGE_PREFIX}:${hlsRoomId}`;
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  // Fetch which Saved Embed (if any) this room is bound to, then
  // resolve basic embed metadata for the viewer link.
  useEffect(() => {
    if (!open) return;
    if (!hlsRoomReady) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetchAuth(
          `${API_BASE}/api/rooms/${encodeURIComponent(hlsRoomId)}/active-embed`,
          {
            cache: "no-store",
            headers: {
              ...authHeaders,
            },
          },
          { allowNonOk: true }
        );
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          return;
        }
        const activeEmbedId = String(payload?.activeEmbedId || "").trim();
        const savedEmbedId = String(payload?.savedEmbedId || "").trim();
        const embedId = activeEmbedId || savedEmbedId;
        if (!cancelled && embedId) {
          setBoundEmbedId(embedId);
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, hlsRoomReady, hlsRoomId, authHeaders]);

  // Resolve basic embed metadata for the bound embed so we can show
  // a friendly connection label + viewer URL. This uses the public
  // resolver so it stays in sync with the viewer page.
  useEffect(() => {
    if (!boundEmbedId) {
      setBoundEmbedName("");
      setBoundEmbedViewerPath("");
      return;
    }

    let cancelled = false;
    (async () => {
      setBoundEmbedLoading(true);
      setBoundEmbedError(null);
      try {
        const res = await fetch(`${API_BASE}/api/saved-embeds/public/${encodeURIComponent(boundEmbedId)}`);
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(payload?.error || "Failed to load embed");
        }
        if (cancelled) return;
        const name = String(payload?.name || payload?.label || "").trim();
        const viewerPath = String(payload?.viewerPath || `/live/${boundEmbedId}`).trim();
        setBoundEmbedName(name || boundEmbedId);
        setBoundEmbedViewerPath(viewerPath);
      } catch (e: any) {
        if (!cancelled) {
          setBoundEmbedError(e?.message || "Failed to load embed");
          setBoundEmbedName("");
          setBoundEmbedViewerPath("");
        }
      } finally {
        if (!cancelled) setBoundEmbedLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [boundEmbedId]);

  // Initial one-shot fetch of HLS status so we can show chip even when collapsed
  useEffect(() => {
    if (!open) return;
    if (!hlsRoomReady) {
      setHlsStatus("idle");
      setHlsPlaylistUrl(null);
      setHlsEgressId(null);
      setHlsError(null);
      return;
    }
    if (!effectiveHlsRoomId) {
      setHlsStatus("idle");
      setHlsPlaylistUrl(null);
      setHlsEgressId(null);
      setHlsError(null);
      return;
    }
    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const data = await getHlsStatus(effectiveHlsRoomId, roomAccessToken || undefined);
        if (cancelled) return;
        const status = (data?.status as string) || "idle";
        setHlsStatus(status === "starting" || status === "live" || status === "error" ? status : "idle");
        setHlsPlaylistUrl(data?.playlistUrl ?? null);
        setHlsEgressId(data?.egressId ?? null);
        setHlsError(data?.error ?? null);
      } catch (err: any) {
        if (cancelled) return;
        const msg = String(err?.message || "");
        if (msg.startsWith("status_failed_404")) {
          setHlsStatus("idle");
          setHlsPlaylistUrl(null);
          setHlsEgressId(null);
          setHlsError(null);
          return;
        }
        if (msg.startsWith("status_failed_403")) {
          let friendly = "You don't have permission to use HLS for this embed.";
          const parts = msg.split(":", 2);
          if (parts.length === 2) {
            try {
              const parsed = JSON.parse(parts[1] || "{}");
              const code = String((parsed && (parsed.error || parsed.reason)) || "").trim();
              if (code === "hls_not_in_plan") {
                friendly = getFeatureErrorMessage("hls_not_in_plan", "hls");
              } else if (code === "feature_not_entitled") {
                friendly = getFeatureErrorMessage("feature_not_entitled", "hls");
              } else if (code === "feature_disabled") {
                friendly = getFeatureErrorMessage("feature_disabled", "hls");
              } else if (code === "room_mismatch") {
                friendly = "This embed is linked to a different show. Create a new embed for this room from Settings → HLS Setup.";
              }
            } catch {
              // fall back to default friendly message
            }
          }
          setHlsStatus("error");
          setHlsError(friendly);
          return;
        }
        setHlsStatus("error");
        setHlsError("Failed to fetch HLS status");
      }
    };

    fetchStatus();

    return () => {
      cancelled = true;
    };
  }, [open, effectiveHlsRoomId, hlsRoomReady, roomAccessToken]);

  // Poll while HLS section is open or status is starting
  useEffect(() => {
    if (!open) return;
    if (!hlsRoomReady) return;
    if (!effectiveHlsRoomId) return;

    const shouldPoll = roomUiState.hls && (hlsStatus === "starting" || hlsStatus === "live");
    if (!shouldPoll) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const data = await getHlsStatus(effectiveHlsRoomId, roomAccessToken || undefined);
        if (cancelled) return;
        const status = (data?.status as string) || "idle";
        setHlsStatus(status === "starting" || status === "live" || status === "error" ? status : "idle");
        setHlsPlaylistUrl(data?.playlistUrl ?? null);
        setHlsEgressId(data?.egressId ?? null);
        setHlsError(data?.error ?? null);
      } catch (err: any) {
        if (!cancelled) {
          const msg = String(err?.message || "");
          if (msg.startsWith("status_failed_403")) {
            let friendly = "You don't have permission to use HLS for this embed.";
            const parts = msg.split(":", 2);
            if (parts.length === 2) {
              try {
                const parsed = JSON.parse(parts[1] || "{}");
                const code = String((parsed && (parsed.error || parsed.reason)) || "").trim();
                if (code === "hls_not_in_plan") {
                  friendly = getFeatureErrorMessage("hls_not_in_plan", "hls");
                } else if (code === "feature_not_entitled") {
                  friendly = getFeatureErrorMessage("feature_not_entitled", "hls");
                } else if (code === "feature_disabled") {
                  friendly = getFeatureErrorMessage("feature_disabled", "hls");
                } else if (code === "room_mismatch") {
                  friendly = "This embed is linked to a different show. Create a new embed for this room from Settings → HLS Setup.";
                }
              } catch {
                // fall back to default friendly message
              }
            }
            setHlsStatus("error");
            setHlsError(friendly);
          } else {
            // Soft failure; keep last known status but surface a generic error
            setHlsStatus("error");
            setHlsError("Failed to poll HLS status");
          }
        }
      }
    };

    poll();
    const id = window.setInterval(poll, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [open, effectiveHlsRoomId, roomUiState.hls, hlsStatus]);

  const mainByPlatform = useMemo(() => {
    const map: Partial<Record<PlatformKey, DestinationItem>> = {};
    destinations.forEach((d) => {
      const platform = d.platform as PlatformKey;
      if (!platform || !(platform in PLATFORM_CONFIG)) return;
      const current = map[platform];
      const currentPreferred = current ? current.persistent !== false : false;
      const candidatePreferred = d.persistent !== false;
      if (!current) {
        map[platform] = d;
        return;
      }
      if (candidatePreferred && !currentPreferred) {
        map[platform] = d;
        return;
      }
      if ((d.updatedAt || 0) > (current.updatedAt || 0)) {
        map[platform] = d;
      }
    });
    return map;
  }, [destinations]);

  const updatePlatformState = (platform: PlatformKey, partial: Partial<PlatformState>) => {
    setPlatformState((prev) => ({ ...prev, [platform]: { ...prev[platform], ...partial } }));
  };

  useEffect(() => {
    if (!open) {
      // Preserve entered keys across close/reopen within the same session.
      // Only clear transient errors/flags.
      setPlatformState((prev) => {
        const next: Record<PlatformKey, PlatformState> = { ...prev };
        (Object.keys(next) as PlatformKey[]).forEach((p) => {
          next[p] = { ...next[p], error: null, info: null };
        });
        return next;
      });
      setStartError(null);
      setWarmupStartedAt(null);
      setWarmupReadyMap({ youtube: false, facebook: false, twitch: false, instagram: false, custom: false });
      setWarmupLogged(false);
    }
  }, [open]);

  useEffect(() => {
    if (!warmupActive || !warmupStartedAt) return;

    if (streamStatus === "live") {
      const totalMs = Date.now() - warmupStartedAt;
      if (!warmupLogged) {
        const perPlatform: Record<string, number> = {};
        warmupPlatforms.forEach((p) => {
          perPlatform[p] = totalMs;
        });
        console.log("[stream-warmup] egress confirmed running", {
          roomName,
          totalMs,
          totalSeconds: Math.round(totalMs / 1000),
          platforms: warmupPlatforms,
          perPlatformMs: perPlatform,
        });
        setWarmupLogged(true);
      }

      setWarmupReadyMap((prev) => {
        const next = { ...prev };
        warmupPlatforms.forEach((p) => {
          next[p] = true;
        });
        return next;
      });

      // Let the user see "Connected" for a brief moment before clearing
      const timeout = window.setTimeout(() => {
        setWarmupActive(false);
      }, 2000);

      return () => window.clearTimeout(timeout);
    }

    if (streamStatus === "idle") {
      // Stream did not start or was stopped; clear warmup state
      setWarmupActive(false);
    }
  }, [streamStatus, warmupActive, warmupStartedAt, warmupPlatforms, warmupLogged, roomName]);

  if (!open) return null;

  const isEntitlementsLoading = !entitlementsReady;

  const streamIsLive = streamStatus === "live";
  const streamIsBusy = streamStatus === "starting" || streamStatus === "stopping";
  const rtmpCap = typeof rtmpDestinationsMax === "number" ? rtmpDestinationsMax : 0;
  // Entitlement-level caps: numeric RTMP destinations are the single
  // source of truth for whether destinations are included in the plan.
  //
  // - rtmpDestinationsAllowed: can stream to at least one platform
  // - multistreamCapAllowed: can stream to multiple platforms (true multistream)
  const rtmpDestinationsAllowed = rtmpCap >= 1;
  const multistreamCapAllowed = rtmpCap >= 2;
  // Caller-level permission flag (roomPermissions) controls whether this
  // particular user may manage destinations at all.
  const hasStreamingPermission = multistreamAllowed !== false;
  // Final gate: either the plan disables RTMP entirely, or this user
  // lacks in-room permission to manage streaming.
  const streamDisallowed = !rtmpDestinationsAllowed || !hasStreamingPermission;
  // Temporary debug to verify canonical entitlements wiring in UI.
  if (typeof window !== "undefined") {
    console.debug("[StreamSetupModal] gating", {
      rtmpDestinationsMax: rtmpDestinationsMax ?? null,
      rtmpCap,
      rtmpDestinationsAllowed,
      multistreamCapAllowed,
      multistreamAllowed,
      hasStreamingPermission,
      streamDisallowed,
    });
  }
  
  const recordingIsActive = recordingStatus === "recording";
  const recordingIsBusy = recordingStatus === "stopping";
  // Recording controls are visible when the caller indicates recording is allowed
  // for this session (again based on roomPermissions).
  const showRecordingControls = recordingEnabled !== false;

  const hasRecordingCap = typeof recordingMaxMinutes === "number" && recordingMaxMinutes > 0;
  const hlsAllowed = hlsEnabled !== false;

  const badgeItems = [
    recordingEnabled
      ? { label: "Recording", value: "On", ok: true }
      : null,
    { label: "Dual", value: dualRecordingAllowed ? "On" : "Off", ok: dualRecordingAllowed },
    // RTMP badge reflects the numeric destination cap. 0 = off,
    // 1 = single destination, >1 = multistream up to N.
    {
      label: rtmpCap > 1 ? "Multistream" : "RTMP",
      value:
        rtmpCap <= 0
          ? "Off"
          : rtmpCap === 1
          ? "1 destination"
          : `up to ${rtmpCap}`,
      ok: rtmpCap > 0,
    },
    typeof maxGuests === "number"
      ? {
          label: "Guests",
          value: formatLimitLabel(maxGuests, "guest"),
          ok: maxGuests !== 0,
        }
      : null,
  ].filter(Boolean) as Array<{ label: string; value: string; ok: boolean }>;

  const selectedPlatforms = platformOrder.filter((p) => platformState[p].selected);
  const customHasManual = platformState.custom.manualFields.some((f) => f.value.trim());
  const instagramState = platformState.instagram;
  const instagramHasManual = instagramState.manualFields.some((f) => (f.value && f.value.trim()) || (f.base && f.base.trim()));
  const instagramSelected = instagramState.selected || instagramHasManual;
  const anyPlatformSelection = selectedPlatforms.length > 0 || customHasManual;
  const missingKeySelected = selectedPlatforms.some((p) => {
    const main = mainByPlatform[p];
    const mainUsable = !!(main && main.hasKey && main.mode !== "connected");
    const manual = platformState[p].manualFields.find((f) => f.value.trim());
    return !(mainUsable || manual);
  });
  const startDisabled =
    streamIsBusy ||
    streamDisallowed ||
    !anyPlatformSelection ||
    missingKeySelected ||
    warmupActive;

  const handleStartHls = async () => {
    if (!hlsRoomReady || !effectiveHlsRoomId) {
      // Defensive guard: HLS should never start without a canonical roomId.
      // This should already be prevented by disabled state, but we guard here
      // to avoid confusing failures if the UI logic ever regresses.
      console.warn("[HLS] start requested without ready roomId", { hlsRoomReady, effectiveHlsRoomId });
      return;
    }
    if (!boundEmbedId) {
      // HLS must be bound to a Saved Embed so /live/:savedEmbedId resolves.
      console.warn("[HLS] start requested without bound Saved Embed", { roomId: effectiveHlsRoomId });
      return;
    }
    if (hlsStatus === "starting" || hlsStatus === "live") return;
    setHlsBusy(true);
    setHlsError(null);
    setHlsStatus("starting");
    try {
      const data = await startHls(effectiveHlsRoomId, roomAccessToken || undefined);
      const status = (data?.status as string) || "live";
      setHlsStatus(status === "starting" || status === "live" || status === "error" ? status : "live");
      setHlsPlaylistUrl(data?.playlistUrl ?? null);
      setHlsEgressId(data?.egressId ?? null);
      setHlsError(null);
    } catch (err: any) {
      setHlsStatus("error");
      setHlsError(err?.message || "Failed to start HLS");
    } finally {
      setHlsBusy(false);
    }
  };

  const handleStopHls = async () => {
    if (!effectiveHlsRoomId) return;
    if (hlsStatus === "idle") return;
    setHlsBusy(true);
    try {
      await stopHls(effectiveHlsRoomId, roomAccessToken || undefined);
      setHlsStatus("idle");
      setHlsError(null);
      // playlistUrl may remain for debugging; UI only exposes when live
    } catch (err: any) {
      setHlsError(err?.message || "Failed to stop HLS");
    } finally {
      setHlsBusy(false);
    }
  };

  const handleStartStream = async () => {
    if (streamDisallowed) {
      alert("You don't have permission to start streaming in this room.");
      return;
    }
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

    try {
      const now = Date.now();
      const platformsNow = selectedPlatforms;
      setWarmupActive(true);
      setWarmupStartedAt(now);
      setWarmupPlatforms(platformsNow);
      setWarmupReadyMap({ youtube: false, facebook: false, twitch: false, instagram: false, custom: false });
      setWarmupLogged(false);

      await onStartStream({
        youtubeKey,
        facebookKey,
        twitchKey,
        enabledTargetIds: enabledTargetIds.length ? enabledTargetIds : undefined,
        sessionKeys: Object.keys(sessionKeyPayload).length ? sessionKeyPayload : undefined,
        destinations: effectiveDestinations,
        extraDestinations: instagramDestinations.length ? instagramDestinations : undefined,
        presetId: selectedPresetId,
      });
    } catch (err: any) {
      setStartError(err?.message || String(err));
      setWarmupActive(false);
    }
  };

  const handleStartRecording = async () => {
    await onStartRecording({ mode: recordingMode, presetId: selectedPresetId });
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: '80px',
      right: '20px',
      zIndex: 50,
      pointerEvents: 'auto'
    }}>
      {/* Floating Menu Card */}
      <div style={{
        background: 'rgba(20, 20, 20, 0.98)',
        borderRadius: '0.75rem',
        border: '1px solid rgba(220, 38, 38, 0.5)',
        backdropFilter: 'blur(20px)',
        boxShadow: '0 20px 60px rgba(220, 38, 38, 0.2)',
        width: '380px',
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        color: '#ffffff'
      }}>
        {/* Header */}
        <div style={{
          padding: '1rem',
          borderBottom: '2px solid rgba(220, 38, 38, 0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, rgba(220, 38, 38, 0.1), rgba(239, 68, 68, 0.05))'
        }}>
          <div>
            <div style={{ fontWeight: '700', fontSize: '0.95rem', color: '#ef4444', letterSpacing: '0.5px' }}>
              STREAM CONTROL
            </div>
            <div style={{ fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.5)', marginTop: '0.25rem' }}>
              Stream & Recording are independent
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={streamIsBusy || recordingIsBusy}
            style={{
              background: 'rgba(220, 38, 38, 0.2)',
              border: '1px solid rgba(220, 38, 38, 0.5)',
              borderRadius: '0.375rem',
              color: '#ef4444',
              padding: '0.4rem 0.6rem',
              cursor: (streamIsBusy || recordingIsBusy) ? 'not-allowed' : 'pointer',
              fontSize: '1.25rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '32px',
              height: '32px',
              transition: 'all 0.3s ease',
              fontWeight: 'bold',
              opacity: (streamIsBusy || recordingIsBusy) ? 0.5 : 1
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{
          padding: '1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem'
        }}>

          {/* Features Panel (constant, always visible) */}
          {badgeItems.length > 0 && (
            <div style={{
              borderRadius: '0.75rem',
              border: '1px solid rgba(148,163,184,0.35)',
              background: 'radial-gradient(circle at top left, rgba(248,113,113,0.3), rgba(15,23,42,0.95))',
              padding: '0.75rem 0.8rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.55rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#e5e7eb' }}>
                  Features Panel
                </div>
                {planId && (
                  <div style={{
                    fontSize: '0.7rem',
                    padding: '0.2rem 0.5rem',
                    borderRadius: '999px',
                    background: 'rgba(15,23,42,0.85)',
                    border: '1px solid rgba(148,163,184,0.6)',
                    color: '#cbd5f5'
                  }}>
                    Plan: {planId}
                  </div>
                )}
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                gap: '0.5rem'
              }}>
                {badgeItems.map((item) => (
                  <div
                    key={item.label}
                    style={{
                      border: `1px solid ${item.ok ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`,
                      background: item.ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.09)',
                      color: item.ok ? '#bbf7d0' : '#fecdd3',
                      borderRadius: '0.6rem',
                      padding: '0.4rem 0.55rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.15rem',
                      minHeight: '52px'
                    }}
                  >
                    <span style={{ fontSize: '0.7rem', opacity: 0.78 }}>{item.label}</span>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SECTION 1: STREAM PLATFORMS */}
          {rtmpDestinationsAllowed && (
          <CollapsibleSection
            id="destinations"
            title="Stream Destinations"
            defaultOpen={roomUiState.destinations}
            onToggle={(open) => updateRoomUiSection("destinations", open)}
          >
          <div style={{
            background: 'rgba(59, 130, 246, 0.05)',
            border: '1px solid rgba(59, 130, 246, 0.2)',
            borderRadius: '0.5rem',
            padding: '0.75rem'
          }}>
            <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#3b82f6', marginBottom: '0.75rem', textTransform: 'uppercase' }}>
              {!rtmpDestinationsAllowed
                ? "📡 Stream Destinations"
                : !multistreamCapAllowed
                ? "📡 RTMP (1 destination)"
                : `📡 Multistream (up to ${rtmpCap})`}
            </div>

            {!rtmpDestinationsAllowed && (
              <div style={{
                marginBottom: '0.75rem',
                padding: '0.55rem 0.75rem',
                borderRadius: '0.375rem',
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                fontSize: '0.75rem',
                color: '#fca5a5'
              }}>
                Stream Destinations are disabled for this plan. Upgrade in Settings  Usage to enable streaming to external destinations.
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {platformOrder.map((platform) => {
                const config = PLATFORM_CONFIG[platform];
                const main = mainByPlatform[platform];
                const state = platformState[platform];
                const mainHasKey = !!(main && main.hasKey);
                const disabled = streamIsLive || streamIsBusy || streamDisallowed;
                const connectedMode = false;
                const mainPreview = main?.hasKey && main?.keyPreview ? ` • ••••${main.keyPreview}` : main?.hasKey ? "" : "";
                const manualLabel =
                  platform === "custom"
                    ? "Custom stream key (RTMP)"
                    : platform === "instagram"
                    ? "Stream key from Instagram Live Producer"
                    : "Session stream key (this stream only)";
                const manualMissing = state.selected && !mainHasKey && !state.manualFields.find((f) => f.value.trim());
                const manualLimitReached = state.manualFields.length >= MAX_MANUAL_FIELDS;

                return (
                  <div
                    key={platform}
                    style={{
                      border: '1px solid rgba(255,255,255,0.08)',
                      background: 'rgba(255,255,255,0.02)',
                      borderRadius: '0.6rem',
                      padding: '0.6rem 0.7rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.4rem'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, color: config.accent }}>{config.label}</span>
                        {main && (
                          <span style={{
                            padding: '0.25rem 0.5rem',
                            borderRadius: '9999px',
                            border: '1px solid rgba(165,180,252,0.35)',
                            background: 'rgba(64, 156, 104, 0.46)',
                            fontSize: '0.75rem',
                            color: '#52e625ff'
                          }}>
                            {main.status}{mainPreview}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', color: 'rgba(255,255,255,0.8)' }}>
                          <input
                            type="checkbox"
                            checked={state.selected}
                            onChange={() => updatePlatformState(platform, { selected: !state.selected, error: null, info: null })}
                            disabled={disabled || connectedMode}
                            style={{ cursor: (disabled || connectedMode) ? 'not-allowed' : 'pointer', accentColor: config.accent, width: 16, height: 16 }}
                          />
                          Enabled
                        </label>
                        <button
                          onClick={() => {
                            const fieldId = `${platform}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                            const nextFields = [...state.manualFields, { id: fieldId, value: "", base: getDefaultRtmpBase(platform) }];
                            updatePlatformState(platform, { manualFields: nextFields, error: null });
                          }}
                          disabled={disabled || manualLimitReached}
                          style={{
                            padding: '0.35rem 0.65rem',
                            borderRadius: '0.4rem',
                            border: '1px solid rgba(59,130,246,0.4)',
                            background: manualLimitReached ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.08)',
                            color: '#bfdbfe',
                            fontWeight: 600,
                            cursor: (disabled || manualLimitReached) ? 'not-allowed' : 'pointer'
                          }}
                        >
                          Add key
                        </button>
                      </div>
                    </div>
                    {!main && (
                      <div style={{ fontSize: '0.75rem', color: 'rgba(226,232,240,0.7)' }}>
                        {platform === 'instagram'
                          ? 'Instagram Live is session-only. Enter RTMP URL + Stream Key from Instagram Live Producer each time you go live. (Auto: 9:16 Reels preset)'
                          : 'No saved destination yet. Add one in Settings → Stream Destinations to reuse across sessions.'}
                      </div>
                    )}

                    {state.manualFields.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        {state.manualFields.map((field) => (
                          <div key={field.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <input
                                type="text"
                                value={field.value}
                                onChange={(e) => {
                                  const nextFields = state.manualFields.map((f) => (f.id === field.id ? { ...f, value: e.target.value } : f));
                                  updatePlatformState(platform, { manualFields: nextFields, error: null });
                                }}
                                placeholder={manualLabel}
                                disabled={streamIsLive || streamDisallowed}
                                style={{
                                  flex: 1,
                                  padding: '0.45rem 0.55rem',
                                  background: 'rgba(31, 41, 55, 0.7)',
                                  border: '1px solid rgba(75, 85, 99, 0.5)',
                                  borderRadius: '0.35rem',
                                  color: '#ffffff',
                                  fontSize: '0.8rem',
                                  outline: 'none',
                                  opacity: (streamIsLive || streamDisallowed) ? 0.5 : 1
                                }}
                              />
                              <button
                                onClick={() => {
                                  const nextFields = state.manualFields.filter((f) => f.id !== field.id);
                                  updatePlatformState(platform, { manualFields: nextFields, error: null });
                                }}
                                disabled={streamIsLive || streamDisallowed}
                                style={{
                                  padding: '0.25rem 0.35rem',
                                  borderRadius: '0.35rem',
                                  border: '1px solid rgba(239,68,68,0.6)',
                                  background: 'rgba(239, 68, 68, 0.1)',
                                  color: '#fca5a5',
                                  cursor: (streamIsLive || streamDisallowed) ? 'not-allowed' : 'pointer',
                                  fontSize: '0.75rem'
                                }}
                              >
                                ✕
                              </button>
                            </div>
                            {(platform === 'custom' || platform === 'instagram') && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <input
                                  type="text"
                                  value={field.base || ''}
                                  onChange={(e) => {
                                    const nextFields = state.manualFields.map((f) => (f.id === field.id ? { ...f, base: e.target.value } : f));
                                    updatePlatformState(platform, { manualFields: nextFields, error: null });
                                  }}
                                  placeholder={platform === 'instagram' ? 'RTMP URL from Instagram Live Producer' : 'Optional RTMP ingest URL (base)'}
                                  disabled={streamIsLive || streamDisallowed}
                                  style={{
                                    flex: 1,
                                    padding: '0.4rem 0.5rem',
                                    background: 'rgba(31, 41, 55, 0.55)',
                                    border: '1px solid rgba(75, 85, 99, 0.4)',
                                    borderRadius: '0.3rem',
                                    color: '#ffffff',
                                    fontSize: '0.78rem',
                                    outline: 'none',
                                    opacity: (streamIsLive || streamDisallowed) ? 0.5 : 1
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        ))}
                        {!main && (
                          <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)' }}>
                            Session-only. Not saved or promoted to main.
                          </div>
                        )}
                        {manualLimitReached && (
                          <div style={{ fontSize: '0.72rem', color: '#fca5a5' }}>
                            Limit reached: remove a session key to add another (max 3).
                          </div>
                        )}
                      </div>
                    )}

                    {manualMissing && (
                      <div style={{ fontSize: '0.75rem', color: '#fca5a5' }}>
                        No stream key set.
                      </div>
                    )}
                    {state.error && (
                      <div style={{
                        fontSize: '0.75rem',
                        color: '#fca5a5',
                        background: 'rgba(239, 68, 68, 0.08)',
                        border: '1px solid rgba(239, 68, 68, 0.35)',
                        borderRadius: '0.35rem',
                        padding: '0.35rem 0.45rem'
                      }}>
                        {state.error}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {instagramSelected && (
              <div style={{
                marginTop: '0.6rem',
                padding: '0.5rem 0.6rem',
                borderRadius: '0.45rem',
                border: '1px solid rgba(234,179,8,0.6)',
                background: 'rgba(250,204,21,0.08)',
                fontSize: '0.75rem',
                color: '#facc15'
              }}>
                Instagram performs best in portrait 9:16 (720×1280).
              </div>
            )}

            <div style={{ marginTop: '0.75rem' }}>
              {(streamStatus === "idle" || streamStatus === "starting") ? (
                <>
                  <button
                    onClick={handleStartStream}
                    disabled={startDisabled}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      fontSize: '0.875rem',
                      borderRadius: '0.5rem',
                      background: startDisabled ? 'rgba(59, 130, 246, 0.35)' : 'linear-gradient(135deg, #22c55e, #16a34a)',
                      color: '#ffffff',
                      border: 'none',
                      fontWeight: '600',
                      cursor: startDisabled ? 'not-allowed' : 'pointer',
                      transition: 'all 0.3s ease',
                    }}
                  >
                    {streamStatus === "starting" || warmupActive ? "🔄 Connecting…" : "📡 Go Live"}
                  </button>
                  {startError && (
                    <div style={{
                      marginTop: '0.55rem',
                      fontSize: '0.75rem',
                      color: '#fca5a5',
                      background: 'rgba(239, 68, 68, 0.08)',
                      border: '1px solid rgba(239, 68, 68, 0.35)',
                      borderRadius: '0.4rem',
                      padding: '0.4rem 0.5rem'
                    }}>
                      {startError}
                    </div>
                  )}
                  {warmupActive && warmupPlatforms.length > 0 && (
                    <div style={{
                      marginTop: '0.6rem',
                      padding: '0.6rem 0.7rem',
                      borderRadius: '0.5rem',
                      background: 'rgba(15,23,42,0.85)',
                      border: '1px solid rgba(148,163,184,0.4)',
                      fontSize: '0.75rem',
                      color: '#e5e7eb',
                    }}>
                      <div style={{ marginBottom: '0.4rem', fontWeight: 600 }}>
                        {(() => {
                          const facebookSelected = warmupPlatforms.includes("facebook");
                          const primaryKey: PlatformKey = (facebookSelected
                            ? "facebook"
                            : warmupPlatforms[0]) as PlatformKey;
                          const primaryConfig = PLATFORM_CONFIG[primaryKey];
                          const primaryLabel = primaryConfig?.label || "your stream destinations";
                          return `Connecting to ${primaryLabel}… this usually takes 5–10 seconds.`;
                        })()}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                        {warmupPlatforms.map((p) => {
                          const config = PLATFORM_CONFIG[p as PlatformKey] || { label: p, accent: '#e5e7eb' };
                          const ready = warmupReadyMap[p];
                          return (
                            <div
                              key={p}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                              }}
                            >
                              <span style={{ color: config.accent, fontWeight: 600 }}>{config.label}</span>
                              <span style={{ fontFamily: 'monospace' }}>
                                {ready ? '✓ Connected' : '… Connecting'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <button
                  onClick={onStopStream}
                  disabled={streamIsBusy}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    fontSize: '0.875rem',
                    borderRadius: '0.5rem',
                    background: streamIsBusy ? 'rgba(239, 68, 68, 0.5)' : 'linear-gradient(135deg, #dc2626, #b91c1c)',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: '600',
                    cursor: streamIsBusy ? 'not-allowed' : 'pointer',
                    transition: 'all 0.3s ease',
                  }}
                >
                  {streamStatus === "stopping" ? "🔄 Stopping Stream..." : "⏹️ Stop Stream"}
                </button>
              )}
            </div>
          </div>
          </CollapsibleSection>
          )}

          {/* SECTION 2: RECORDING CONTROL */}
          {showRecordingControls && (
            <CollapsibleSection
              id="recording"
              title="Recording settings"
              defaultOpen={roomUiState.recording}
              onToggle={(open) => updateRoomUiSection("recording", open)}
            >
            <div style={{
              background: 'rgba(220, 38, 38, 0.05)',
              border: '1px solid rgba(220, 38, 38, 0.2)',
              borderRadius: '0.5rem',
              padding: '0.75rem'
            }}>
              <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#ef4444', marginBottom: '0.75rem', textTransform: 'uppercase' }}>
                🎬 Recording Control
              </div>

              {/* Mode Selector */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '0.75rem' }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Mode:</span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => setRecordingMode('cloud')}
                    disabled={recordingIsActive}
                    style={{
                      padding: '0.4rem 0.75rem',
                      borderRadius: '0.35rem',
                      border: recordingMode === 'cloud' ? '1px solid #ef4444' : '1px solid rgba(255,255,255,0.15)',
                      background: recordingMode === 'cloud' ? 'rgba(239, 68, 68, 0.12)' : '#18181b',
                      color: '#ffffff',
                      fontWeight: 600,
                      fontSize: '0.8rem',
                      cursor: recordingIsActive ? 'not-allowed' : 'pointer',
                      opacity: recordingIsActive ? 0.5 : 1,
                    }}
                  >
                    Cloud
                  </button>
                  <button
                    onClick={() => dualRecordingAllowed && setRecordingMode('dual')}
                    disabled={recordingIsActive || !dualRecordingAllowed}
                    title={dualRecordingAllowed ? 'Record cloud + local copy' : 'Dual recording not included in this plan'}
                    style={{
                      padding: '0.4rem 0.75rem',
                      borderRadius: '0.35rem',
                      border: recordingMode === 'dual' ? '1px solid #ef4444' : '1px solid rgba(255,255,255,0.15)',
                      background: recordingMode === 'dual' ? 'rgba(239, 68, 68, 0.12)' : '#18181b',
                      color: '#ffffff',
                      fontWeight: 600,
                      fontSize: '0.8rem',
                      cursor: (recordingIsActive || !dualRecordingAllowed) ? 'not-allowed' : 'pointer',
                      opacity: !dualRecordingAllowed ? 0.4 : (recordingIsActive ? 0.6 : 1),
                    }}
                  >
                    Dual
                  </button>
                </div>
                {!dualRecordingAllowed && (
                  <div style={{ fontSize: '0.75rem', color: '#fca5a5' }}>
                    Dual recording is disabled for this plan.
                  </div>
                )}
              </div>

              {/* Status */}
              {recordingStatus === "error" && (
                <div style={{ 
                  fontSize: '0.75rem', 
                  color: '#ef4444', 
                  marginBottom: '0.75rem',
                  padding: '0.5rem',
                  background: 'rgba(220, 38, 38, 0.1)',
                  borderRadius: '0.25rem'
                }}>
                  ❌ Recording failed to start. Check server logs.
                </div>
              )}

              {/* Recording Control Button */}
              {!recordingIsActive ? (
                <button
                  onClick={handleStartRecording}
                  disabled={recordingIsBusy || (recordingMode === "dual" && !dualRecordingAllowed)}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    fontSize: '0.875rem',
                    borderRadius: '0.5rem',
                    background: recordingIsBusy ? 'rgba(220, 38, 38, 0.3)' : 'linear-gradient(135deg, #dc2626, #b91c1c)',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: '600',
                    cursor: (recordingIsBusy || (recordingMode === "dual" && !dualRecordingAllowed)) ? 'not-allowed' : 'pointer',
                    transition: 'all 0.3s ease',
                    opacity: (recordingIsBusy || (recordingMode === "dual" && !dualRecordingAllowed)) ? 0.6 : 1
                  }}
                >
                  🎬 Start Recording
                </button>
              ) : (
                <button
                  onClick={onStopRecording}
                  disabled={recordingIsBusy}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    fontSize: '0.875rem',
                    borderRadius: '0.5rem',
                    background: recordingIsBusy ? 'rgba(220, 38, 38, 0.5)' : 'linear-gradient(135deg, #7c2d12, #991b1b)',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: '600',
                    cursor: recordingIsBusy ? 'not-allowed' : 'pointer',
                    transition: 'all 0.3s ease',
                  }}
                >
                  {recordingIsBusy ? "🔄 Stopping Recording..." : "⏹️ Stop Recording"}
                </button>
              )}

              {recordingIsActive && (
                <div style={{
                  marginTop: '0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.75rem',
                  color: '#ef4444'
                }}>
                  <div style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: '#ef4444',
                    animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
                  }} />
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    Recording in progress…
                    <span style={{
                      padding: '2px 6px',
                      borderRadius: '0.35rem',
                      background: 'rgba(239, 68, 68, 0.15)',
                      border: '1px solid rgba(239, 68, 68, 0.35)',
                      fontFamily: 'monospace',
                      color: '#fecaca'
                    }}>
                      {hasRecordingCap
                        ? `${Math.floor(recordingElapsedSeconds / 60)}:${String(recordingElapsedSeconds % 60).padStart(2, '0')} / ${String(recordingMaxMinutes).padStart(2, '0')}:00`
                        : `${Math.floor(recordingElapsedSeconds / 60)}:${String(recordingElapsedSeconds % 60).padStart(2, '0')}`}
                    </span>
                    {hasRecordingCap && (
                      <span style={{
                        marginLeft: '0.4rem',
                        padding: '2px 6px',
                        borderRadius: '0.35rem',
                        background: 'rgba(15, 23, 42, 0.8)',
                        border: '1px solid rgba(148, 163, 184, 0.5)',
                        fontSize: '0.7rem',
                        color: 'rgba(226, 232, 240, 0.9)'
                      }}>
                        Clip cap: {recordingMaxMinutes} min
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>
          </CollapsibleSection>
          )}

            {/* HLS Broadcast section (runtime start/stop).
              Gated by platform-level flag via showHlsSection and plan via hlsAllowed. */}
            {showHlsSection && hlsAllowed && (
            <CollapsibleSection
              id="hls"
              title="HLS Broadcast"
              defaultOpen={roomUiState.hls}
              onToggle={(open) => updateRoomUiSection("hls", open)}
              rightBadge={(
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    padding: '0.1rem 0.45rem',
                    borderRadius: '999px',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    background:
                      hlsStatus === 'live'
                        ? 'rgba(220,38,38,0.16)'
                        : hlsStatus === 'starting'
                        ? 'rgba(234,179,8,0.16)'
                        : hlsStatus === 'error'
                        ? 'rgba(248,113,113,0.16)'
                        : 'rgba(31,41,55,0.9)',
                    border:
                      hlsStatus === 'live'
                        ? '1px solid rgba(220,38,38,0.7)'
                        : hlsStatus === 'starting'
                        ? '1px solid rgba(234,179,8,0.7)'
                        : hlsStatus === 'error'
                        ? '1px solid rgba(248,113,113,0.7)'
                        : '1px solid rgba(148,163,184,0.6)',
                    color:
                      hlsStatus === 'live'
                        ? '#fecaca'
                        : hlsStatus === 'starting'
                        ? '#facc15'
                        : hlsStatus === 'error'
                        ? '#fecaca'
                        : '#e5e7eb',
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '999px',
                      backgroundColor:
                        hlsStatus === 'live'
                          ? '#ef4444'
                          : hlsStatus === 'starting'
                          ? '#eab308'
                          : hlsStatus === 'error'
                          ? '#f97373'
                          : '#6b7280',
                    }}
                  />
                  <span>{hlsStatus === 'idle' ? 'Idle' : hlsStatus === 'starting' ? 'Starting' : hlsStatus === 'live' ? 'Live' : 'Error'}</span>
                </span>
              )}
            >
              <div style={{ fontSize: '0.75rem', color: 'rgba(209, 213, 219, 0.9)', marginBottom: '0.65rem' }}>
                {!hlsRoomReady
                  ? 'Loading room… HLS controls will unlock once the Firestore roomId is known.'
                  : !boundEmbedId
                    ? 'This room is not connected to a Saved Embed yet. Create one in Settings → HLS Setup and join using that Saved Room to go live.'
                    : 'Connected to your Saved Embed. Start HLS to begin broadcasting to its viewer link.'}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'rgba(148, 163, 184, 0.95)', marginBottom: '0.75rem' }}>
                Broadcasting uses Broadcast minutes.
              </div>
              {boundEmbedId && (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.35rem',
                  marginBottom: '0.75rem',
                }}>
                  <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Connected Saved Embed</div>
                  <div style={{
                    padding: '0.5rem 0.6rem',
                    borderRadius: '0.45rem',
                    border: '1px solid rgba(75,85,99,0.7)',
                    background: 'rgba(15,23,42,0.9)',
                    color: '#e5e7eb',
                    fontSize: '0.85rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.5rem',
                  }}>
                    <span>{boundEmbedName || boundEmbedId}</span>
                    {boundEmbedLoading && (
                      <span style={{ fontSize: '0.7rem', color: '#9ca3af' }}>Loading…</span>
                    )}
                  </div>
                  {boundEmbedError && (
                    <div style={{ fontSize: '0.75rem', color: '#fecaca' }}>❌ {boundEmbedError}</div>
                  )}
                </div>
              )}

              {!hlsAllowed && (
                <div
                  style={{
                    marginBottom: '0.75rem',
                    padding: '0.65rem 0.75rem',
                    borderRadius: '0.5rem',
                    background: 'rgba(30,64,175,0.25)',
                    border: '1px solid rgba(59,130,246,0.6)',
                    fontSize: '0.75rem',
                    color: '#dbeafe',
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>HLS Broadcast Page not included in this plan.</div>
                  <div style={{ marginBottom: '0.45rem' }}>
                    Upgrade your plan to unlock a shareable /live viewer link for your audience.
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (onUpgradeHls) {
                        onUpgradeHls();
                      } else {
                        window.location.href = "/settings/billing";
                      }
                    }}
                    style={{
                      padding: '0.45rem 0.8rem',
                      borderRadius: '999px',
                      border: 'none',
                      background: 'linear-gradient(135deg,#3b82f6,#2563eb)',
                      color: '#f9fafb',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Upgrade to enable HLS
                  </button>
                </div>
              )}

              {hlsError && hlsStatus === 'error' && (
                <div
                  style={{
                    marginTop: '0.5rem',
                    fontSize: '0.75rem',
                    color: '#fecaca',
                    background: 'rgba(248,113,113,0.1)',
                    border: '1px solid rgba(248,113,113,0.6)',
                    borderRadius: '0.4rem',
                    padding: '0.4rem 0.5rem',
                  }}
                >
                  ❌ {hlsError}
                </div>
              )}

              <div style={{ marginTop: '0.65rem', display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={handleStartHls}
                  disabled={!hlsAllowed || !canStartStopHls || !hlsRoomReady || !boundEmbedId || hlsBusy || !(hlsStatus === 'idle' || hlsStatus === 'error')}
                  style={{
                    flex: 1,
                    padding: '0.6rem 0.7rem',
                    borderRadius: '0.45rem',
                    border: 'none',
                    background:
                      !hlsAllowed || !canStartStopHls || !hlsRoomReady || !boundEmbedId || hlsBusy || !(hlsStatus === 'idle' || hlsStatus === 'error')
                        ? 'rgba(37,99,235,0.4)'
                        : 'linear-gradient(135deg, #22c55e, #16a34a)',
                    color: '#ffffff',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor:
                      !hlsAllowed || !canStartStopHls || !hlsRoomReady || !boundEmbedId || hlsBusy || !(hlsStatus === 'idle' || hlsStatus === 'error') ? 'not-allowed' : 'pointer',
                    opacity:
                      !hlsAllowed || !canStartStopHls || !hlsRoomReady || !boundEmbedId || hlsBusy || !(hlsStatus === 'idle' || hlsStatus === 'error') ? 0.6 : 1,
                  }}
                >
                  {hlsBusy && (hlsStatus === 'starting' || hlsStatus === 'idle')
                    ? 'Starting HLS…'
                    : 'Start HLS'}
                </button>
                <button
                  type="button"
                  onClick={handleStopHls}
                  disabled={!canStartStopHls || !boundEmbedId || hlsBusy || !(hlsStatus === 'live' || hlsStatus === 'starting')}
                  style={{
                    flex: 1,
                    padding: '0.6rem 0.7rem',
                    borderRadius: '0.45rem',
                    border: 'none',
                    background:
                      !canStartStopHls || !boundEmbedId || hlsBusy || !(hlsStatus === 'live' || hlsStatus === 'starting')
                        ? 'rgba(248,113,113,0.35)'
                        : 'linear-gradient(135deg, #dc2626, #b91c1c)',
                    color: '#ffffff',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor:
                      !canStartStopHls || !boundEmbedId || hlsBusy || !(hlsStatus === 'live' || hlsStatus === 'starting') ? 'not-allowed' : 'pointer',
                    opacity:
                      !canStartStopHls || !boundEmbedId || hlsBusy || !(hlsStatus === 'live' || hlsStatus === 'starting') ? 0.6 : 1,
                  }}
                >
                  {hlsBusy && (hlsStatus === 'live' || hlsStatus === 'starting')
                    ? 'Stopping HLS…'
                    : 'Stop HLS'}
                </button>
              </div>

              {boundEmbedId && (
                <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Viewer link</span>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      <input
                        type="text"
                        readOnly
                        value={hlsViewerUrl}
                        style={{
                          flex: 1,
                          padding: '0.4rem 0.55rem',
                          borderRadius: '0.35rem',
                          border: '1px solid rgba(75,85,99,0.7)',
                          background: 'rgba(15,23,42,0.9)',
                          color: '#e5e7eb',
                          fontSize: '0.8rem',
                        }}
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(hlsViewerUrl);
                            alert('Viewer link copied');
                          } catch {
                            // ignore
                          }
                        }}
                        style={{
                          padding: '0.35rem 0.6rem',
                          borderRadius: '0.35rem',
                          border: '1px solid rgba(148,163,184,0.7)',
                          background: 'rgba(15,23,42,0.95)',
                          color: '#e5e7eb',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                        }}
                      >
                        Copy
                      </button>
                    </div>
                  </div>

                  <div style={{
                    borderTop: '1px solid rgba(148,163,184,0.25)',
                    paddingTop: '0.65rem',
                  }}>
                    <button
                      type="button"
                      onClick={() => setHlsAdvancedOpen((v) => !v)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        background: 'transparent',
                        border: 'none',
                        color: 'rgba(226,232,240,0.85)',
                        fontSize: '0.78rem',
                        cursor: 'pointer',
                        padding: '0.25rem 0',
                        fontWeight: 600,
                      }}
                    >
                      {hlsAdvancedOpen ? '▾' : '▸'} Advanced (debug)
                    </button>
                    {hlsAdvancedOpen && (
                      <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Debug playlist URL</span>
                        <input
                          type="text"
                          readOnly
                          value={hlsPlaylistUrl || ''}
                          placeholder={hlsPlaylistUrl ? '' : 'Playlist URL will appear after Start HLS'}
                          style={{
                            width: '100%',
                            padding: '0.4rem 0.55rem',
                            borderRadius: '0.35rem',
                            border: '1px solid rgba(75,85,99,0.7)',
                            background: 'rgba(15,23,42,0.9)',
                            color: '#e5e7eb',
                            fontSize: '0.8rem',
                            fontFamily: 'monospace',
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CollapsibleSection>
          )}

          {/* HLS Setup section (branding/config). Does NOT start HLS. */}
          {/* HLS Setup (embed creation + branding) lives in Settings → HLS Setup. */}

          {/* Help Text */}
          <div style={{ 
            fontSize: '0.7rem', 
            color: 'rgba(255, 255, 255, 0.4)', 
            lineHeight: 1.4,
            fontStyle: 'italic'
          }}>
            💡 Tip: You can stream without recording, or record without streaming to platforms. They're independent!
            {typeof maxGuests === "number" && maxGuests > 0 && (
              <div style={{ marginTop: '0.3rem', color: 'rgba(255, 255, 255, 0.55)', fontStyle: 'normal' }}>
                Plan guest limit: {maxGuests}.
              </div>
            )}
            {hasRecordingCap && (
              <div style={{ marginTop: '0.3rem', color: 'rgba(148, 163, 184, 0.9)', fontStyle: 'normal' }}>
                Per-clip cap: {recordingMaxMinutes}-minute maximum per recording.
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `}</style>
    </div>
  );
}