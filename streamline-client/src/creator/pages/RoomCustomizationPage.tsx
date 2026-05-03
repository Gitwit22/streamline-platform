import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  apiGetRoomCustomization,
  apiUpdateRoomCustomization,
  apiGetGreenroomPolicy,
  apiUpdateGreenroomPolicy,
  type RoomCustomizationConfig,
  type GreenroomPolicy,
} from "../../lib/api";
import { useAuthMe } from "../../hooks/useAuthMe";

// ============================================================================
// TYPES
// ============================================================================

type Template = {
  id: string;
  name: string;
  description: string;
  thumbnail: string;
  isDefault?: boolean;
  isPremium?: boolean;
  config: RoomConfig;
};

type RoomConfig = {
  // Branding (server-backed)
  banner: BannerConfig | null;
  logo: LogoConfig | null;
  watermark: WatermarkConfig | null;

  // Visual (server-backed for background)
  background: BackgroundConfig;
  overlay: OverlayConfig | null;

  // Audio (localStorage only)
  themeMusic: ThemeMusicConfig | null;
  soundEffects: SoundEffectConfig[];

  // Text Elements (localStorage only)
  lowerThird: LowerThirdConfig | null;
  ticker: TickerConfig | null;

  // Interactions (localStorage only)
  alerts: AlertConfig;
  chatStyle: ChatStyleConfig;

  // Stream Info (localStorage only)
  streamInfo: StreamInfoConfig;

  // Greenroom (split: policy server-backed, appearance server-backed, rest localStorage)
  greenroom: GreenroomConfig;
};

type BannerConfig = {
  url: string;
  position: "top" | "bottom";
  height: number;
  opacity: number;
};

type LogoConfig = {
  url: string;
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  size: number;
  opacity: number;
};

type WatermarkConfig = {
  url: string;
  position: "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
  size: number;
  opacity: number;
};

type BackgroundConfig = {
  type: "solid" | "gradient" | "image" | "video" | "animated";
  value: string;
  blur?: number;
  overlay?: string;
};

type OverlayConfig = {
  url: string;
  opacity: number;
  blendMode: string;
};

type ThemeMusicConfig = {
  url: string;
  name: string;
  volume: number;
  loop: boolean;
  playOn: "waiting" | "intro" | "outro" | "always";
};

type SoundEffectConfig = {
  id: string;
  name: string;
  url: string;
  trigger: "follow" | "subscribe" | "donation" | "raid" | "custom";
  volume: number;
};

type LowerThirdConfig = {
  enabled: boolean;
  template: "modern" | "minimal" | "classic" | "neon";
  primaryColor: string;
  secondaryColor: string;
  textColor: string;
  animation: "slide" | "fade" | "bounce";
};

type TickerConfig = {
  enabled: boolean;
  messages: string[];
  speed: number;
  backgroundColor: string;
  textColor: string;
};

type AlertConfig = {
  enabled: boolean;
  style: "popup" | "banner" | "corner";
  duration: number;
  sound: boolean;
  animation: "bounce" | "slide" | "fade" | "zoom";
};

type ChatStyleConfig = {
  theme: "default" | "minimal" | "bubble" | "neon" | "retro";
  fontSize: number;
  showBadges: boolean;
  showTimestamps: boolean;
  backgroundColor: string;
  textColor: string;
};

type StreamInfoConfig = {
  title: string;
  category: string;
  tags: string[];
  description: string;
};

type GreenroomConfig = {
  // Server-backed (greenroom-policy)
  enabled: boolean;
  autoAdmit: boolean;
  requireApproval: boolean;
  vipList: string[];
  blockedUsers: string[];
  // Server-backed (customization.greenroom)
  waitingRoomMessage: string;
  waitingRoomBackground: string;
  waitingRoomMusic: string | null;
  // localStorage only
  maxWaitingGuests: number;
  allowGuestVideo: boolean;
  allowGuestAudio: boolean;
  allowGuestScreenShare: boolean;
  guestNamePrefix: string;
  notifyOnJoin: boolean;
  notifySound: string;
  autoMuteOnEntry: boolean;
  showGuestCount: boolean;
  customInstructions: string;
};

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const defaultConfig: RoomConfig = {
  banner: null,
  logo: null,
  watermark: null,
  background: { type: "solid", value: "#000000" },
  overlay: null,
  themeMusic: null,
  soundEffects: [],
  lowerThird: {
    enabled: false,
    template: "modern",
    primaryColor: "#dc2626",
    secondaryColor: "#000000",
    textColor: "#ffffff",
    animation: "slide",
  },
  ticker: null,
  alerts: {
    enabled: true,
    style: "popup",
    duration: 5,
    sound: true,
    animation: "bounce",
  },
  chatStyle: {
    theme: "default",
    fontSize: 14,
    showBadges: true,
    showTimestamps: false,
    backgroundColor: "rgba(0,0,0,0.7)",
    textColor: "#ffffff",
  },
  streamInfo: { title: "", category: "", tags: [], description: "" },
  greenroom: {
    enabled: true,
    autoAdmit: false,
    maxWaitingGuests: 10,
    waitingRoomMessage: "Please wait while the host reviews your request to join.",
    waitingRoomBackground: "linear-gradient(135deg, #0f0f23 0%, #1a0a2e 100%)",
    requireApproval: true,
    allowGuestVideo: true,
    allowGuestAudio: true,
    allowGuestScreenShare: false,
    guestNamePrefix: "Guest",
    notifyOnJoin: true,
    notifySound: "chime",
    autoMuteOnEntry: true,
    showGuestCount: true,
    waitingRoomMusic: null,
    customInstructions: "",
    blockedUsers: [],
    vipList: [],
  },
};

const presetTemplates: Template[] = [
  {
    id: "minimal-dark",
    name: "Minimal Dark",
    description: "Clean, distraction-free dark theme",
    thumbnail: "🌑",
    isDefault: true,
    config: {
      ...defaultConfig,
      background: { type: "solid", value: "#0a0a0a" },
      chatStyle: { ...defaultConfig.chatStyle, theme: "minimal" },
    },
  },
  {
    id: "neon-nights",
    name: "Neon Nights",
    description: "Cyberpunk vibes with glowing accents",
    thumbnail: "🌃",
    isPremium: true,
    config: {
      ...defaultConfig,
      background: {
        type: "gradient",
        value: "linear-gradient(135deg, #0f0f23 0%, #1a0a2e 50%, #16213e 100%)",
      },
      lowerThird: {
        ...defaultConfig.lowerThird!,
        enabled: true,
        template: "neon",
        primaryColor: "#00f5ff",
        secondaryColor: "#ff00ff",
      },
      chatStyle: {
        ...defaultConfig.chatStyle,
        theme: "neon",
        backgroundColor: "rgba(0,245,255,0.1)",
      },
    },
  },
  {
    id: "retro-gaming",
    name: "Retro Gaming",
    description: "8-bit nostalgia with pixel aesthetics",
    thumbnail: "🕹️",
    config: {
      ...defaultConfig,
      background: {
        type: "gradient",
        value: "linear-gradient(180deg, #2d1b69 0%, #11001c 100%)",
      },
      chatStyle: { ...defaultConfig.chatStyle, theme: "retro" },
      alerts: { ...defaultConfig.alerts, animation: "bounce" },
    },
  },
  {
    id: "podcast-pro",
    name: "Podcast Pro",
    description: "Professional look for interviews & talks",
    thumbnail: "🎙️",
    config: {
      ...defaultConfig,
      background: {
        type: "gradient",
        value: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
      },
      lowerThird: {
        ...defaultConfig.lowerThird!,
        enabled: true,
        template: "classic",
      },
      chatStyle: { ...defaultConfig.chatStyle, theme: "bubble" },
    },
  },
  {
    id: "esports-arena",
    name: "Esports Arena",
    description: "Competitive gaming with dynamic overlays",
    thumbnail: "🏆",
    isPremium: true,
    config: {
      ...defaultConfig,
      background: { type: "animated", value: "particles" },
      alerts: { ...defaultConfig.alerts, style: "banner", animation: "slide" },
      ticker: {
        enabled: true,
        messages: ["Welcome to the stream!", "Follow for more content!"],
        speed: 50,
        backgroundColor: "#dc2626",
        textColor: "#ffffff",
      },
    },
  },
  {
    id: "cozy-cafe",
    name: "Cozy Café",
    description: "Warm, relaxing atmosphere for chill streams",
    thumbnail: "☕",
    config: {
      ...defaultConfig,
      background: {
        type: "gradient",
        value: "linear-gradient(135deg, #3c2415 0%, #1a0f0a 100%)",
      },
      chatStyle: {
        ...defaultConfig.chatStyle,
        theme: "bubble",
        backgroundColor: "rgba(60,36,21,0.8)",
      },
    },
  },
];

// ============================================================================
// SERVER FIELD MAPPING
// ============================================================================

function toServerCustomization(config: RoomConfig): Partial<RoomCustomizationConfig> {
  const logoAlignment: "left" | "center" | "right" = config.logo?.position?.includes("right")
    ? "right"
    : "left";

  const patch: Partial<RoomCustomizationConfig> = {
    enabled: true,
    logoUrl: config.logo?.url || null,
    logoAlignment,
    bannerUrl: config.banner?.url || null,
    bannerAlignment: config.banner?.position === "top"
      ? "top"
      : config.banner?.position === "bottom"
      ? "bottom"
      : "center",
  };

  if (config.banner) {
    patch.banner = {
      enabled: true,
      url: config.banner.url,
      position: config.banner.position,
      height: config.banner.height,
      opacity: config.banner.opacity,
    };
  } else {
    patch.banner = undefined;
  }

  if (config.background.type !== "animated") {
    patch.roomBackground = {
      enabled: true,
      type: config.background.type === "image"
        ? "image"
        : config.background.type === "gradient"
        ? "gradient"
        : "solid",
      url: config.background.type === "image" ? config.background.value : undefined,
      value: config.background.type !== "image" ? config.background.value : undefined,
    };
  }

  patch.greenroom = {
    waitingRoomMessage: config.greenroom.waitingRoomMessage,
    waitingRoomBackground: config.greenroom.waitingRoomBackground,
    waitingRoomMusic: config.greenroom.waitingRoomMusic || undefined,
  };

  return patch;
}

function mergeServerCustomization(
  server: RoomCustomizationConfig,
  base: RoomConfig
): RoomConfig {
  return {
    ...base,
    logo: server.logoUrl
      ? {
          url: server.logoUrl,
          position: server.logoAlignment === "right" ? "top-right" : "top-left",
          size: base.logo?.size ?? 80,
          opacity: base.logo?.opacity ?? 0.9,
        }
      : base.logo,
    banner: server.banner?.enabled
      ? {
          url: server.banner.url,
          position: server.banner.position,
          height: server.banner.height,
          opacity: server.banner.opacity,
        }
      : server.bannerUrl
      ? { url: server.bannerUrl, position: "top", height: 60, opacity: 1 }
      : base.banner,
    background: server.roomBackground?.enabled
      ? {
          type: server.roomBackground.type,
          value:
            server.roomBackground.url ??
            server.roomBackground.value ??
            "#000000",
        }
      : base.background,
    greenroom: {
      ...base.greenroom,
      waitingRoomMessage:
        server.greenroom?.waitingRoomMessage ?? base.greenroom.waitingRoomMessage,
      waitingRoomBackground:
        server.greenroom?.waitingRoomBackground ?? base.greenroom.waitingRoomBackground,
      waitingRoomMusic:
        server.greenroom?.waitingRoomMusic ?? base.greenroom.waitingRoomMusic,
    },
  };
}

function mergeGreenroomPolicy(policy: GreenroomPolicy, base: RoomConfig): RoomConfig {
  return {
    ...base,
    greenroom: {
      ...base.greenroom,
      enabled: policy.mode !== "off",
      requireApproval: policy.requireApproval,
      autoAdmit: policy.autoAdmit,
      vipList: policy.vipList,
      blockedUsers: policy.blockedList,
    },
  };
}

const LOCAL_FIELDS_KEY = (roomId: string) => `sl_room_customize_${roomId}`;

function saveLocalFields(roomId: string, config: RoomConfig) {
  const local = {
    themeMusic: config.themeMusic,
    soundEffects: config.soundEffects,
    overlay: config.overlay,
    watermark: config.watermark,
    lowerThird: config.lowerThird,
    ticker: config.ticker,
    chatStyle: config.chatStyle,
    alerts: config.alerts,
    streamInfo: config.streamInfo,
    greenroomLocal: {
      maxWaitingGuests: config.greenroom.maxWaitingGuests,
      allowGuestVideo: config.greenroom.allowGuestVideo,
      allowGuestAudio: config.greenroom.allowGuestAudio,
      allowGuestScreenShare: config.greenroom.allowGuestScreenShare,
      guestNamePrefix: config.greenroom.guestNamePrefix,
      notifyOnJoin: config.greenroom.notifyOnJoin,
      notifySound: config.greenroom.notifySound,
      autoMuteOnEntry: config.greenroom.autoMuteOnEntry,
      showGuestCount: config.greenroom.showGuestCount,
      customInstructions: config.greenroom.customInstructions,
    },
  };
  localStorage.setItem(LOCAL_FIELDS_KEY(roomId), JSON.stringify(local));
}

function loadLocalFields(roomId: string, base: RoomConfig): RoomConfig {
  try {
    const raw = localStorage.getItem(LOCAL_FIELDS_KEY(roomId));
    if (!raw) return base;
    const local = JSON.parse(raw);
    return {
      ...base,
      themeMusic: local.themeMusic ?? base.themeMusic,
      soundEffects: local.soundEffects ?? base.soundEffects,
      overlay: local.overlay ?? base.overlay,
      watermark: local.watermark ?? base.watermark,
      lowerThird: local.lowerThird ?? base.lowerThird,
      ticker: local.ticker ?? base.ticker,
      chatStyle: local.chatStyle ?? base.chatStyle,
      alerts: local.alerts ?? base.alerts,
      streamInfo: local.streamInfo ?? base.streamInfo,
      greenroom: {
        ...base.greenroom,
        ...(local.greenroomLocal || {}),
      },
    };
  } catch {
    return base;
  }
}

// ============================================================================
// SAVED TEMPLATES (localStorage)
// ============================================================================

function loadSavedTemplates(): Template[] {
  try {
    const raw = localStorage.getItem("sl_room_templates");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistSavedTemplates(templates: Template[]) {
  localStorage.setItem("sl_room_templates", JSON.stringify(templates));
}

// ============================================================================
// SHARED STYLES
// ============================================================================

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  background: "rgba(0,0,0,0.4)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "10px",
  color: "#ffffff",
  fontSize: "14px",
  outline: "none",
  boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
};

const rangeStyle: React.CSSProperties = {
  width: "100%",
  accentColor: "#ef4444",
  cursor: "pointer",
};

// ============================================================================
// SECTION HELPER
// ============================================================================

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        marginBottom: "32px",
        padding: "24px",
        background: "rgba(0,0,0,0.2)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: "16px",
      }}
    >
      <h3
        style={{
          fontSize: "16px",
          fontWeight: 600,
          marginBottom: description ? "4px" : "16px",
          color: "#ffffff",
        }}
      >
        {title}
      </h3>
      {description && (
        <p
          style={{
            fontSize: "13px",
            color: "#9ca3af",
            marginBottom: "16px",
          }}
        >
          {description}
        </p>
      )}
      {children}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function RoomCustomizationPage() {
  const nav = useNavigate();
  const { roomId } = useParams<{ roomId: string }>();
  const { user: authUser, loading: authLoading } = useAuthMe();

  const [activeTab, setActiveTab] = useState<
    "templates" | "branding" | "visuals" | "audio" | "overlays" | "alerts" | "greenroom"
  >("templates");
  const [config, setConfig] = useState<RoomConfig>(defaultConfig);
  const [savedTemplates, setSavedTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>("minimal-dark");

  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateDesc, setNewTemplateDesc] = useState("");
  const [isPreviewMode, setIsPreviewMode] = useState(false);

  // ── Load data ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!roomId || authLoading) return;
    if (!authUser) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const [custResult, policyResult] = await Promise.allSettled([
          apiGetRoomCustomization(roomId),
          apiGetGreenroomPolicy(roomId),
        ]);

        if (cancelled) return;

        let merged = defaultConfig;

        if (custResult.status === "fulfilled") {
          merged = mergeServerCustomization(custResult.value.customization, merged);
        }
        if (policyResult.status === "fulfilled") {
          merged = mergeGreenroomPolicy(policyResult.value.greenroom, merged);
        }

        merged = loadLocalFields(roomId, merged);
        setConfig(merged);
        setSavedTemplates(loadSavedTemplates());
      } catch (err) {
        console.error("[RoomCustomizationPage] load error", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [roomId, authUser, authLoading]);

  // ── Apply template ───────────────────────────────────────────────────────
  const applyTemplate = useCallback((template: Template) => {
    setConfig(template.config);
    setSelectedTemplate(template.id);
  }, []);

  // ── Save as template ─────────────────────────────────────────────────────
  const saveAsTemplate = useCallback(() => {
    if (!newTemplateName.trim()) return;
    const t: Template = {
      id: `custom-${Date.now()}`,
      name: newTemplateName,
      description: newTemplateDesc || "Custom template",
      thumbnail: "✨",
      config: { ...config },
    };
    const next = [...savedTemplates, t];
    persistSavedTemplates(next);
    setSavedTemplates(next);
    setShowSaveModal(false);
    setNewTemplateName("");
    setNewTemplateDesc("");
  }, [newTemplateName, newTemplateDesc, config, savedTemplates]);

  const deleteTemplate = useCallback(
    (templateId: string) => {
      const next = savedTemplates.filter((t) => t.id !== templateId);
      persistSavedTemplates(next);
      setSavedTemplates(next);
      if (selectedTemplate === templateId) setSelectedTemplate(null);
    },
    [savedTemplates, selectedTemplate]
  );

  const updateConfig = useCallback(
    <K extends keyof RoomConfig>(key: K, value: RoomConfig[K]) => {
      setConfig((prev) => ({ ...prev, [key]: value }));
      setSelectedTemplate(null);
    },
    []
  );

  // ── Save ─────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!roomId || isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const serverPatch = toServerCustomization(config);
      await apiUpdateRoomCustomization(roomId, serverPatch);

      await apiUpdateGreenroomPolicy(roomId, {
        mode: config.greenroom.enabled ? "prejoin" : "off",
        requireApproval: config.greenroom.requireApproval,
        autoAdmit: config.greenroom.autoAdmit,
        vipList: config.greenroom.vipList,
        blockedList: config.greenroom.blockedUsers,
      });

      saveLocalFields(roomId, config);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      console.error("[RoomCustomizationPage] save error", err);
      setSaveError(err?.message || "Failed to save. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }, [roomId, config, isSaving]);

  const tabs = [
    { id: "templates", label: "Templates", icon: "📋" },
    { id: "branding", label: "Branding", icon: "🎨" },
    { id: "visuals", label: "Visuals", icon: "🖼️" },
    { id: "audio", label: "Audio", icon: "🎵" },
    { id: "overlays", label: "Overlays", icon: "📺" },
    { id: "alerts", label: "Alerts", icon: "🔔" },
    { id: "greenroom", label: "Greenroom", icon: "🚪" },
  ] as const;

  // ── Auth / loading guards ────────────────────────────────────────────────
  if (authLoading || loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#000", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#9ca3af" }}>Loading…</span>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div style={{ minHeight: "100vh", background: "#000", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ color: "#9ca3af", marginBottom: "16px" }}>You must be signed in to access room customization.</p>
          <button
            onClick={() => nav("/join")}
            style={{ padding: "10px 20px", background: "#dc2626", border: "none", borderRadius: "8px", color: "#fff", cursor: "pointer" }}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!roomId) {
    return (
      <div style={{ minHeight: "100vh", background: "#000", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ color: "#ef4444", marginBottom: "16px" }}>Invalid room ID.</p>
          <button
            onClick={() => nav("/join")}
            style={{ padding: "10px 20px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#fff", cursor: "pointer" }}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#000000",
        color: "#ffffff",
        position: "relative",
        overflow: "hidden",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* Animated background blobs */}
      <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }}>
        <div
          style={{
            position: "absolute",
            top: "-10%",
            left: "-5%",
            width: "500px",
            height: "500px",
            background: "radial-gradient(circle, rgba(220,38,38,0.15) 0%, transparent 70%)",
            filter: "blur(80px)",
            animation: "drift 20s ease-in-out infinite",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "-10%",
            right: "-5%",
            width: "600px",
            height: "600px",
            background: "radial-gradient(circle, rgba(239,68,68,0.1) 0%, transparent 70%)",
            filter: "blur(100px)",
            animation: "drift 25s ease-in-out infinite reverse",
          }}
        />
      </div>

      {/* Header */}
      <header
        style={{
          position: "relative",
          zIndex: 10,
          background: "rgba(10,10,10,0.8)",
          backdropFilter: "blur(20px)",
          borderBottom: "1px solid rgba(220,38,38,0.2)",
          padding: "16px 32px",
        }}
      >
        <div
          style={{
            maxWidth: "1600px",
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <button
              onClick={() => nav(`/rooms/${encodeURIComponent(roomId)}/setup`)}
              style={{
                padding: "10px 16px",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "10px",
                color: "#ffffff",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: 500,
              }}
            >
              ← Back
            </button>
            <div>
              <h1
                style={{
                  fontSize: "24px",
                  fontWeight: 700,
                  background: "linear-gradient(135deg, #ffffff 0%, #fecaca 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  margin: 0,
                }}
              >
                Room Customization
              </h1>
              <p style={{ fontSize: "13px", color: "#6b7280", margin: "4px 0 0 0" }}>
                Customize your stream's look and feel
              </p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              onClick={() => setIsPreviewMode((v) => !v)}
              style={{
                padding: "10px 20px",
                background: isPreviewMode ? "rgba(34,197,94,0.2)" : "rgba(255,255,255,0.05)",
                border: `1px solid ${isPreviewMode ? "rgba(34,197,94,0.5)" : "rgba(255,255,255,0.1)"}`,
                borderRadius: "10px",
                color: isPreviewMode ? "#22c55e" : "#ffffff",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: 600,
              }}
            >
              {isPreviewMode ? "👁️ Preview On" : "👁️ Preview"}
            </button>
            <button
              onClick={() => setShowSaveModal(true)}
              style={{
                padding: "10px 20px",
                background: "rgba(59,130,246,0.2)",
                border: "1px solid rgba(59,130,246,0.5)",
                borderRadius: "10px",
                color: "#3b82f6",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: 600,
              }}
            >
              💾 Save as Template
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              style={{
                padding: "10px 24px",
                background: isSaving
                  ? "rgba(220,38,38,0.5)"
                  : saveSuccess
                  ? "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)"
                  : "linear-gradient(135deg, #dc2626 0%, #ef4444 100%)",
                border: "none",
                borderRadius: "10px",
                color: "#ffffff",
                cursor: isSaving ? "not-allowed" : "pointer",
                fontSize: "14px",
                fontWeight: 600,
                boxShadow: isSaving || saveSuccess ? "none" : "0 4px 20px rgba(220,38,38,0.3)",
              }}
            >
              {isSaving ? "Saving…" : saveSuccess ? "✓ Saved!" : "✓ Apply Changes"}
            </button>
          </div>
        </div>

        {saveError && (
          <div
            style={{
              maxWidth: "1600px",
              margin: "8px auto 0",
              padding: "8px 16px",
              background: "rgba(239,68,68,0.15)",
              border: "1px solid rgba(239,68,68,0.4)",
              borderRadius: "8px",
              fontSize: "13px",
              color: "#fca5a5",
            }}
          >
            ⚠ {saveError}
          </div>
        )}
      </header>

      {/* Main content */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          maxWidth: "1600px",
          margin: "0 auto",
          padding: "24px 32px",
          display: "grid",
          gridTemplateColumns: isPreviewMode ? "1fr 500px" : "240px 1fr",
          gap: "24px",
          minHeight: "calc(100vh - 100px)",
        }}
      >
        {isPreviewMode ? (
          <>
            {/* Settings panel (compact, when preview active) */}
            <div
              style={{
                background: "rgba(15,15,15,0.8)",
                backdropFilter: "blur(20px)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "16px",
                padding: "24px",
                overflowY: "auto",
              }}
            >
              <TabBar tabs={tabs} activeTab={activeTab} onSelect={setActiveTab} />
              <div style={{ marginTop: "16px" }}>
                <TabContent
                  activeTab={activeTab}
                  config={config}
                  updateConfig={updateConfig}
                  presetTemplates={presetTemplates}
                  savedTemplates={savedTemplates}
                  selectedTemplate={selectedTemplate}
                  applyTemplate={applyTemplate}
                  deleteTemplate={deleteTemplate}
                />
              </div>
            </div>

            {/* Preview panel */}
            <div
              style={{
                background: "rgba(15,15,15,0.8)",
                backdropFilter: "blur(20px)",
                border: "1px solid rgba(220,38,38,0.3)",
                borderRadius: "16px",
                padding: "16px",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "#ef4444",
                  marginBottom: "12px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: "#ef4444",
                    animation: "pulse 2s ease-in-out infinite",
                  }}
                />
                LIVE PREVIEW
              </div>
              <PreviewPanel config={config} />
            </div>
          </>
        ) : (
          <>
            {/* Sidebar tabs */}
            <nav
              style={{
                background: "rgba(15,15,15,0.8)",
                backdropFilter: "blur(20px)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "16px",
                padding: "16px",
                height: "fit-content",
                position: "sticky",
                top: "24px",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    style={{
                      padding: "12px 16px",
                      background:
                        activeTab === tab.id ? "rgba(220,38,38,0.15)" : "transparent",
                      border:
                        activeTab === tab.id
                          ? "1px solid rgba(220,38,38,0.3)"
                          : "1px solid transparent",
                      borderRadius: "10px",
                      color: activeTab === tab.id ? "#ef4444" : "#9ca3af",
                      cursor: "pointer",
                      fontSize: "14px",
                      fontWeight: activeTab === tab.id ? 600 : 500,
                      textAlign: "left",
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                    }}
                  >
                    <span style={{ fontSize: "18px" }}>{tab.icon}</span>
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Quick preview thumbnail */}
              <div
                style={{
                  marginTop: "24px",
                  padding: "16px",
                  background: "rgba(0,0,0,0.3)",
                  borderRadius: "12px",
                  border: "1px solid rgba(255,255,255,0.05)",
                }}
              >
                <div
                  style={{ fontSize: "12px", color: "#6b7280", marginBottom: "8px" }}
                >
                  Quick Preview
                </div>
                <div
                  style={{
                    aspectRatio: "16/9",
                    borderRadius: "8px",
                    overflow: "hidden",
                    background:
                      config.background.type === "solid" ||
                      config.background.type === "gradient"
                        ? config.background.value
                        : "#0a0a0a",
                    border: "1px solid rgba(255,255,255,0.1)",
                    position: "relative",
                  }}
                >
                  {config.logo && (
                    <div
                      style={{
                        position: "absolute",
                        top: config.logo.position.includes("top") ? "8px" : "auto",
                        bottom: config.logo.position.includes("bottom") ? "8px" : "auto",
                        left: config.logo.position.includes("left") ? "8px" : "auto",
                        right: config.logo.position.includes("right") ? "8px" : "auto",
                        width: "20px",
                        height: "20px",
                        background: "rgba(255,255,255,0.3)",
                        borderRadius: "4px",
                      }}
                    />
                  )}
                  <div
                    style={{
                      position: "absolute",
                      bottom: "8px",
                      left: "8px",
                      right: "8px",
                      height: "12px",
                      background: "rgba(0,0,0,0.5)",
                      borderRadius: "4px",
                    }}
                  />
                </div>
              </div>
            </nav>

            {/* Main content panel */}
            <div
              style={{
                background: "rgba(15,15,15,0.8)",
                backdropFilter: "blur(20px)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "16px",
                padding: "32px",
                overflowY: "auto",
              }}
            >
              <TabContent
                activeTab={activeTab}
                config={config}
                updateConfig={updateConfig}
                presetTemplates={presetTemplates}
                savedTemplates={savedTemplates}
                selectedTemplate={selectedTemplate}
                applyTemplate={applyTemplate}
                deleteTemplate={deleteTemplate}
              />
            </div>
          </>
        )}
      </div>

      {/* Save Template Modal */}
      {showSaveModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.8)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={() => setShowSaveModal(false)}
        >
          <div
            style={{
              background:
                "linear-gradient(135deg, rgba(20,20,20,0.98) 0%, rgba(30,20,20,0.98) 100%)",
              border: "1px solid rgba(220,38,38,0.3)",
              borderRadius: "20px",
              padding: "32px",
              width: "100%",
              maxWidth: "480px",
              boxShadow: "0 25px 50px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              style={{
                fontSize: "22px",
                fontWeight: 700,
                marginBottom: "8px",
                background: "linear-gradient(135deg, #ffffff 0%, #fecaca 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Save as Template
            </h2>
            <p style={{ fontSize: "14px", color: "#9ca3af", marginBottom: "24px" }}>
              Save your current configuration as a reusable template
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    color: "#9ca3af",
                    marginBottom: "8px",
                  }}
                >
                  Template Name *
                </label>
                <input
                  type="text"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder="My Awesome Template"
                  style={inputStyle}
                />
              </div>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    color: "#9ca3af",
                    marginBottom: "8px",
                  }}
                >
                  Description
                </label>
                <textarea
                  value={newTemplateDesc}
                  onChange={(e) => setNewTemplateDesc(e.target.value)}
                  placeholder="A brief description of this template…"
                  rows={3}
                  style={{ ...inputStyle, resize: "none" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
              <button
                onClick={() => setShowSaveModal(false)}
                style={{
                  flex: 1,
                  padding: "12px",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "10px",
                  color: "#ffffff",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: 600,
                }}
              >
                Cancel
              </button>
              <button
                onClick={saveAsTemplate}
                disabled={!newTemplateName.trim()}
                style={{
                  flex: 1,
                  padding: "12px",
                  background: newTemplateName.trim()
                    ? "linear-gradient(135deg, #dc2626 0%, #ef4444 100%)"
                    : "rgba(220,38,38,0.3)",
                  border: "none",
                  borderRadius: "10px",
                  color: "#ffffff",
                  cursor: newTemplateName.trim() ? "pointer" : "not-allowed",
                  fontSize: "14px",
                  fontWeight: 600,
                }}
              >
                Save Template
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSS Animations */}
      <style>{`
        @keyframes drift {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(30px, -30px); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

// ============================================================================
// TAB BAR (used in preview mode)
// ============================================================================

function TabBar({
  tabs,
  activeTab,
  onSelect,
}: {
  tabs: readonly { id: string; label: string; icon: string }[];
  activeTab: string;
  onSelect: (id: any) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          style={{
            padding: "8px 12px",
            background: activeTab === tab.id ? "rgba(220,38,38,0.15)" : "transparent",
            border: `1px solid ${activeTab === tab.id ? "rgba(220,38,38,0.3)" : "rgba(255,255,255,0.1)"}`,
            borderRadius: "8px",
            color: activeTab === tab.id ? "#ef4444" : "#9ca3af",
            cursor: "pointer",
            fontSize: "12px",
            fontWeight: activeTab === tab.id ? 600 : 500,
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          {tab.icon} {tab.label}
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// PREVIEW PANEL
// ============================================================================

function PreviewPanel({ config }: { config: RoomConfig }) {
  const bg =
    config.background.type === "solid" || config.background.type === "gradient"
      ? config.background.value
      : "#0a0a0a";

  return (
    <div
      style={{
        flex: 1,
        borderRadius: "12px",
        overflow: "hidden",
        background: bg,
        position: "relative",
        aspectRatio: "16/9",
        border: "1px solid rgba(255,255,255,0.1)",
      }}
    >
      {/* Banner */}
      {config.banner && (
        <div
          style={{
            position: "absolute",
            [config.banner.position]: 0,
            left: 0,
            right: 0,
            height: `${config.banner.height}px`,
            background: `rgba(0,0,0,${config.banner.opacity * 0.5})`,
            borderBottom:
              config.banner.position === "top"
                ? "2px solid rgba(220,38,38,0.5)"
                : undefined,
            borderTop:
              config.banner.position === "bottom"
                ? "2px solid rgba(220,38,38,0.5)"
                : undefined,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "10px",
            color: "#9ca3af",
          }}
        >
          Banner
        </div>
      )}

      {/* Logo placeholder */}
      {config.logo && (
        <div
          style={{
            position: "absolute",
            top: config.logo.position.includes("top") ? "8px" : "auto",
            bottom: config.logo.position.includes("bottom") ? "8px" : "auto",
            left: config.logo.position.includes("left") ? "8px" : "auto",
            right: config.logo.position.includes("right") ? "8px" : "auto",
            width: "40px",
            height: "40px",
            background: "rgba(255,255,255,0.2)",
            borderRadius: "6px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "8px",
            color: "#9ca3af",
          }}
        >
          Logo
        </div>
      )}

      {/* Lower third */}
      {config.lowerThird?.enabled && (
        <div
          style={{
            position: "absolute",
            bottom: "20%",
            left: "8px",
            right: "8px",
            height: "28px",
            background: config.lowerThird.primaryColor,
            borderRadius: "4px",
            display: "flex",
            alignItems: "center",
            padding: "0 8px",
            fontSize: "10px",
            color: config.lowerThird.textColor,
          }}
        >
          Lower Third
        </div>
      )}

      {/* Ticker */}
      {config.ticker?.enabled && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "20px",
            background: config.ticker.backgroundColor,
            display: "flex",
            alignItems: "center",
            padding: "0 8px",
            fontSize: "9px",
            color: config.ticker.textColor,
          }}
        >
          📰 {config.ticker.messages[0] || "Ticker message…"}
        </div>
      )}

      {/* Center label */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.2)" }}>
          Live Preview
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// TAB CONTENT ROUTER
// ============================================================================

function TabContent({
  activeTab,
  config,
  updateConfig,
  presetTemplates,
  savedTemplates,
  selectedTemplate,
  applyTemplate,
  deleteTemplate,
}: {
  activeTab: string;
  config: RoomConfig;
  updateConfig: <K extends keyof RoomConfig>(key: K, value: RoomConfig[K]) => void;
  presetTemplates: Template[];
  savedTemplates: Template[];
  selectedTemplate: string | null;
  applyTemplate: (template: Template) => void;
  deleteTemplate: (id: string) => void;
}) {
  switch (activeTab) {
    case "templates":
      return (
        <TemplatesTab
          presetTemplates={presetTemplates}
          savedTemplates={savedTemplates}
          selectedTemplate={selectedTemplate}
          applyTemplate={applyTemplate}
          deleteTemplate={deleteTemplate}
        />
      );
    case "branding":
      return <BrandingTab config={config} updateConfig={updateConfig} />;
    case "visuals":
      return <VisualsTab config={config} updateConfig={updateConfig} />;
    case "audio":
      return <AudioTab config={config} updateConfig={updateConfig} />;
    case "overlays":
      return <OverlaysTab config={config} updateConfig={updateConfig} />;
    case "alerts":
      return <AlertsTab config={config} updateConfig={updateConfig} />;
    case "greenroom":
      return <GreenroomTab config={config} updateConfig={updateConfig} />;
    default:
      return null;
  }
}

// ============================================================================
// TEMPLATES TAB
// ============================================================================

function TemplatesTab({
  presetTemplates,
  savedTemplates,
  selectedTemplate,
  applyTemplate,
  deleteTemplate,
}: {
  presetTemplates: Template[];
  savedTemplates: Template[];
  selectedTemplate: string | null;
  applyTemplate: (template: Template) => void;
  deleteTemplate: (id: string) => void;
}) {
  return (
    <div>
      <div style={{ marginBottom: "32px" }}>
        <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "8px" }}>
          Preset Templates
        </h2>
        <p style={{ fontSize: "14px", color: "#9ca3af", marginBottom: "20px" }}>
          Start with a professionally designed template
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: "16px",
          }}
        >
          {presetTemplates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              isSelected={selectedTemplate === template.id}
              onSelect={() => applyTemplate(template)}
            />
          ))}
        </div>
      </div>

      {savedTemplates.length > 0 && (
        <div>
          <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "8px" }}>
            Your Templates
          </h2>
          <p style={{ fontSize: "14px", color: "#9ca3af", marginBottom: "20px" }}>
            Templates you've saved
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: "16px",
            }}
          >
            {savedTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                isSelected={selectedTemplate === template.id}
                onSelect={() => applyTemplate(template)}
                onDelete={() => deleteTemplate(template.id)}
                isCustom
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  template,
  isSelected,
  onSelect,
  onDelete,
  isCustom,
}: {
  template: Template;
  isSelected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  isCustom?: boolean;
}) {
  return (
    <div
      style={{
        background: isSelected ? "rgba(220,38,38,0.1)" : "rgba(0,0,0,0.3)",
        border: `2px solid ${isSelected ? "rgba(220,38,38,0.5)" : "rgba(255,255,255,0.1)"}`,
        borderRadius: "16px",
        padding: "20px",
        cursor: "pointer",
        transition: "all 0.3s ease",
        position: "relative",
      }}
      onClick={onSelect}
    >
      {template.isPremium && (
        <div
          style={{
            position: "absolute",
            top: "12px",
            right: "12px",
            padding: "4px 8px",
            background: "linear-gradient(135deg, #f59e0b, #d97706)",
            borderRadius: "6px",
            fontSize: "10px",
            fontWeight: 700,
            color: "#000",
          }}
        >
          PRO
        </div>
      )}
      {isSelected && (
        <div
          style={{
            position: "absolute",
            top: "12px",
            left: "12px",
            width: "24px",
            height: "24px",
            background: "linear-gradient(135deg, #22c55e, #16a34a)",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "14px",
          }}
        >
          ✓
        </div>
      )}
      <div
        style={{ fontSize: "48px", marginBottom: "16px", textAlign: "center" }}
      >
        {template.thumbnail}
      </div>
      <h3
        style={{
          fontSize: "16px",
          fontWeight: 600,
          marginBottom: "4px",
          color: isSelected ? "#ef4444" : "#ffffff",
        }}
      >
        {template.name}
      </h3>
      <p style={{ fontSize: "13px", color: "#9ca3af", lineHeight: 1.5 }}>
        {template.description}
      </p>

      {isCustom && onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          style={{
            position: "absolute",
            bottom: "12px",
            right: "12px",
            padding: "6px 12px",
            background: "rgba(239,68,68,0.2)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: "6px",
            color: "#ef4444",
            fontSize: "12px",
            cursor: "pointer",
          }}
        >
          Delete
        </button>
      )}
    </div>
  );
}

// ============================================================================
// BRANDING TAB
// ============================================================================

function BrandingTab({
  config,
  updateConfig,
}: {
  config: RoomConfig;
  updateConfig: <K extends keyof RoomConfig>(key: K, value: RoomConfig[K]) => void;
}) {
  const [logoUrl, setLogoUrl] = useState(config.logo?.url || "");
  const [bannerUrl, setBannerUrl] = useState(config.banner?.url || "");
  const [watermarkUrl, setWatermarkUrl] = useState(config.watermark?.url || "");

  return (
    <div>
      <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "24px" }}>
        Branding &amp; Identity
      </h2>

      <Section title="Logo" description="Your channel or brand logo">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div>
            <label style={{ display: "block", fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
              Logo URL
            </label>
            <input
              type="text"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              onBlur={() => {
                if (logoUrl) {
                  updateConfig("logo", {
                    url: logoUrl,
                    position: config.logo?.position || "top-right",
                    size: config.logo?.size || 80,
                    opacity: config.logo?.opacity || 0.9,
                  });
                } else {
                  updateConfig("logo", null);
                }
              }}
              placeholder="https://example.com/logo.png"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
              Position
            </label>
            <select
              value={config.logo?.position || "top-right"}
              onChange={(e) =>
                updateConfig("logo", {
                  ...config.logo!,
                  position: e.target.value as LogoConfig["position"],
                })
              }
              style={selectStyle}
              disabled={!config.logo}
            >
              <option value="top-left">Top Left</option>
              <option value="top-right">Top Right</option>
              <option value="bottom-left">Bottom Left</option>
              <option value="bottom-right">Bottom Right</option>
            </select>
          </div>
        </div>
        {config.logo && (
          <div style={{ marginTop: "16px" }}>
            <label style={{ display: "block", fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
              Size: {config.logo.size}px
            </label>
            <input
              type="range"
              min="40"
              max="200"
              value={config.logo.size}
              onChange={(e) =>
                updateConfig("logo", { ...config.logo!, size: parseInt(e.target.value) })
              }
              style={rangeStyle}
            />
          </div>
        )}
      </Section>

      <Section title="Banner" description="Top or bottom banner image">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div>
            <label style={{ display: "block", fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
              Banner URL
            </label>
            <input
              type="text"
              value={bannerUrl}
              onChange={(e) => setBannerUrl(e.target.value)}
              onBlur={() => {
                if (bannerUrl) {
                  updateConfig("banner", {
                    url: bannerUrl,
                    position: config.banner?.position || "top",
                    height: config.banner?.height || 60,
                    opacity: config.banner?.opacity || 1,
                  });
                } else {
                  updateConfig("banner", null);
                }
              }}
              placeholder="https://example.com/banner.png"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
              Position
            </label>
            <select
              value={config.banner?.position || "top"}
              onChange={(e) =>
                updateConfig("banner", {
                  ...config.banner!,
                  position: e.target.value as "top" | "bottom",
                })
              }
              style={selectStyle}
              disabled={!config.banner}
            >
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
            </select>
          </div>
        </div>
      </Section>

      <Section title="Watermark" description="Semi-transparent overlay image (stored locally)">
        <div>
          <label style={{ display: "block", fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
            Watermark URL
          </label>
          <input
            type="text"
            value={watermarkUrl}
            onChange={(e) => setWatermarkUrl(e.target.value)}
            onBlur={() => {
              if (watermarkUrl) {
                updateConfig("watermark", {
                  url: watermarkUrl,
                  position: config.watermark?.position || "center",
                  size: config.watermark?.size || 200,
                  opacity: config.watermark?.opacity || 0.2,
                });
              } else {
                updateConfig("watermark", null);
              }
            }}
            placeholder="https://example.com/watermark.png"
            style={inputStyle}
          />
        </div>
        {config.watermark && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "16px" }}>
            <div>
              <label style={{ display: "block", fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
                Opacity: {Math.round(config.watermark.opacity * 100)}%
              </label>
              <input
                type="range"
                min="5"
                max="50"
                value={config.watermark.opacity * 100}
                onChange={(e) =>
                  updateConfig("watermark", {
                    ...config.watermark!,
                    opacity: parseInt(e.target.value) / 100,
                  })
                }
                style={rangeStyle}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
                Position
              </label>
              <select
                value={config.watermark.position}
                onChange={(e) =>
                  updateConfig("watermark", {
                    ...config.watermark!,
                    position: e.target.value as WatermarkConfig["position"],
                  })
                }
                style={selectStyle}
              >
                <option value="center">Center</option>
                <option value="top-left">Top Left</option>
                <option value="top-right">Top Right</option>
                <option value="bottom-left">Bottom Left</option>
                <option value="bottom-right">Bottom Right</option>
              </select>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

// ============================================================================
// VISUALS TAB
// ============================================================================

const backgroundPresets = [
  { type: "solid", value: "#000000", label: "Pure Black" },
  { type: "solid", value: "#0a0a0a", label: "Dark Gray" },
  { type: "solid", value: "#1a1a2e", label: "Deep Navy" },
  { type: "gradient", value: "linear-gradient(135deg, #0f0f23 0%, #1a0a2e 100%)", label: "Purple Night" },
  { type: "gradient", value: "linear-gradient(180deg, #2d1b69 0%, #11001c 100%)", label: "Retro Purple" },
  { type: "gradient", value: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)", label: "Ocean Deep" },
  { type: "gradient", value: "linear-gradient(135deg, #3c2415 0%, #1a0f0a 100%)", label: "Warm Brown" },
  { type: "gradient", value: "linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)", label: "Teal Gradient" },
  { type: "animated", value: "particles", label: "Particles ✨" },
];

function VisualsTab({
  config,
  updateConfig,
}: {
  config: RoomConfig;
  updateConfig: <K extends keyof RoomConfig>(key: K, value: RoomConfig[K]) => void;
}) {
  return (
    <div>
      <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "24px" }}>
        Visual Settings
      </h2>

      <Section title="Background" description="Choose your stream's backdrop">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
            gap: "12px",
            marginBottom: "20px",
          }}
        >
          {backgroundPresets.map((preset, i) => (
            <div
              key={i}
              onClick={() =>
                updateConfig("background", {
                  type: preset.type as BackgroundConfig["type"],
                  value: preset.value,
                })
              }
              style={{
                aspectRatio: "16/9",
                borderRadius: "10px",
                background: preset.type === "animated" ? "#1a1a2e" : preset.value,
                border:
                  config.background.value === preset.value
                    ? "2px solid #ef4444"
                    : "2px solid rgba(255,255,255,0.1)",
                cursor: "pointer",
                position: "relative",
                overflow: "hidden",
              }}
            >
              {preset.type === "animated" && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "24px",
                  }}
                >
                  ✨
                </div>
              )}
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  padding: "6px",
                  background: "rgba(0,0,0,0.7)",
                  fontSize: "10px",
                  textAlign: "center",
                }}
              >
                {preset.label}
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: "20px" }}>
          <label style={{ display: "block", fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
            Custom Background (URL or CSS gradient)
          </label>
          <input
            type="text"
            value={config.background.type === "image" ? config.background.value : ""}
            onChange={(e) =>
              updateConfig("background", { type: "image", value: e.target.value })
            }
            placeholder="https://example.com/background.jpg"
            style={inputStyle}
          />
        </div>
      </Section>

      <Section title="Overlay Frame" description="Add a decorative frame overlay (stored locally)">
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          {["None", "Gaming", "Minimal", "Tech", "Neon"].map((style) => (
            <button
              key={style}
              onClick={() => {
                if (style === "None") {
                  updateConfig("overlay", null);
                } else {
                  updateConfig("overlay", {
                    url: `/overlays/${style.toLowerCase()}.png`,
                    opacity: 1,
                    blendMode: "normal",
                  });
                }
              }}
              style={{
                padding: "10px 20px",
                background:
                  (config.overlay === null && style === "None") ||
                  config.overlay?.url.includes(style.toLowerCase())
                    ? "rgba(220,38,38,0.2)"
                    : "rgba(255,255,255,0.05)",
                border: `1px solid ${
                  (config.overlay === null && style === "None") ||
                  config.overlay?.url.includes(style.toLowerCase())
                    ? "rgba(220,38,38,0.5)"
                    : "rgba(255,255,255,0.1)"
                }`,
                borderRadius: "8px",
                color: "#ffffff",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: 500,
              }}
            >
              {style}
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}

// ============================================================================
// AUDIO TAB
// ============================================================================

function AudioTab({
  config,
  updateConfig,
}: {
  config: RoomConfig;
  updateConfig: <K extends keyof RoomConfig>(key: K, value: RoomConfig[K]) => void;
}) {
  const [musicUrl, setMusicUrl] = useState(config.themeMusic?.url || "");
  const [musicName, setMusicName] = useState(config.themeMusic?.name || "");

  const presetMusic = [
    { name: "Lo-Fi Beats", url: "/audio/lofi.mp3", emoji: "🎧" },
    { name: "Epic Gaming", url: "/audio/epic.mp3", emoji: "🎮" },
    { name: "Chill Vibes", url: "/audio/chill.mp3", emoji: "🌊" },
    { name: "Retro Arcade", url: "/audio/retro.mp3", emoji: "👾" },
    { name: "Corporate", url: "/audio/corporate.mp3", emoji: "💼" },
  ];

  const soundEffectTypes = [
    { trigger: "follow", label: "New Follower", emoji: "👋" },
    { trigger: "subscribe", label: "New Subscriber", emoji: "⭐" },
    { trigger: "donation", label: "Donation", emoji: "💰" },
    { trigger: "raid", label: "Raid Alert", emoji: "🚀" },
  ] as const;

  return (
    <div>
      <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "24px" }}>
        Audio Settings
        <span style={{ fontSize: "12px", color: "#6b7280", fontWeight: 400, marginLeft: "12px" }}>
          (stored locally)
        </span>
      </h2>

      <Section title="Theme Music" description="Background music for your stream">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: "12px",
            marginBottom: "20px",
          }}
        >
          {presetMusic.map((music) => (
            <div
              key={music.name}
              onClick={() =>
                updateConfig("themeMusic", {
                  url: music.url,
                  name: music.name,
                  volume: config.themeMusic?.volume || 0.3,
                  loop: true,
                  playOn: "waiting",
                })
              }
              style={{
                padding: "16px",
                background:
                  config.themeMusic?.name === music.name
                    ? "rgba(220,38,38,0.2)"
                    : "rgba(0,0,0,0.3)",
                border: `1px solid ${config.themeMusic?.name === music.name ? "rgba(220,38,38,0.5)" : "rgba(255,255,255,0.1)"}`,
                borderRadius: "12px",
                cursor: "pointer",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "32px", marginBottom: "8px" }}>{music.emoji}</div>
              <div style={{ fontSize: "13px", fontWeight: 500 }}>{music.name}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div>
            <label style={{ display: "block", fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
              Custom Music URL
            </label>
            <input
              type="text"
              value={musicUrl}
              onChange={(e) => setMusicUrl(e.target.value)}
              onBlur={() => {
                if (musicUrl) {
                  updateConfig("themeMusic", {
                    url: musicUrl,
                    name: musicName || "Custom Track",
                    volume: config.themeMusic?.volume || 0.3,
                    loop: true,
                    playOn: "waiting",
                  });
                }
              }}
              placeholder="https://example.com/music.mp3"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
              Music Name
            </label>
            <input
              type="text"
              value={musicName}
              onChange={(e) => setMusicName(e.target.value)}
              placeholder="My Custom Track"
              style={inputStyle}
            />
          </div>
        </div>

        {config.themeMusic && (
          <div style={{ marginTop: "20px" }}>
            <label style={{ display: "block", fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
              Volume: {Math.round(config.themeMusic.volume * 100)}%
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={config.themeMusic.volume * 100}
              onChange={(e) =>
                updateConfig("themeMusic", {
                  ...config.themeMusic!,
                  volume: parseInt(e.target.value) / 100,
                })
              }
              style={rangeStyle}
            />
          </div>
        )}
      </Section>

      <Section title="Sound Effects" description="Alert sounds for interactions">
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {soundEffectTypes.map((effect) => {
            const existingEffect = config.soundEffects.find(
              (e) => e.trigger === effect.trigger
            );
            return (
              <div
                key={effect.trigger}
                style={{
                  padding: "16px",
                  background: "rgba(0,0,0,0.3)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{ fontSize: "24px" }}>{effect.emoji}</span>
                  <div>
                    <div style={{ fontWeight: 500 }}>{effect.label}</div>
                    <div style={{ fontSize: "12px", color: "#9ca3af" }}>
                      {existingEffect ? existingEffect.name : "No sound set"}
                    </div>
                  </div>
                </div>
                <span style={{ fontSize: "12px", color: "#6b7280" }}>
                  {existingEffect ? "✓ Set" : "Not set"}
                </span>
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

// ============================================================================
// OVERLAYS TAB
// ============================================================================

function OverlaysTab({
  config,
  updateConfig,
}: {
  config: RoomConfig;
  updateConfig: <K extends keyof RoomConfig>(key: K, value: RoomConfig[K]) => void;
}) {
  return (
    <div>
      <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "24px" }}>
        Overlays &amp; Text
        <span style={{ fontSize: "12px", color: "#6b7280", fontWeight: 400, marginLeft: "12px" }}>
          (stored locally)
        </span>
      </h2>

      <Section title="Lower Third" description="Name and title overlay at bottom">
        <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", marginBottom: "20px" }}>
          <input
            type="checkbox"
            checked={config.lowerThird?.enabled || false}
            onChange={(e) =>
              updateConfig("lowerThird", {
                ...config.lowerThird!,
                enabled: e.target.checked,
              })
            }
            style={{ accentColor: "#ef4444", width: "18px", height: "18px" }}
          />
          <span style={{ fontWeight: 500 }}>Enable Lower Third</span>
        </label>

        {config.lowerThird?.enabled && (
          <>
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
                Style
              </label>
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                {(["modern", "minimal", "classic", "neon"] as const).map((style) => (
                  <button
                    key={style}
                    onClick={() =>
                      updateConfig("lowerThird", {
                        ...config.lowerThird!,
                        template: style,
                      })
                    }
                    style={{
                      padding: "10px 20px",
                      background:
                        config.lowerThird?.template === style
                          ? "rgba(220,38,38,0.2)"
                          : "rgba(255,255,255,0.05)",
                      border: `1px solid ${config.lowerThird?.template === style ? "rgba(220,38,38,0.5)" : "rgba(255,255,255,0.1)"}`,
                      borderRadius: "8px",
                      color: "#ffffff",
                      cursor: "pointer",
                      fontSize: "13px",
                      fontWeight: 500,
                      textTransform: "capitalize",
                    }}
                  >
                    {style}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px" }}>
              {(["primaryColor", "secondaryColor", "textColor"] as const).map((field) => (
                <div key={field}>
                  <label style={{ display: "block", fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
                    {field === "primaryColor" ? "Primary" : field === "secondaryColor" ? "Secondary" : "Text"} Color
                  </label>
                  <input
                    type="color"
                    value={config.lowerThird![field]}
                    onChange={(e) =>
                      updateConfig("lowerThird", {
                        ...config.lowerThird!,
                        [field]: e.target.value,
                      })
                    }
                    style={{ width: "100%", height: "40px", border: "none", borderRadius: "8px", cursor: "pointer" }}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </Section>

      <Section title="News Ticker" description="Scrolling text at bottom of stream">
        <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", marginBottom: "20px" }}>
          <input
            type="checkbox"
            checked={config.ticker?.enabled || false}
            onChange={(e) => {
              if (e.target.checked) {
                updateConfig("ticker", {
                  enabled: true,
                  messages: ["Welcome to the stream!", "Don't forget to follow!"],
                  speed: 50,
                  backgroundColor: "#dc2626",
                  textColor: "#ffffff",
                });
              } else {
                updateConfig("ticker", null);
              }
            }}
            style={{ accentColor: "#ef4444", width: "18px", height: "18px" }}
          />
          <span style={{ fontWeight: 500 }}>Enable Ticker</span>
        </label>

        {config.ticker?.enabled && (
          <>
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
                Messages (one per line)
              </label>
              <textarea
                value={config.ticker.messages.join("\n")}
                onChange={(e) =>
                  updateConfig("ticker", {
                    ...config.ticker!,
                    messages: e.target.value
                      .split("\n")
                      .filter((m) => m.trim()),
                  })
                }
                rows={4}
                style={{ ...inputStyle, resize: "vertical" }}
                placeholder={"Welcome to the stream!\nFollow for more content!"}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div>
                <label style={{ display: "block", fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
                  Background Color
                </label>
                <input
                  type="color"
                  value={config.ticker.backgroundColor}
                  onChange={(e) =>
                    updateConfig("ticker", {
                      ...config.ticker!,
                      backgroundColor: e.target.value,
                    })
                  }
                  style={{ width: "100%", height: "40px", border: "none", borderRadius: "8px", cursor: "pointer" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
                  Speed: {config.ticker.speed}px/s
                </label>
                <input
                  type="range"
                  min="20"
                  max="100"
                  value={config.ticker.speed}
                  onChange={(e) =>
                    updateConfig("ticker", {
                      ...config.ticker!,
                      speed: parseInt(e.target.value),
                    })
                  }
                  style={rangeStyle}
                />
              </div>
            </div>
          </>
        )}
      </Section>

      <Section title="Chat Appearance" description="Customize how chat looks on stream">
        <div style={{ marginBottom: "20px" }}>
          <label style={{ display: "block", fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
            Theme
          </label>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            {(["default", "minimal", "bubble", "neon", "retro"] as const).map((theme) => (
              <button
                key={theme}
                onClick={() =>
                  updateConfig("chatStyle", { ...config.chatStyle, theme })
                }
                style={{
                  padding: "10px 20px",
                  background:
                    config.chatStyle.theme === theme
                      ? "rgba(220,38,38,0.2)"
                      : "rgba(255,255,255,0.05)",
                  border: `1px solid ${config.chatStyle.theme === theme ? "rgba(220,38,38,0.5)" : "rgba(255,255,255,0.1)"}`,
                  borderRadius: "8px",
                  color: "#ffffff",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: 500,
                  textTransform: "capitalize",
                }}
              >
                {theme}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div>
            <label style={{ display: "block", fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
              Font Size: {config.chatStyle.fontSize}px
            </label>
            <input
              type="range"
              min="12"
              max="24"
              value={config.chatStyle.fontSize}
              onChange={(e) =>
                updateConfig("chatStyle", {
                  ...config.chatStyle,
                  fontSize: parseInt(e.target.value),
                })
              }
              style={rangeStyle}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={config.chatStyle.showBadges}
                onChange={(e) =>
                  updateConfig("chatStyle", {
                    ...config.chatStyle,
                    showBadges: e.target.checked,
                  })
                }
                style={{ accentColor: "#ef4444" }}
              />
              <span style={{ fontSize: "13px" }}>Show Badges</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={config.chatStyle.showTimestamps}
                onChange={(e) =>
                  updateConfig("chatStyle", {
                    ...config.chatStyle,
                    showTimestamps: e.target.checked,
                  })
                }
                style={{ accentColor: "#ef4444" }}
              />
              <span style={{ fontSize: "13px" }}>Show Timestamps</span>
            </label>
          </div>
        </div>
      </Section>
    </div>
  );
}

// ============================================================================
// ALERTS TAB
// ============================================================================

function AlertsTab({
  config,
  updateConfig,
}: {
  config: RoomConfig;
  updateConfig: <K extends keyof RoomConfig>(key: K, value: RoomConfig[K]) => void;
}) {
  return (
    <div>
      <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "24px" }}>
        Alert Settings
        <span style={{ fontSize: "12px", color: "#6b7280", fontWeight: 400, marginLeft: "12px" }}>
          (stored locally)
        </span>
      </h2>

      <Section title="Alert Style" description="How alerts appear on screen">
        <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", marginBottom: "20px" }}>
          <input
            type="checkbox"
            checked={config.alerts.enabled}
            onChange={(e) =>
              updateConfig("alerts", { ...config.alerts, enabled: e.target.checked })
            }
            style={{ accentColor: "#ef4444", width: "18px", height: "18px" }}
          />
          <span style={{ fontWeight: 500 }}>Enable Alerts</span>
        </label>

        {config.alerts.enabled && (
          <>
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
                Display Style
              </label>
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                {(["popup", "banner", "corner"] as const).map((style) => (
                  <button
                    key={style}
                    onClick={() =>
                      updateConfig("alerts", { ...config.alerts, style })
                    }
                    style={{
                      padding: "10px 20px",
                      background:
                        config.alerts.style === style
                          ? "rgba(220,38,38,0.2)"
                          : "rgba(255,255,255,0.05)",
                      border: `1px solid ${config.alerts.style === style ? "rgba(220,38,38,0.5)" : "rgba(255,255,255,0.1)"}`,
                      borderRadius: "8px",
                      color: "#ffffff",
                      cursor: "pointer",
                      fontSize: "13px",
                      fontWeight: 500,
                      textTransform: "capitalize",
                    }}
                  >
                    {style === "popup" ? "🎉 " : style === "banner" ? "📢 " : "📌 "}
                    {style}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
                Animation
              </label>
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                {(["bounce", "slide", "fade", "zoom"] as const).map((anim) => (
                  <button
                    key={anim}
                    onClick={() =>
                      updateConfig("alerts", { ...config.alerts, animation: anim })
                    }
                    style={{
                      padding: "10px 20px",
                      background:
                        config.alerts.animation === anim
                          ? "rgba(220,38,38,0.2)"
                          : "rgba(255,255,255,0.05)",
                      border: `1px solid ${config.alerts.animation === anim ? "rgba(220,38,38,0.5)" : "rgba(255,255,255,0.1)"}`,
                      borderRadius: "8px",
                      color: "#ffffff",
                      cursor: "pointer",
                      fontSize: "13px",
                      fontWeight: 500,
                      textTransform: "capitalize",
                    }}
                  >
                    {anim}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div>
                <label style={{ display: "block", fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
                  Duration: {config.alerts.duration}s
                </label>
                <input
                  type="range"
                  min="2"
                  max="15"
                  value={config.alerts.duration}
                  onChange={(e) =>
                    updateConfig("alerts", {
                      ...config.alerts,
                      duration: parseInt(e.target.value),
                    })
                  }
                  style={rangeStyle}
                />
              </div>
              <div>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", marginTop: "24px" }}>
                  <input
                    type="checkbox"
                    checked={config.alerts.sound}
                    onChange={(e) =>
                      updateConfig("alerts", { ...config.alerts, sound: e.target.checked })
                    }
                    style={{ accentColor: "#ef4444" }}
                  />
                  <span style={{ fontSize: "13px" }}>Play Sound</span>
                </label>
              </div>
            </div>
          </>
        )}
      </Section>
    </div>
  );
}

// ============================================================================
// GREENROOM TAB
// ============================================================================

const waitingRoomBackgrounds = [
  { value: "linear-gradient(135deg, #0f0f23 0%, #1a0a2e 100%)", label: "Purple Night" },
  { value: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)", label: "Ocean Deep" },
  { value: "linear-gradient(180deg, #000000 0%, #1a0a0a 100%)", label: "Dark Red" },
  { value: "linear-gradient(135deg, #0a0a0a 0%, #1f1f1f 100%)", label: "Minimal Dark" },
  { value: "linear-gradient(135deg, #1a2a1a 0%, #0a1a0a 100%)", label: "Forest" },
];

const notifySounds = [
  { value: "chime", label: "🔔 Chime" },
  { value: "pop", label: "🎵 Pop" },
  { value: "ding", label: "✨ Ding" },
  { value: "knock", label: "🚪 Knock" },
  { value: "none", label: "🔇 None" },
];

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ position: "relative", display: "inline-block", width: "48px", height: "26px", cursor: "pointer" }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ opacity: 0, width: 0, height: 0 }}
      />
      <span
        style={{
          position: "absolute",
          inset: 0,
          background: checked ? "#22c55e" : "#374151",
          borderRadius: "26px",
          transition: "0.3s",
        }}
      >
        <span
          style={{
            position: "absolute",
            height: "20px",
            width: "20px",
            left: checked ? "24px" : "3px",
            bottom: "3px",
            background: "#ffffff",
            borderRadius: "50%",
            transition: "0.3s",
          }}
        />
      </span>
    </label>
  );
}

function GreenroomTab({
  config,
  updateConfig,
}: {
  config: RoomConfig;
  updateConfig: <K extends keyof RoomConfig>(key: K, value: RoomConfig[K]) => void;
}) {
  const [newVip, setNewVip] = useState("");
  const [newBlocked, setNewBlocked] = useState("");

  const gr = config.greenroom;

  const addVip = () => {
    if (newVip.trim() && !gr.vipList.includes(newVip.trim())) {
      updateConfig("greenroom", {
        ...gr,
        vipList: [...gr.vipList, newVip.trim()],
      });
      setNewVip("");
    }
  };

  const removeVip = (user: string) => {
    updateConfig("greenroom", {
      ...gr,
      vipList: gr.vipList.filter((u) => u !== user),
    });
  };

  const addBlocked = () => {
    if (newBlocked.trim() && !gr.blockedUsers.includes(newBlocked.trim())) {
      updateConfig("greenroom", {
        ...gr,
        blockedUsers: [...gr.blockedUsers, newBlocked.trim()],
      });
      setNewBlocked("");
    }
  };

  const removeBlocked = (user: string) => {
    updateConfig("greenroom", {
      ...gr,
      blockedUsers: gr.blockedUsers.filter((u) => u !== user),
    });
  };

  return (
    <div>
      <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "8px" }}>
        Greenroom Settings
      </h2>
      <p style={{ fontSize: "14px", color: "#9ca3af", marginBottom: "24px" }}>
        Configure your waiting room and guest management
      </p>

      {/* Enable/Disable toggle */}
      <Section title="Greenroom Status" description="Enable or disable the waiting room for guests">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            background: gr.enabled ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
            border: `1px solid ${gr.enabled ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
            borderRadius: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "28px" }}>{gr.enabled ? "🟢" : "🔴"}</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: "15px" }}>
                Greenroom is {gr.enabled ? "Enabled" : "Disabled"}
              </div>
              <div style={{ fontSize: "13px", color: "#9ca3af" }}>
                {gr.enabled
                  ? "Guests will wait for approval before joining"
                  : "Guests can join directly without approval"}
              </div>
            </div>
          </div>
          <button
            onClick={() => updateConfig("greenroom", { ...gr, enabled: !gr.enabled })}
            style={{
              padding: "10px 20px",
              background: gr.enabled
                ? "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)"
                : "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
              border: "none",
              borderRadius: "8px",
              color: "#ffffff",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 600,
            }}
          >
            {gr.enabled ? "Disable" : "Enable"}
          </button>
        </div>
      </Section>

      {gr.enabled && (
        <>
          {/* Guest Admission */}
          <Section title="Guest Admission" description="Control how guests are admitted to your stream">
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {[
                {
                  field: "requireApproval" as const,
                  label: "Require Approval",
                  desc: "Manually approve each guest before they join",
                },
                {
                  field: "autoAdmit" as const,
                  label: "Auto-Admit VIPs",
                  desc: "VIP users skip the waiting room",
                },
              ].map(({ field, label, desc }) => (
                <div
                  key={field}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "16px",
                    background: "rgba(0,0,0,0.3)",
                    borderRadius: "10px",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500, marginBottom: "4px" }}>{label}</div>
                    <div style={{ fontSize: "12px", color: "#9ca3af" }}>{desc}</div>
                  </div>
                  <Toggle
                    checked={gr[field]}
                    onChange={(v) => updateConfig("greenroom", { ...gr, [field]: v })}
                  />
                </div>
              ))}
            </div>
          </Section>

          {/* Waiting Room Appearance */}
          <Section title="Waiting Room Appearance" description="Customize how the waiting room looks to guests">
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
                Welcome Message
              </label>
              <textarea
                value={gr.waitingRoomMessage}
                onChange={(e) =>
                  updateConfig("greenroom", {
                    ...gr,
                    waitingRoomMessage: e.target.value,
                  })
                }
                placeholder="Please wait while the host reviews your request to join…"
                rows={3}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </div>

            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
                Background Theme
              </label>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(5, 1fr)",
                  gap: "10px",
                }}
              >
                {waitingRoomBackgrounds.map((bg, i) => (
                  <div
                    key={i}
                    onClick={() =>
                      updateConfig("greenroom", {
                        ...gr,
                        waitingRoomBackground: bg.value,
                      })
                    }
                    style={{
                      aspectRatio: "16/9",
                      borderRadius: "8px",
                      background: bg.value,
                      border:
                        gr.waitingRoomBackground === bg.value
                          ? "2px solid #ef4444"
                          : "2px solid rgba(255,255,255,0.1)",
                      cursor: "pointer",
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        padding: "4px",
                        background: "rgba(0,0,0,0.7)",
                        fontSize: "9px",
                        textAlign: "center",
                      }}
                    >
                      {bg.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
                Custom Instructions (shown to guests)
              </label>
              <textarea
                value={gr.customInstructions}
                onChange={(e) =>
                  updateConfig("greenroom", {
                    ...gr,
                    customInstructions: e.target.value,
                  })
                }
                placeholder="E.g., 'Please have your camera ready and ensure good lighting…'"
                rows={2}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </div>
          </Section>

          {/* VIP List */}
          <Section title="VIP List" description="Users who get auto-admitted or priority access">
            <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
              <input
                type="text"
                value={newVip}
                onChange={(e) => setNewVip(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addVip()}
                placeholder="Enter username or email"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                onClick={addVip}
                style={{
                  padding: "12px 20px",
                  background: "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
                  border: "none",
                  borderRadius: "10px",
                  color: "#ffffff",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                + Add VIP
              </button>
            </div>

            {gr.vipList.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {gr.vipList.map((user) => (
                  <div
                    key={user}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "8px 12px",
                      background: "rgba(34,197,94,0.1)",
                      border: "1px solid rgba(34,197,94,0.3)",
                      borderRadius: "20px",
                    }}
                  >
                    <span style={{ fontSize: "14px" }}>⭐</span>
                    <span style={{ fontSize: "13px" }}>{user}</span>
                    <button
                      onClick={() => removeVip(user)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#ef4444",
                        cursor: "pointer",
                        fontSize: "16px",
                        padding: "0 4px",
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div
                style={{
                  padding: "24px",
                  textAlign: "center",
                  background: "rgba(0,0,0,0.2)",
                  borderRadius: "10px",
                  border: "1px dashed rgba(255,255,255,0.1)",
                }}
              >
                <p style={{ fontSize: "13px", color: "#6b7280", margin: 0 }}>No VIPs added yet</p>
              </div>
            )}
          </Section>

          {/* Blocked Users */}
          <Section title="Blocked Users" description="Users who cannot join your stream">
            <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
              <input
                type="text"
                value={newBlocked}
                onChange={(e) => setNewBlocked(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addBlocked()}
                placeholder="Enter username or email to block"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                onClick={addBlocked}
                style={{
                  padding: "12px 20px",
                  background: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
                  border: "none",
                  borderRadius: "10px",
                  color: "#ffffff",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                🚫 Block
              </button>
            </div>

            {gr.blockedUsers.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {gr.blockedUsers.map((user) => (
                  <div
                    key={user}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "8px 12px",
                      background: "rgba(239,68,68,0.1)",
                      border: "1px solid rgba(239,68,68,0.3)",
                      borderRadius: "20px",
                    }}
                  >
                    <span style={{ fontSize: "14px" }}>🚫</span>
                    <span style={{ fontSize: "13px" }}>{user}</span>
                    <button
                      onClick={() => removeBlocked(user)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#ef4444",
                        cursor: "pointer",
                        fontSize: "16px",
                        padding: "0 4px",
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div
                style={{
                  padding: "24px",
                  textAlign: "center",
                  background: "rgba(0,0,0,0.2)",
                  borderRadius: "10px",
                  border: "1px dashed rgba(255,255,255,0.1)",
                }}
              >
                <p style={{ fontSize: "13px", color: "#6b7280", margin: 0 }}>No users blocked</p>
              </div>
            )}
          </Section>

          {/* Host Notifications */}
          <Section title="Host Notifications" description="Get notified when guests are waiting (stored locally)">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
              {[
                { field: "notifyOnJoin" as const, label: "🔔 Notify on Join", desc: "Alert when guest enters waiting room" },
                { field: "showGuestCount" as const, label: "👁️ Show Guest Count", desc: "Display waiting guests count" },
              ].map(({ field, label, desc }) => (
                <div
                  key={field}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "16px",
                    background: "rgba(0,0,0,0.3)",
                    borderRadius: "10px",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500, marginBottom: "4px" }}>{label}</div>
                    <div style={{ fontSize: "12px", color: "#9ca3af" }}>{desc}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={gr[field]}
                    onChange={(e) =>
                      updateConfig("greenroom", { ...gr, [field]: e.target.checked })
                    }
                    style={{ accentColor: "#ef4444", width: "20px", height: "20px" }}
                  />
                </div>
              ))}
            </div>

            <div>
              <label style={{ display: "block", fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
                Notification Sound
              </label>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                {notifySounds.map((sound) => (
                  <button
                    key={sound.value}
                    onClick={() =>
                      updateConfig("greenroom", { ...gr, notifySound: sound.value })
                    }
                    style={{
                      padding: "10px 16px",
                      background:
                        gr.notifySound === sound.value
                          ? "rgba(220,38,38,0.2)"
                          : "rgba(255,255,255,0.05)",
                      border: `1px solid ${gr.notifySound === sound.value ? "rgba(220,38,38,0.5)" : "rgba(255,255,255,0.1)"}`,
                      borderRadius: "8px",
                      color: "#ffffff",
                      cursor: "pointer",
                      fontSize: "13px",
                      fontWeight: 500,
                    }}
                  >
                    {sound.label}
                  </button>
                ))}
              </div>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
