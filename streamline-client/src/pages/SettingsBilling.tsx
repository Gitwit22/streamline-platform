


import React, { useEffect, useRef, useState } from "react";
import { PLAN_IDS, PlanId, isPlanId } from "../lib/planIds";
import { useLocation, useNavigate } from "react-router-dom";
import "./SettingsBilling.css";
import { S } from "./SettingsBilling.styles";
import SettingsDestinations from "./SettingsDestinations";
import { ApiUnauthorizedError, apiFetch, apiFetchAuth, clearAuthStorage, type RoomLayout, type RoomLayoutMode } from "../lib/api";
import { useAuthMe, isAuthUserInTestMode } from "../hooks/useAuthMe";
import { formatLimitLabel } from "../lib/entitlements";
import SettingsHlsSetup from "./settings/SettingsHlsSetup";
import { getMeCached, clearMeCache } from "../lib/meCache";
import { clearPlatformFlagsCache } from "../lib/platformFlagsCache";
import { isFeatureAvailable, isPlatformEnabled } from "../lib/featureAvailability";
import { getUsageGating, usageLabels, usageTooltips } from "../lib/usageLabels";

const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

async function apiFetchWithCookieFallback(path: string, init: RequestInit = {}) {
  try {
    return await apiFetchAuth(path, init);
  } catch (err: any) {
    // In cookie-auth setups (Admin flow), we may not have a localStorage JWT.
    // Fall back to cookie-based auth so test-mode plan switching works.
    if (err instanceof ApiUnauthorizedError) {
      return await apiFetch(path, init);
    }
    throw err;
  }
}

type RolePresetId = "participant" | "cohost";

type RolePresetDoc = {
  role: RolePresetId;
  // Publishing / presence controls (fixed sensible defaults; not exposed in UI)
  canPublishAudio: boolean;
  canPublishVideo: boolean;
  canScreenShare: boolean;
  tileVisible: boolean;
  // Access scopes (in-room gated UI)
  // NOTE: moderation powers are host-only and not driven by templates.
  canMuteGuests: boolean;
  canInviteLinks: boolean;
  canManageDestinations: boolean;
  canStartStopStream: boolean;
  canStartStopRecording: boolean;
  // Optional future scopes
  canViewAnalytics?: boolean;
  canChangeLayoutScene?: boolean;
  updatedAt?: number;
};

type RolePresetToggleKey =
  | "canScreenShare"
  | "canInviteLinks"
  | "canManageDestinations"
  | "canStartStopStream"
  | "canStartStopRecording"
  | "canChangeLayoutScene"
  | "canViewAnalytics";

const ROLE_PRESET_LABELS: Record<RolePresetId, string> = {
  participant: "Participant",
  cohost: "Co-host",
};

const ROLE_PRESET_GROUPS: Array<{ title: string; keys: Array<{ key: RolePresetToggleKey; label: string }> }> = [
  {
    title: "Core actions",
    keys: [
      { key: "canScreenShare", label: "Share Screen" },
      { key: "canInviteLinks", label: "Invite/Generate Links" },
    ],
  },
  {
    title: "Stream controls",
    keys: [
      { key: "canStartStopStream", label: "Start/Stop Stream" },
      { key: "canStartStopRecording", label: "Start/Stop Recording" },
      { key: "canManageDestinations", label: "Manage Destinations" },
      { key: "canChangeLayoutScene", label: "Change Layout/Scene" },
      { key: "canViewAnalytics", label: "View Analytics" },
    ],
  },
];

const EMPTY_PERMISSIONS = {
  canStream: false,
  canRecord: false,
  canDestinations: false,
  canModerate: false,
  canLayout: false,
  canScreenShare: false,
  canInvite: false,
  canAnalytics: false,
};

const PERMISSION_ITEMS = [{
  key: "canStream", label: "Start/Stop Stream",
}, { key: "canRecord", label: "Start/Stop Recording" }, { key: "canDestinations", label: "Manage Destinations" }, {
  key: "canModerate", label: "Mute/Kick Guests",
}, { key: "canLayout", label: "Change Layout/Scene" }, { key: "canScreenShare", label: "Share Screen" }, {
  key: "canInvite", label: "Invite/Generate Links",
}, { key: "canAnalytics", label: "View Analytics" }];
// Temporary fallback; canonical defaults come from the server.
const SIMPLE_ROLE_DEFAULTS = {
  participant: {
    label: "Participant",
    permissions: {
      canStream: false,
      canRecord: false,
      canDestinations: false,
      canModerate: false,
      canLayout: false,
      canScreenShare: false,
      canInvite: false,
      canAnalytics: false,
    },
  },
  cohost: {
    label: "Co-host",
    permissions: {
      canStream: true,
      canRecord: true,
      canDestinations: true,
      canModerate: false,
      canLayout: true,
      canScreenShare: true,
      canInvite: true,
      canAnalytics: false,
    },
    expiresHours: 24,
    maxUses: 1,
  },
};

const DEFAULT_ENTITLEMENTS = {
  planId: "free",
  planName: "Free",
  recording: false,
  dualRecording: false,
  rtmpMultistream: false,
  canHls: false,
  hlsCustomizationEnabled: false,
  maxGuests: 0,
  maxDestinations: 0,
  participantMinutes: 0,
  transcodeMinutes: 0,
};

const DEFAULT_USAGE = {
  inRoomMinutes: { used: 0, limit: 0, lifetime: 0 },
  broadcastMinutes: { used: 0, limit: 0, lifetime: 0 },
  recordingMinutes: { used: 0, lifetime: 0 },
  overages: { participantMinutes: 0, transcodeMinutes: 0 },
  rtmpDestinations: { used: 0, limit: 0 },
  storage: { used: 0, limit: 0 },
  projects: { used: 0, limit: 0 },
};

const DEFAULT_MEDIA_PREFS = {
  defaultPresetId: "standard_720p30",
  defaultLayout: "speaker" as "speaker" | "grid",
  defaultRoomLayout: { mode: "speaker" as RoomLayoutMode } as RoomLayout,
  defaultRecordingMode: "cloud" as "cloud" | "dual",
  destinationsDefaultMode: "last_used" as "last_used" | "pick_each_time",
  warnOnHighQuality: true,
  permissionsMode: "simple" as "simple" | "advanced",
};

type CheckoutPlanVariant = "starter_trial" | "starter_paid" | "basic" | "pro";

function checkoutVariantToPlanId(plan: CheckoutPlanVariant): PlanId {
  if (plan === "starter_paid" || plan === "starter_trial") return "starter";
  return plan;
}

function formatDate(input: any): string {
  if (!input) return "—";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function getDaysUntil(input: any): number {
  if (!input) return 0;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return 0;
  const diffMs = d.getTime() - Date.now();
  return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
}

function getStatusBadge(status: string | undefined, cancelAtPeriodEnd?: boolean) {
  if (!status || status === "none") {
    return { text: "Free", icon: "💸", color: "#6b7280", bg: "rgba(55,65,81,0.35)" };
  }
  if (status === "trialing") {
    return { text: "Trialing", icon: "🧪", color: "#22c55e", bg: "rgba(34,197,94,0.16)" };
  }
  if (status === "active") {
    if (cancelAtPeriodEnd) {
      return { text: "Canceling", icon: "⏳", color: "#f97316", bg: "rgba(245,158,11,0.16)" };
    }
    return { text: "Active", icon: "✅", color: "#22c55e", bg: "rgba(34,197,94,0.16)" };
  }
  if (status === "past_due" || status === "unpaid") {
    return { text: "Payment issue", icon: "⚠️", color: "#f97316", bg: "rgba(245,158,11,0.18)" };
  }
  if (status === "canceled") {
    return { text: "Canceled", icon: "⏹️", color: "#f97316", bg: "rgba(245,158,11,0.18)" };
  }
  return { text: status, icon: "ℹ️", color: "#6b7280", bg: "rgba(55,65,81,0.35)" };
}

function getPlanActionLabel(
  current: PlanId,
  target: PlanId,
  params: { isProcessing: boolean; pendingPlan?: string | null }
): string {
  const pendingPlan = String(params.pendingPlan || "").trim();

  // Only show "Pending" on the target plan, not every card.
  if (pendingPlan && target === (pendingPlan as any)) return "Pending change";

  if (params.isProcessing) return "Processing…";
  if (current === target) return "Current plan";
  const order: PlanId[] = ["free", "basic", "starter", "pro"];
  const curIdx = order.indexOf(current);
  const tgtIdx = order.indexOf(target);
  if (curIdx === -1 || tgtIdx === -1) return "Change plan";
  if (tgtIdx > curIdx) return "Upgrade";
  if (tgtIdx < curIdx) return "Downgrade";
  return "Change plan";
}

function checkoutPlanForResubscribe(user: any): CheckoutPlanVariant {
  const canonical = (user && (user.planId as string)) || "starter";
  if (canonical.includes("pro")) return "pro";
  if (canonical.includes("basic")) return "basic";
  if (canonical.includes("starter")) return "starter_paid";
  return "starter_paid";
}

export default function SettingsBilling() {
  const location = useLocation();
  const nav = useNavigate();
  const { user: authUser, refresh: refreshAuth } = useAuthMe();

  const isAdmin = Boolean((authUser as any)?.isAdmin);

  const [user, setUser] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Stripe can redirect back before webhooks apply the new plan.
  // BillingSuccess may navigate here with a hint so we can show a calm "processing" banner.
  const [upgradeProcessing, setUpgradeProcessing] = useState<boolean>(
    Boolean((location.state as any)?.upgradeProcessing)
  );

  // If we ever arrive here again with the flag set, re-enable the banner.
  useEffect(() => {
    if ((location.state as any)?.upgradeProcessing) {
      setUpgradeProcessing(true);
    }
  }, [location.state]);

  const [plans, setPlans] = useState<any[]>([]);
  const [entitlements, setEntitlements] = useState<typeof DEFAULT_ENTITLEMENTS>(DEFAULT_ENTITLEMENTS);
  const [usage, setUsage] = useState<typeof DEFAULT_USAGE | null>(null);

  const [platformHlsEnabled, setPlatformHlsEnabled] = useState<boolean>(true);
  const [platformTranscodeEnabled, setPlatformTranscodeEnabled] = useState<boolean>(true);
  const [platformHlsSettingsTabEnabled, setPlatformHlsSettingsTabEnabled] = useState<boolean>(true);
  const [platformRecordingEnabled, setPlatformRecordingEnabled] = useState<boolean>(true);

  const [mediaPrefs, setMediaPrefs] = useState<typeof DEFAULT_MEDIA_PREFS>(DEFAULT_MEDIA_PREFS);
  const [presetOptions, setPresetOptions] = useState<Array<{ id: string; label: string }>>([]);

  const [advancedPermissions, setAdvancedPermissions] = useState<{
    enabled: boolean;
    plan: boolean;
    override: boolean;
    globalLock: boolean;
    lockReason: string | null;
    effectivePermissionsMode: "simple" | "advanced";
    permissionsModeLockReason: string | null;
  }>(
    {
      enabled: false,
      plan: false,
      override: false,
      globalLock: false,
      lockReason: null,
      effectivePermissionsMode: "simple",
      permissionsModeLockReason: null,
    }
  );

  const [cohostProfile, setCohostProfile] = useState<any>({
    label: SIMPLE_ROLE_DEFAULTS.cohost.label,
    expiresHours: SIMPLE_ROLE_DEFAULTS.cohost.expiresHours || 24,
    maxUses: SIMPLE_ROLE_DEFAULTS.cohost.maxUses || 1,
    ...SIMPLE_ROLE_DEFAULTS.cohost.permissions,
  });
  const [cohostSaving, setCohostSaving] = useState(false);
  const [cohostMessage, setCohostMessage] = useState<string | null>(null);

  const [serverDefaultRoleProfiles, setServerDefaultRoleProfiles] = useState<any[] | null>(null);
  const [roleProfiles, setRoleProfiles] = useState<any[]>([]);
  const [rolePresets, setRolePresets] = useState<Record<RolePresetId, RolePresetDoc> | null>(null);
  const [rolePresetsSaving, setRolePresetsSaving] = useState<Record<RolePresetId, "idle" | "saving" | "saved" | "error">>({
    participant: "idle",
    cohost: "idle",
  });
  const [quickRoleIds, setQuickRoleIds] = useState<string[]>(["participant", "cohost"]);
  const [roleLabelInput, setRoleLabelInput] = useState("");
  const [roleMessage, setRoleMessage] = useState<string | null>(null);
  const [roleSaveStatus, setRoleSaveStatus] = useState<Record<string, "idle" | "saving" | "saved" | "error">>({});
  const roleSaveTimersRef = useRef<Record<string, number | undefined>>({});
  const cohostProfileSaveTimerRef = useRef<number | null>(null);

  const [mediaPrefsSaving, setMediaPrefsSaving] = useState(false);
  const [mediaPrefsMessage, setMediaPrefsMessage] = useState<string | null>(null);
  const [mediaPrefsError, setMediaPrefsError] = useState<string | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  const [emergencyLoading, setEmergencyLoading] = useState(false);
  const [emergencyMessage, setEmergencyMessage] = useState<string | null>(null);
  const [emergencyExpiresAtMs, setEmergencyExpiresAtMs] = useState<number | null>(null);
  const [emergencyCountdown, setEmergencyCountdown] = useState<string | null>(null);

  const [actionLoading, setActionLoading] = useState<CheckoutPlanVariant | "portal" | null>(null);

  const [checkoutTosAccepted, setCheckoutTosAccepted] = useState(false);
  const [checkoutTosError, setCheckoutTosError] = useState<string | null>(null);
  const [checkoutTosSubmitting, setCheckoutTosSubmitting] = useState(false);

  const [testModeTargetPlan, setTestModeTargetPlan] = useState<PlanId | null>(null);
  const [testModeSummary, setTestModeSummary] = useState<string | null>(null);
  const [testModeModalOpen, setTestModeModalOpen] = useState(false);
  const [testModeLoading, setTestModeLoading] = useState(false);

  const [showManagePicker, setShowManagePicker] = useState(false);
  const [showLifetimeDetails, setShowLifetimeDetails] = useState(false);

  const [overagesToggleSaving, setOveragesToggleSaving] = useState(false);
  const [overagesToggleMessage, setOveragesToggleMessage] = useState<string | null>(null);

  const [billingStatusSnapshot, setBillingStatusSnapshot] = useState<any | null>(null);

  const [closeCancelLoading, setCloseCancelLoading] = useState(false);
  const [closeDeleteLoading, setCloseDeleteLoading] = useState(false);
  const [closeDeleteConfirmed, setCloseDeleteConfirmed] = useState(false);
  const [closeDeleteText, setCloseDeleteText] = useState("");

  const [activeTab, setActiveTab] = useState<"plan" | "usage" | "destinations" | "hls" | "defaults" | "roles" | "close">("plan");

  // If a platform-wide feature is disabled, avoid landing on a hidden tab.
  useEffect(() => {
    if (activeTab === "destinations" && platformTranscodeEnabled === false) {
      setActiveTab("plan");
    }
    if (activeTab === "hls" && platformHlsSettingsTabEnabled === false) {
      setActiveTab("plan");
    }
  }, [activeTab, platformTranscodeEnabled, platformHlsSettingsTabEnabled]);

  const simpleMode = advancedPermissions.effectivePermissionsMode !== "advanced";

  const formatEmergencyCountdown = (msRemaining: number): string => {
    if (!Number.isFinite(msRemaining) || msRemaining <= 0) return "0m";
    const totalMinutes = Math.ceil(msRemaining / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours <= 0) return `${minutes}m`;
    return `${hours}h ${minutes}m`;
  };

  useEffect(() => {
    if (!emergencyExpiresAtMs) {
      setEmergencyCountdown(null);
      return;
    }

    const tick = () => {
      const diff = emergencyExpiresAtMs - Date.now();
      setEmergencyCountdown(formatEmergencyCountdown(diff));
    };

    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [emergencyExpiresAtMs]);

  useEffect(() => {
    if (activeTab !== "usage") return;

    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetchAuth("/api/recordings/emergency-status", { cache: "no-store" }, { allowNonOk: true });
        if (!res.ok) return;
        const { json } = await safeReadJson(res);
        const expiresAt = (json as any)?.data?.expiresAt;
        if (cancelled) return;
        if (typeof expiresAt === "string" && expiresAt) {
          const ms = Date.parse(expiresAt);
          setEmergencyExpiresAtMs(Number.isFinite(ms) ? ms : null);
        } else {
          setEmergencyExpiresAtMs(null);
        }
      } catch {
        // Silent: countdown is non-critical UI.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  // If billing is active or trialing, ensure pendingPlan is cleared to avoid stuck UI
  useEffect(() => {
    if (!user) return;
    const scheduled = (user as any)?.scheduledPlanChange;
    const hasFutureScheduledDowngrade =
      scheduled &&
      scheduled.type === "downgrade" &&
      typeof scheduled.effectiveAtMs === "number" &&
      scheduled.effectiveAtMs > Date.now();

    if (!hasFutureScheduledDowngrade && (user.billingStatus === "active" || user.billingStatus === "trialing") && user.pendingPlan) {
      setUser((prev: any) => (prev ? { ...prev, pendingPlan: null } : prev));
    }
  }, [user?.billingStatus, user?.pendingPlan, (user as any)?.scheduledPlanChange?.effectiveAtMs, (user as any)?.scheduledPlanChange?.type]);

  // Reset transient actionLoading when page regains visibility (e.g., returning from Stripe)
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        setActionLoading(null);
      }
    };
    const onPageShow = () => {
      setActionLoading(null);
      loadAllData();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  const loadAllData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Ensure we have a baseline user object before applying entitlements/TOS metadata
      await loadUser();

      await Promise.all([
        loadPlans(),
        loadUsage(),
        loadEntitlements(),
        loadBillingStatus(),
        loadMediaPrefs(),
        loadCohostProfile(),
        loadRolePresets(),
      ]);
    } catch (err: any) {
      setError(err?.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  const finalizeBillingAfterPlanChange = async (params?: {
    expectedPlanId?: PlanId;
    expectedDowngradeScheduled?: boolean;
    maxPollAttempts?: number;
    pollIntervalMs?: number;
  }) => {
    const maxAttempts = Math.max(1, Math.min(5, params?.maxPollAttempts ?? 5));
    const intervalMs = Math.max(400, Math.min(4000, params?.pollIntervalMs ?? 1200));

    const shouldStop = (me: any | null) => {
      if (!me) return false;

      if (params?.expectedPlanId) {
        const planId = canonicalPlanId(me?.effectiveEntitlements?.planId ?? me?.planId);
        if (planId === params.expectedPlanId) return true;
      }

      if (params?.expectedDowngradeScheduled) {
        const scheduled = (me as any)?.scheduledPlanChange;
        const ok =
          scheduled &&
          scheduled.type === "downgrade" &&
          typeof scheduled.effectiveAtMs === "number" &&
          scheduled.effectiveAtMs > Date.now();
        if (ok) return true;
      }

      // If we don't know what to expect, just do a single refresh pass.
      if (!params?.expectedPlanId && !params?.expectedDowngradeScheduled) return true;

      return false;
    };

    // Make sure any in-memory cache is invalidated first.
    clearMeCache();

    // Kick Stripe->DB reconciliation; ignore failures (user may still get updated via webhooks).
    try {
      await apiFetchWithCookieFallback("/api/billing/refresh", { method: "POST" });
    } catch {
      // ignore
    }

    // Force-refresh the local sources of truth the page actually reads.
    try {
      await refreshAuth();
    } catch {
      // ignore
    }

    let me: any | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        me = await loadUser({ forceRefresh: true });
      } catch {
        me = null;
      }

      try {
        await Promise.all([loadEntitlements(), loadUsage(), loadBillingStatus()]);
      } catch {
        // ignore
      }

      if (shouldStop(me)) return me;
      await new Promise((r) => window.setTimeout(r, intervalMs));
    }

    return me;
  };

  const handleRefreshStatus = async () => {
    try {
      // Try to reconcile Stripe -> Firestore (self-heals when webhooks lag/miss)
      const res = await apiFetchWithCookieFallback("/api/billing/refresh", { method: "POST" });
      const { json } = await safeReadJson(res);
      const changed = Boolean((json as any)?.changed);
      if (res.ok) {
        showToast(changed ? "Status refreshed." : "No changes found.");
      }
      clearMeCache();
    } catch {
      // ignore; still allow the user to refresh local state
    }
    await loadAllData();
  };

  // Post-Stripe return polish: if we land here with a processing hint, auto-sync
  // plan state so the page feels instant once webhooks/refresh apply.
  useEffect(() => {
    if (!upgradeProcessing) return;

    let cancelled = false;

    (async () => {
      const expectedFromState = (location.state as any)?.expectedPlanId;
      const expectedPlanId: PlanId | undefined = isPlanId(expectedFromState)
        ? (expectedFromState as PlanId)
        : "pro";

      await finalizeBillingAfterPlanChange({ expectedPlanId, maxPollAttempts: 5, pollIntervalMs: 1200 });

      if (cancelled) return;

      setUpgradeProcessing(false);
      try {
        // Remove the router state so refresh doesn't keep the banner.
        nav(location.pathname, { replace: true, state: {} });
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [upgradeProcessing, location.pathname, location.state, nav]);

  useEffect(() => {
    loadAllData();
  }, []);

  const loadUser = async (opts?: { forceRefresh?: boolean }): Promise<any | null> => {
    try {
      if (opts?.forceRefresh) {
        clearMeCache();
      }

      const data = await getMeCached();
      setUser(data);
      try {
        if (data) {
          window.localStorage.setItem("sl_user", JSON.stringify(data));
          if ((data as any)?.id || (data as any)?.uid) {
            window.localStorage.setItem("sl_userId", String((data as any).id || (data as any).uid));
          }
        }
      } catch {}
      return data;
    } catch (err: any) {
      if (err?.status === 401 || err?.status === 403) {
        clearAuthStorage();
        setUser(null);
      }
      throw err;
    }
  };

  const loadBillingStatus = async () => {
    try {
      const res = await apiFetchWithCookieFallback("/api/billing/status", { method: "GET" });
      const { json } = await safeReadJson(res);
      if (!res.ok) return;
      if ((json as any)?.success) {
        setBillingStatusSnapshot(json);
      }
    } catch {
      // Non-critical UI. Billing page should still work without this.
    }
  };

  const loadPlans = async () => {
    try {
      // Avoid any intermediate caching; plans must reflect admin edits quickly.
      const bust = Date.now();
      const res = await apiFetchAuth(`${API_BASE}/api/plans?ts=${bust}`, { cache: "no-store" }, { allowNonOk: true });
      if (res.ok) {
        const data = await res.json();
        console.log("[SettingsBilling] /api/plans response:", data);

        // Keep platform flags consistent with the same source as the plan grid.
        // Default semantics: enabled when missing.
        try {
          const pf = (data as any)?.platformFlags || {};
          setPlatformHlsEnabled(isPlatformEnabled(pf.hlsEnabled));
          setPlatformRecordingEnabled(isPlatformEnabled(pf.recordingEnabled));
          setPlatformTranscodeEnabled(isPlatformEnabled(pf.transcodeEnabled));
          const hlsTabFlag =
            typeof pf.hlsSettingsTab === "boolean"
              ? pf.hlsSettingsTab
              : typeof pf.hlsEnabled === "boolean"
                ? pf.hlsEnabled
                : true;
          setPlatformHlsSettingsTabEnabled(hlsTabFlag);
        } catch {
          setPlatformHlsEnabled(true);
          setPlatformRecordingEnabled(true);
          setPlatformTranscodeEnabled(true);
          setPlatformHlsSettingsTabEnabled(true);
        }

        if (Array.isArray(data.plans) && data.plans.length) {
          // Only use plans with visibility: 'public' (backend should already filter, but double-check)
          const visiblePlans = data.plans.filter((p: any) => p.visibility === "public");
          // If none are public, still use the fetched plans to avoid falling back to stale defaults
          const source = visiblePlans.length ? visiblePlans : data.plans;
          const sorted = source.slice().sort((a: any, b: any) => Number(a.price ?? 0) - Number(b.price ?? 0));
          setPlans(sorted);
        }
      }
    } catch {
      setPlans([]);
    }
  };

  const loadEntitlements = async () => {
    try {
      // Prefer canonical effectiveEntitlements from /api/account/me
      const data = await getMeCached();

      // NOTE: platform-wide flags are sourced from /api/plans to keep the plan grid
      // 100% server-driven and to avoid stale cached values from /api/account/me.

      // Capture Terms of Service metadata for display and gating.
      setUser((prev) =>
        prev
          ? {
              ...prev,
              tosVersion: (data as any)?.tosVersion ?? null,
              tosAcceptedAt: (data as any)?.tosAcceptedAt ?? null,
              currentTosVersion: (data as any)?.currentTosVersion ?? null,
            }
          : prev
      );

      const eff = (data as any)?.effectiveEntitlements;

      if (eff && typeof eff === "object") {
        const features = eff.features || {};
        const limits = eff.limits || {};

        // Canonical RTMP destinations cap comes from rtmpDestinationsMax
        // on the normalized plan limits; fall back to any legacy
        // maxDestinations field if present.
        const maxDestinations = Number(
          (limits as any).rtmpDestinationsMax ??
            (limits as any).maxDestinations ??
            0
        );

        const canHls = Boolean((features as any).hls ?? (features as any).hlsEnabled ?? (features as any).canHls);
        const hlsCustomizationEnabled = (() => {
          const explicit = (features as any).hlsCustomizationEnabled;
          if (typeof explicit === "boolean") return explicit;
          const legacy = (features as any).canCustomizeHlsPage;
          if (typeof legacy === "boolean") return legacy;
          return canHls;
        })();

        setEntitlements({
          planId: eff.planId || data.planId || "free",
          planName: eff.planName || data.planId || eff.planId || "Free",
          recording: !!features.recording,
          dualRecording: !!features.dualRecording,
          // Treat "multistream" as "more than 1 RTMP destination" so
          // a cap of 1 is a valid single-destination plan.
          rtmpMultistream: maxDestinations > 1,
          canHls,
          hlsCustomizationEnabled,
          maxGuests: Number(limits.maxGuests ?? 0),
          maxDestinations,
          participantMinutes: Number((limits as any).participantMinutes ?? 0),
          transcodeMinutes: Number(limits.transcodeMinutes ?? 0),
        });
        return;
      }

      // Fallback: legacy usage entitlements endpoint
      const legacyRes = await apiFetchAuth("/api/usage/entitlements", {}, { allowNonOk: true });
      if (!legacyRes.ok) throw new Error("usage/entitlements failed");
      const legacy = await legacyRes.json();
      setEntitlements({
        planId: legacy?.planId || "free",
        planName: legacy?.planName || legacy?.planId || "Free",
        recording: !!legacy?.recording,
        dualRecording: !!legacy?.dualRecording,
        rtmpMultistream: !!legacy?.rtmpMultistream,
        canHls: !!legacy?.canHls,
        hlsCustomizationEnabled: !!legacy?.canHls,
        maxGuests: Number(legacy?.maxGuests ?? 0),
        maxDestinations: Number(legacy?.maxDestinations ?? 0),
        participantMinutes: Number(legacy?.participantMinutes ?? 0),
        transcodeMinutes: Number(legacy?.transcodeMinutes ?? 0),
      });
    } catch (err) {
      console.warn("loadEntitlements failed; using defaults", err);
      setEntitlements((prev) => prev || DEFAULT_ENTITLEMENTS);
      setPlatformHlsEnabled(true);
      setPlatformTranscodeEnabled(true);
    }
  };

 
  const loadUsage = async () => {
    try {
      const res = await apiFetchAuth("/api/usage/me");
      const data = await res.json();
      const limits = data?.plan?.limits || {};

      const usageMonthly = data?.usageMonthly || {};
      const usageInner = usageMonthly.usage || {};
      const overages = usageMonthly.overages || {};
      const usageWrapper = data?.usage || {};
      const usageMinutes = usageWrapper.minutes || usageInner.minutes || {};
      const ytdMinutes = usageMonthly?.ytd?.minutes || {};
      // Fallback to legacy hours on user.usage if monthly doc not present
      const legacyHours = Number(data?.user?.usage?.hoursStreamedThisMonth || 0);
      const legacyMinutes = Math.max(0, Math.round(legacyHours * 60));
      const participantUsed = Number(usageMonthly.participantMinutes ?? usageInner.participantMinutes ?? legacyMinutes ?? 0);
      const transcodeUsed = Number(usageMonthly.transcodeMinutes ?? usageInner.transcodeMinutes ?? 0);

      const inRoomCurrent = Number(usageMinutes.inRoom?.currentPeriod ?? participantUsed);
      const inRoomLifetime = Number(
        usageMinutes.inRoom?.lifetime ??
          ytdMinutes.inRoom?.lifetime ??
          usageMonthly?.ytd?.participantMinutes ??
          participantUsed
      );

      const broadcastCurrent = Number(usageMinutes.broadcast?.currentPeriod ?? usageMinutes.transcode?.currentPeriod ?? transcodeUsed);
      const broadcastLifetime = Number(
        usageMinutes.broadcast?.lifetime ??
          usageMinutes.transcode?.lifetime ??
          ytdMinutes.broadcast?.lifetime ??
          ytdMinutes.transcode?.lifetime ??
          usageMonthly?.ytd?.transcodeMinutes ??
          0
      );
      const recordingCurrent = Number(
        usageMinutes.recording?.currentPeriod ?? usageInner.minutes?.recording?.currentPeriod ?? 0
      );
      const recordingLifetime = Number(
        usageMinutes.recording?.lifetime ??
        ytdMinutes?.recording?.lifetime ??
        usageInner.minutes?.recording?.lifetime ??
        0
      );

      setUsage({
        inRoomMinutes: {
          used: inRoomCurrent,
          limit: Number(limits.participantMinutes ?? 0) || (data?.plan?.id === "pro" ? 1200 : data?.plan?.id === "starter" ? 300 : 60),
          lifetime: inRoomLifetime,
        },
        broadcastMinutes: {
          used: broadcastCurrent,
          limit: Number(limits.transcodeMinutes ?? 0),
          lifetime: broadcastLifetime,
        },
        recordingMinutes: {
          used: recordingCurrent,
          lifetime: recordingLifetime,
        },
        overages: {
          participantMinutes: Number(overages.participantMinutes ?? 0),
          transcodeMinutes: Number(overages.transcodeMinutes ?? 0),
        },
        rtmpDestinations: {
          used: 0,
          // Destination caps are resolved on the server; 0 = "no numeric cap".
          limit: Number(limits.maxDestinations ?? 0),
        },
        storage: {
          used: 0,
          limit: Number(limits.storageGB ?? 0) || (data?.plan?.id === "pro" ? 100 : data?.plan?.id === "starter" ? 10 : 1),
        },
        projects: {
          used: 0,
          limit: Number(limits.maxProjects ?? 0) || (data?.plan?.id === "pro" ? 50 : data?.plan?.id === "starter" ? 5 : 1),
        },
      });
    } catch (err) {
      console.warn("loadUsage failed; using defaults", err);
      setUsage(DEFAULT_USAGE);
    }
  };

  const loadMediaPrefs = async () => {
    try {
      const [presetsRes, me] = await Promise.all([
        apiFetchAuth(`${API_BASE}/api/account/presets`, {}, { allowNonOk: true }),
        getMeCached(),
      ]);

      let availablePresets: Array<{ id: string; label: string }> = [{ id: "standard_720p30", label: "Standard (720p30)" }];

      if (presetsRes.ok) {
        try {
          const payload = await presetsRes.json();
          const list = Array.isArray(payload?.presets) ? payload.presets : [];
          if (list.length) {
            availablePresets = list.map((p: any) => ({ id: p.id, label: p.label }));
          }
        } catch (err) {
          console.error("Failed to parse presets", err);
        }
      }

      if (me) {
        try {
          const prefs = me?.mediaPrefs ? { ...DEFAULT_MEDIA_PREFS, ...me.mediaPrefs } : DEFAULT_MEDIA_PREFS;
          const adv = me?.advancedPermissions || { enabled: false, plan: false, override: false, global: false, lockReason: me?.advancedPermissionsLockedReason };
          const lockReason = adv.lockReason || me?.advancedPermissionsLockedReason || null;
          // Treat "coming_soon" as a soft label only; do not block enabling Advanced mode.
          const advEnabled = !!(adv.enabled || lockReason === "coming_soon");
          setAdvancedPermissions({
            enabled: advEnabled,
            plan: !!adv.plan,
            override: !!adv.override,
            globalLock: !!adv.global,
            lockReason,
            effectivePermissionsMode: me?.effectivePermissionsMode || (advEnabled && prefs.permissionsMode === "advanced" ? "advanced" : "simple"),
            permissionsModeLockReason: me?.permissionsModeLockReason || null,
          });

          // Filter presets client-side to the plan cap so the dropdown doesn't show locked options.
          if (me?.planId) {
            const order = ["standard_720p30", "hd_1080p30", "sports_1080p60", "pro_1440p30", "ultra_4k30"];
            const planMax: Record<string, string> = {
              free: "hd_1080p30",
              starter: "hd_1080p30",
              basic: "hd_1080p30",
              pro: "sports_1080p60",
              enterprise: "ultra_4k30",
              internal_unlimited: "ultra_4k30",
            };
            const maxId = planMax[me.planId] || planMax.free;
            const maxIdx = order.indexOf(maxId);
            const filtered = availablePresets.filter((p) => order.indexOf(p.id) <= maxIdx || maxIdx === -1);
            setPresetOptions(filtered.length ? filtered : availablePresets);
          } else {
            setPresetOptions(availablePresets);
          }

          setMediaPrefs(prefs);
          if (Array.isArray(me?.defaultRoleProfiles)) {
            setServerDefaultRoleProfiles(me.defaultRoleProfiles);
          }
        } catch (err) {
          console.error("Failed to apply /account/me media prefs", err);
          setMediaPrefs(DEFAULT_MEDIA_PREFS);
          setPresetOptions(availablePresets);
          setAdvancedPermissions({ enabled: false, plan: false, override: false, globalLock: false, lockReason: null, effectivePermissionsMode: "simple", permissionsModeLockReason: null });
        }
      } else {
        setMediaPrefs(DEFAULT_MEDIA_PREFS);
        setPresetOptions(availablePresets);
        setAdvancedPermissions({ enabled: false, plan: false, override: false, globalLock: false, lockReason: null, effectivePermissionsMode: "simple", permissionsModeLockReason: null });
      }
    } catch (err) {
      console.error("loadMediaPrefs failed", err);
      setPresetOptions((prev) => prev.length ? prev : [{ id: "standard_720p30", label: "Standard (720p30)" }]);
      setMediaPrefs(DEFAULT_MEDIA_PREFS);
    }
  };

  const loadCohostProfile = async () => {
    try {
      const res = await apiFetchAuth(`${API_BASE}/api/account/cohost-profile`, {}, { allowNonOk: true });
      if (!res.ok) throw new Error("cohost profile endpoint failed");
      const data = await res.json();
      if (data?.profile) {
        setCohostProfile((prev) => ({ ...prev, ...data.profile }));
      }
    } catch (err) {
      console.warn("loadCohostProfile failed; using defaults", err);
    }
  };

  const loadRolePresets = async () => {
    try {
      const res = await apiFetchAuth(`${API_BASE}/api/account/role-presets`, {}, { allowNonOk: true });
      if (!res.ok) throw new Error("role-presets endpoint failed");
      const data = await res.json();
      if (data?.presets) {
        const p = data.presets as any;
        const next: Record<RolePresetId, RolePresetDoc> = {
          participant: p.participant,
          cohost: p.cohost,
        };
        setRolePresets(next);
      }
    } catch (err) {
      console.warn("loadRolePresets failed", err);
      setRolePresets(null);
    }
  };

  const applySimpleRoleDefaults = () => {
    const source = serverDefaultRoleProfiles ?? null;
    const ensureDefaults = (id: string) => {
      const fromServer = source?.find((p) => p.id === id);
      if (fromServer) {
        return {
          label: fromServer.name,
          permissions: fromServer.permissions,
        };
      }
      const key = id as keyof typeof SIMPLE_ROLE_DEFAULTS;
      return SIMPLE_ROLE_DEFAULTS[key];
    };

    const simpleList = ["participant", "cohost"].map((key) => {
      const def = ensureDefaults(key);
      return {
        id: key,
        label: def.label,
        system: true,
        lockedName: true,
        permissions: def.permissions,
      };
    });
    setRoleProfiles(simpleList);
    setQuickRoleIds(["participant", "cohost"]);
  };

  const saveCohostProfile = async () => {
    setCohostSaving(true);
    setCohostMessage(null);
    try {
      const res = await apiFetchAuth(
        `${API_BASE}/api/account/cohost-profile`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cohostProfile),
        },
        { allowNonOk: true }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to save co-host defaults");
      }
      const data = await res.json();
      if (data?.profile) setCohostProfile(data.profile);
      setCohostMessage("Co-host defaults saved");
      setTimeout(() => setCohostMessage(null), 2200);
    } catch (err: any) {
      setError(err?.message || "Failed to save co-host defaults");
    } finally {
      setCohostSaving(false);
    }
  };

  const saveCohostProfileWith = async (next: any) => {
    setCohostSaving(true);
    setCohostMessage(null);
    try {
      const res = await apiFetchAuth(
        `${API_BASE}/api/account/cohost-profile`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        },
        { allowNonOk: true }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to save co-host defaults");
      }
      const data = await res.json();
      if (data?.profile) setCohostProfile(data.profile);
      setCohostMessage("Co-host defaults saved");
      setTimeout(() => setCohostMessage(null), 2200);
    } catch (err: any) {
      setError(err?.message || "Failed to save co-host defaults");
    } finally {
      setCohostSaving(false);
    }
  };

  const saveRolePreset = async (presetId: RolePresetId, patch: Partial<RolePresetDoc>) => {
    setRolePresetsSaving((prev) => ({ ...prev, [presetId]: "saving" }));
    try {
      const res = await apiFetchAuth(
        `${API_BASE}/api/account/role-presets/${presetId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
        { allowNonOk: true }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || (data as any)?.error) {
        throw new Error(((data as any)?.error as string) || "Failed to update role defaults");
      }
      if (data?.preset && rolePresets) {
        setRolePresets({ ...rolePresets, [presetId]: data.preset as RolePresetDoc });
      } else {
        // Fallback: just merge the patch locally.
        setRolePresets((prev) =>
          prev
            ? {
                ...prev,
                [presetId]: { ...(prev[presetId] as RolePresetDoc), ...(patch as any) },
              }
            : prev,
        );
      }
      setRolePresetsSaving((prev) => ({ ...prev, [presetId]: "saved" }));
      window.setTimeout(() => {
        setRolePresetsSaving((prev) => ({ ...prev, [presetId]: "idle" }));
      }, 1500);
    } catch (err: any) {
      setRolePresetsSaving((prev) => ({ ...prev, [presetId]: "error" }));
      setError(err?.message || "Failed to update role defaults");
    }
  };

  // Advanced Permissions mode is now controlled server-side; the settings
  // UI only exposes simple role defaults (participant/co-host templates).

  const saveMediaPrefs = async () => {
    setMediaPrefsSaving(true);
    setMediaPrefsMessage(null);
    setMediaPrefsError(null);
    try {
      const roomMode = (mediaPrefs as any)?.defaultRoomLayout?.mode;
      const derivedDefaultLayout: "speaker" | "grid" =
        roomMode === "grid" || roomMode === "carousel" ? "grid" : "speaker";

      const payload = {
        ...mediaPrefs,
        // Single mental model: destinations reuse last-used automatically.
        destinationsDefaultMode: "last_used" as const,
        // Keep legacy composite layout in sync for older callers.
        defaultLayout: derivedDefaultLayout,
      };

      const res = await apiFetchAuth(
        `${API_BASE}/api/account/media-prefs`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        { allowNonOk: true }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to save media preferences");
      }
      const data = await res.json();
      const prefs = data?.mediaPrefs ? { ...DEFAULT_MEDIA_PREFS, ...data.mediaPrefs } : mediaPrefs;
      setMediaPrefs(prefs);
      setMediaPrefsMessage("Defaults saved");
    } catch (err: any) {
      const msg = err?.message || "Failed to save media preferences";
      setMediaPrefsError(msg);
    } finally {
      setMediaPrefsSaving(false);
    }
  };

  const safeReadJson = async (res: Response) => {
    const text = await res.text().catch(() => "");
    try {
      return { json: text ? JSON.parse(text) : null, text };
    } catch {
      return { json: null, text };
    }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3000);
  };

  const setOveragesEnabled = async (nextEnabled: boolean) => {
    setOveragesToggleSaving(true);
    setOveragesToggleMessage(null);

    const prevEnabled = Boolean((user as any)?.billingSettings?.overagesEnabled);

    // Optimistic UI (will be corrected by /me refetch).
    setUser((prev: any) =>
      prev
        ? {
            ...prev,
            billingSettings: {
              ...(prev.billingSettings || {}),
              overagesEnabled: nextEnabled,
            },
          }
        : prev
    );

    try {
      const res = await apiFetchWithCookieFallback("/api/billing/overages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled }),
      });

      const { json, text } = await safeReadJson(res);

      if (!res.ok) {
        const err = String((json as any)?.error || "").trim();
        if (res.status === 409 && err === "payment_method_required") {
          setOveragesToggleMessage("Add a default payment method to enable overages.");

          // Ensure toggle stays OFF.
          setUser((prev: any) =>
            prev
              ? {
                  ...prev,
                  billingSettings: {
                    ...(prev.billingSettings || {}),
                    overagesEnabled: false,
                  },
                }
              : prev
          );
        } else if (res.status === 403 && err === "overages_not_allowed") {
          setOveragesToggleMessage(null);
        } else {
          setOveragesToggleMessage(
            (text && text.length < 140 ? text : null) || "Could not update overages. Please try again."
          );
        }
      } else {
        showToast(nextEnabled ? "Overages enabled" : "Overages disabled");
      }
    } catch (err: any) {
      setOveragesToggleMessage(err?.message || "Could not update overages. Please try again.");

      // Revert optimistic state if we couldn't reach the server.
      setUser((prev: any) =>
        prev
          ? {
              ...prev,
              billingSettings: {
                ...(prev.billingSettings || {}),
                overagesEnabled: prevEnabled,
              },
            }
          : prev
      );
    } finally {
      // Always refresh /me so UI matches server truth.
      try {
        clearMeCache();
        await loadUser({ forceRefresh: true });
      } catch {
        // ignore
      }
      setOveragesToggleSaving(false);
    }
  };

  const scheduleCohostProfileSave = (nextProfile: any) => {
    if (cohostProfileSaveTimerRef.current) {
      window.clearTimeout(cohostProfileSaveTimerRef.current);
    }
    setCohostSaving(true);
    setCohostMessage("Saving…");
    cohostProfileSaveTimerRef.current = window.setTimeout(async () => {
      try {
        await saveCohostProfileWith(nextProfile);
        setCohostSaving(false);
        setCohostMessage("Saved");
        window.setTimeout(() => setCohostMessage(null), 1800);
      } catch (err: any) {
        setCohostSaving(false);
        setCohostMessage("Couldn't save — retry");
        setError(err?.message || "Failed to save co-host defaults");
      }
    }, 700);
  };

  const handleEmergencyDownload = async () => {
    try {
      setEmergencyLoading(true);
      setEmergencyMessage(null);

      let res: Response;
      try {
        res = await apiFetchAuth("/api/recordings/emergency-latest", { cache: "no-store" }, { allowNonOk: true });
      } catch (err) {
        console.error("Emergency download failed (network)", err);
        setEmergencyMessage("Network error. Check your connection and try again.");
        return;
      }

      const { json, text } = await safeReadJson(res);

      if (res.status === 410) {
        setEmergencyExpiresAtMs(null);
        setEmergencyMessage("This emergency download link expired. After 1 hour, the recording is automatically deleted.");
        return;
      }

      if (!res.ok) {
        console.error("Emergency download failed (http)", {
          status: res.status,
          body: json ?? text,
        });
        setEmergencyMessage("Server error fetching recording. Try again.");
        return;
      }

      const url = (json as any)?.url || (json as any)?.data?.url;
      const expiresAt = (json as any)?.expiresAt || (json as any)?.data?.expiresAt;
      const expiresAtMs = (json as any)?.expiresAtMs || (json as any)?.data?.expiresAtMs;
      if (!url) {
        console.error("Emergency download failed (shape)", { body: json ?? text });
        setEmergencyMessage("Recording URL missing. Contact support.");
        return;
      }

      if (typeof expiresAtMs === "number" && Number.isFinite(expiresAtMs)) {
        setEmergencyExpiresAtMs(expiresAtMs);
      } else if (typeof expiresAt === "string" && expiresAt) {
        const ms = Date.parse(expiresAt);
        setEmergencyExpiresAtMs(Number.isFinite(ms) ? ms : null);
      }

      window.open(url, "_blank");
      setEmergencyMessage("Download link opened.");
    } catch (err) {
      console.error("Emergency download failed (unexpected)", err);
      setEmergencyMessage("Unexpected error. Try again.");
    } finally {
      setEmergencyLoading(false);
      setTimeout(() => setEmergencyMessage(null), 5000);
    }
  };



const startCheckout = async (plan: CheckoutPlanVariant) => {
  // In test mode, Stripe checkout is disabled in favor of test-mode plan switching.
  if (isTestMode) {
    const platformDisabled = user?.platformBillingEnabled === false;
    const userDisabled = user?.billingEnabled === false;
    if (platformDisabled) {
      setError(
        "Stripe checkout is disabled because Platform Billing is OFF. Enable Platform Billing in the Admin Dashboard, then retry."
      );
    } else if (userDisabled) {
      setError(
        "Stripe checkout is disabled for your account because billing is turned OFF for this user. An admin must enable billing for your user, then retry."
      );
    } else {
      setError("Billing is disabled in Test Mode. Use 'Switch Plan (Test Mode)' below instead.");
    }
    setActionLoading(null);
    return;
  }

  // Require Terms of Service agreement before starting checkout.
  const hasAcceptedCurrentTos = Boolean(
    user && user.tosVersion && user.currentTosVersion && user.tosVersion === user.currentTosVersion && user.tosAcceptedAt
  );
  if (!hasAcceptedCurrentTos && !checkoutTosAccepted) {
    setCheckoutTosError("You must agree to the Terms of Service before changing plans.");
    setActionLoading(null);
    return;
  }

  setActionLoading(plan);
  const requestId = `${plan}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  try {
    const res = await apiFetchWithCookieFallback("/api/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ plan, requestId, tosAccepted: true }),
    });

    const data = await res.json();
    if (!data.success) {
      throw Object.assign(new Error(data.error || "Checkout failed"), { status: res.status, body: data });
    }

    // First-time paid subscription flow (Stripe Checkout)
    if (data.url) {
      window.location.href = data.url;
      return;
    }

    // Existing subscriber flow: server may apply upgrade immediately or schedule downgrade.
    if (data.mode === "upgrade") {
      setToast("Plan updated");
      setActionLoading(null);
      try {
        await finalizeBillingAfterPlanChange({
          expectedPlanId: checkoutVariantToPlanId(plan),
          maxPollAttempts: 5,
          pollIntervalMs: 1200,
        });
      } catch {}
      return;
    }

    if (data.mode === "downgrade_scheduled") {
      const effectiveAtMs = typeof data.effectiveAtMs === "number" ? data.effectiveAtMs : null;
      const dateLabel = effectiveAtMs ? new Date(effectiveAtMs).toLocaleString() : "your renewal date";
      setToast(`Downgrade scheduled for ${dateLabel}`);
      setActionLoading(null);
      try {
        await finalizeBillingAfterPlanChange({
          expectedDowngradeScheduled: true,
          maxPollAttempts: 5,
          pollIntervalMs: 1200,
        });
      } catch {}
      return;
    }

    setToast("Plan change requested");
    setActionLoading(null);
  } catch (err: any) {
    const bodyError = err?.body?.error;
    const retryAfterMs = typeof err?.body?.retryAfterMs === "number" ? err.body.retryAfterMs : null;

    if (bodyError === "plan_change_limit_daily") {
      const hours = retryAfterMs ? Math.max(1, Math.ceil(retryAfterMs / 3600000)) : 24;
      setError(`You can change plans again in ${hours} hour${hours === 1 ? "" : "s"}.`);
    } else if (bodyError === "downgrade_limit_monthly") {
      const date = retryAfterMs ? new Date(Date.now() + retryAfterMs) : null;
      const label = date ? date.toLocaleDateString() : "later";
      setError(`You can downgrade again on ${label}.`);
    } else if (err?.status === 403 && bodyError === "billing_disabled") {
      setError("Billing is disabled for this account. Use Test Mode plan switching instead.");
    } else if (err?.status === 403 && bodyError === "tos_not_accepted") {
      setCheckoutTosError("You must agree to the Terms of Service before changing plans.");
    } else if (bodyError) {
      setError(bodyError);
    } else {
      setError(err.message || "Failed to start checkout. Please try again.");
    }
    setActionLoading(null);
    setUser((prev) => (prev ? { ...prev, pendingPlan: null } : prev));
  }
};

  const cancelSubscription = async () => {
    if (closeCancelLoading) return;
    setCloseCancelLoading(true);
    setError(null);
    try {
      const res = await apiFetchWithCookieFallback("/api/account/close", {
        method: "POST",
        body: JSON.stringify({ mode: "cancel_only" }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        throw Object.assign(new Error(data?.error || "Cancel failed"), { status: res.status, body: data });
      }
      setToast("Subscription will cancel at period end");
      try {
        clearMeCache();
        const me = await loadUser({ forceRefresh: true });
        await loadEntitlements();
        setUser(me);
      } catch {}
    } catch (err: any) {
      setError(err?.body?.error || err?.message || "Failed to cancel subscription");
    } finally {
      setCloseCancelLoading(false);
    }
  };

  const deleteAccount = async () => {
    if (closeDeleteLoading) return;
    if (!closeDeleteConfirmed || closeDeleteText.trim().toUpperCase() !== "DELETE") {
      setError("Confirm deletion by checking the box and typing DELETE.");
      return;
    }
    setCloseDeleteLoading(true);
    setError(null);
    try {
      const res = await apiFetchWithCookieFallback("/api/account/close", {
        method: "POST",
        body: JSON.stringify({ mode: "delete" }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        throw Object.assign(new Error(data?.error || "Delete failed"), { status: res.status, body: data });
      }

      clearAuthStorage();
      clearMeCache();
      clearPlatformFlagsCache();
      setToast("Account deletion requested");
      nav("/login", { replace: true, state: { accountDeleted: true } });
    } catch (err: any) {
      setError(err?.body?.error || err?.message || "Failed to delete account");
    } finally {
      setCloseDeleteLoading(false);
    }
  };



  const openPortal = async () => {
    setActionLoading("portal");
    try {
      if (isTestMode) {
        setError("Billing portal is disabled in Test Mode. Use test-mode plan switches instead.");
        setActionLoading(null);
        return;
      }
      // If no Stripe customer, guide user into Checkout to create one
      if (!hasStripeCustomer) {
        setShowManagePicker(true);
        setActionLoading(null);
        return;
      }
      const res = await apiFetchWithCookieFallback("/api/billing/portal", {
        method: "POST",
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Portal failed");
      window.location.href = data.url;
    } catch (err: any) {
      setError(err.message);
      setActionLoading(null);
    }
  };

    const submitTosAcceptance = async () => {
      if (!checkoutTosAccepted || checkoutTosSubmitting) return;
      setCheckoutTosSubmitting(true);
      setCheckoutTosError(null);
      try {
        const res = await apiFetchWithCookieFallback("/api/account/accept-tos", {
          method: "POST",
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error || "Failed to record Terms acceptance.");
        }
        setUser((prev) =>
          prev
            ? {
                ...prev,
                tosVersion: data.tosVersion ?? prev.tosVersion ?? null,
                tosAcceptedAt: data.tosAcceptedAt ?? prev.tosAcceptedAt ?? null,
                currentTosVersion: data.tosVersion ?? prev.currentTosVersion ?? null,
              }
            : prev
        );
      } catch (err: any) {
        setCheckoutTosError(err.message || "Failed to submit Terms acceptance. Please try again.");
      } finally {
        setCheckoutTosSubmitting(false);
      }
    };

  const openTestPlanModal = (planId: PlanId) => {
    setTestModeTargetPlan(planId);
    setTestModeSummary(null);
    setTestModeModalOpen(true);
  };

  const closeTestModeModal = () => {
    setTestModeModalOpen(false);
    setTestModeTargetPlan(null);
    setTestModeLoading(false);
  };

  const confirmTestPlanChange = async () => {
    if (!testModeTargetPlan) return;
    setTestModeLoading(true);
    setError(null);
    try {
      const res = await apiFetchWithCookieFallback("/api/billing/test/change-plan", {
        method: "POST",
        body: JSON.stringify({ newPlanId: testModeTargetPlan }),
      });
      const data = await res.json();
      const newPlanId = (data?.planId || testModeTargetPlan) as PlanId;

      setUser((prev) => (prev ? { ...prev, planId: newPlanId, pendingPlan: null } : prev));

      try {
        clearMeCache();
        await Promise.all([refreshAuth(), loadEntitlements(), loadUsage()]);
      } catch {}

      const planMeta = plans.find((p) => canonicalPlanId(p.id) === newPlanId);
      const name = planMeta?.name || newPlanId;
      setTestModeSummary(`You are now simulating the ${name} plan. Limits and gates below use this plan.`);
      showToast("Plan switched (Test Mode)");

      setTestModeModalOpen(false);
      setTestModeTargetPlan(null);
    } catch (err: any) {
      const code = err?.body?.error || err?.message;
      if (code === "billing_live") {
        setError("Live billing is enabled on this account. Test Mode switching is disabled.");
      } else if (code === "test_mode_disabled") {
        setError(
          "Test Mode plan switching isn’t enabled for your user. This is a setting/permission: ask an admin to mark your account as a tester (tester=true) or enable platform-wide Test Mode (disable billing system)."
        );
      } else if (code === "insufficient_permissions") {
        setError(
          "You don’t have permission to switch plans in Test Mode. This is a setting/permission: ask an admin to grant tester access or switch this environment into platform-wide Test Mode."
        );
      } else if (code === "unauthorized") {
        setError("You’re not signed in (or your session expired). Please sign in again and retry.");
      } else if (code === "too_many_requests") {
        setError("Please wait a moment before switching plans again.");
      } else if (code === "invalid_plan") {
        setError("This plan is not available for Test Mode switching.");
      } else {
        setError("Failed to switch plan in Test Mode.");
      }
    } finally {
      setTestModeLoading(false);
    }
  };


// Canonicalize planId for display logic using canonical frontend utility
function canonicalPlanId(planId: string | undefined): PlanId {
  if (!planId) return "free";
  if (planId === "starter_paid" || planId === "starter_trial") return "starter";
  if (isPlanId(planId)) return planId;
  // fallback for unknown/legacy ids
  return "free";
}

const userPlanId: PlanId = canonicalPlanId(user?.planId);
const currentPlan = plans.find((p) => canonicalPlanId(p.id) === userPlanId);
const status = user?.billingStatus;
const hasStripeCustomer = !!(user?.billing?.customerId || (user as any)?.stripeCustomerId);

const hasAcceptedCurrentTosForUi = Boolean(
  user &&
  user.tosVersion &&
  user.currentTosVersion &&
  user.tosVersion === user.currentTosVersion &&
  user.tosAcceptedAt
);

// Canonical Test Mode detection prefers the auth user payload from /api/auth/me,
// with a fallback to the local /api/account/me user shape.
const isTestMode = isAuthUserInTestMode(authUser || (user as any));

const targetPlanForModal = testModeTargetPlan
  ? plans.find((p) => canonicalPlanId(p.id) === testModeTargetPlan)
  : null;
const targetPlanName = targetPlanForModal?.name || testModeTargetPlan || "";

const isPaidPlan = userPlanId === "starter" || userPlanId === "pro" || userPlanId === "basic";
const isBlocked = isPaidPlan && (status === "past_due" || status === "unpaid");
const isPaidValid = status === "active" || status === "trialing";

// Only treat pendingPlan as processing for paid plans; always consider active action loads.
// Also consider the explicit Stripe-return hint to cover free->paid upgrades.
const isProcessing = !!actionLoading || (userPlanId !== "free" && !!user?.pendingPlan) || upgradeProcessing;

const statusBadge = getStatusBadge(status, user?.billing?.cancelAtPeriodEnd);
const daysLeft = getDaysUntil(user?.billing?.currentPeriodEnd);

  const renderEntitlementPill = (
    label: string,
    value: string,
    ok: boolean
  ) => {
    return (
      <div
        key={label}
        style={{
          border: `1px solid ${ok ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.4)"}`,
          background: ok ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.06)",
          color: ok ? "#bbf7d0" : "#fecdd3",
          borderRadius: 10,
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          minHeight: 76,
        }}
      >
        <span style={{ fontSize: 12, opacity: 0.8 }}>{label}</span>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{value}</span>
        <span style={{ fontSize: 12, opacity: 0.8 }}>{ok ? "Included" : "Not included"}</span>
      </div>
    );
  };


  if (loading) {
    return (
      <div className="billing" style={S.container}>
        <div style={S.loadingScreen}>
          <div style={S.spinner} />
          <p>Loading billing information...</p>
        </div>
        {/* styles moved to SettingsBilling.css */}
      </div>
    );
  }

  if (!plans.length) {
    return (
      <div className="billing" style={S.container}>
        <div style={S.content}>
          <div style={S.header}>
            <h1 style={S.title}>💳 Billing & Plans</h1>
            <button onClick={loadAllData} style={S.refreshBtn} disabled={loading}>
              🔄 Refresh
            </button>
          </div>
          <div style={S.card}>
            <h2 style={S.cardTitle}>No plans available</h2>
            <p style={{ color: "#a1a1aa" }}>No plans were returned from the server. Please verify plan configuration in the admin panel.</p>
            <button onClick={loadAllData} style={S.primaryBtn} disabled={loading}>Try again</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="billing" style={S.container}>
      <div style={S.orb1} />
      <div style={S.orb2} />

      <div style={S.content}>
        {/* Header */}
        <div style={S.header}>
          <h1 style={S.title}>💳 Billing & Plans</h1>
          <button onClick={loadAllData} style={S.refreshBtn} disabled={loading}>
            🔄 Refresh
          </button>
        </div>

        {/* Error Banner */}
        {error && (
          <div style={S.errorBanner}>
            <span>⚠️ {error}</span>
            <button onClick={() => setError(null)} style={S.errorClose}>×</button>
          </div>
        )}

        {/* Test Mode Banner */}
        {isTestMode && (
          <div
            style={{
              marginBottom: 16,
              padding: "12px 16px",
              borderRadius: 12,
              border: "1px dashed rgba(59,130,246,0.7)",
              background: "rgba(37,99,235,0.18)",
              color: "#bfdbfe",
              fontSize: 13,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {user?.platformBillingEnabled === false
                ? "Test Mode — Platform Billing Disabled"
                : "Test Mode — Billing Disabled For This Account"}
            </div>
            <div>
              Stripe checkout and the billing portal are disabled; plan changes here simulate purchases and apply limits
              immediately.
            </div>
            {testModeSummary && (
              <div style={{ marginTop: 6, color: "#e5e7eb" }}>{testModeSummary}</div>
            )}
          </div>
        )}

        {/* Back to Join Button */}
        <div style={{ display: "flex", justifyContent: "flex-start", alignItems: "center", marginBottom: 24 }}>
          <button
            onClick={() => nav("/join")}
            style={{
              background: "#18181b",
              color: "#fff",
              border: "1px solid #333",
              borderRadius: 8,
              padding: "8px 18px",
              fontWeight: 600,
              fontSize: 16,
              cursor: "pointer",
              marginRight: 12,
            }}
          >
            ← Back to Join
          </button>
        </div>
        {/* Tabs */}
        <div style={S.tabsRow}>
          <button
            type="button"
            style={activeTab === "plan" ? { ...S.tab, ...S.tabActive } : S.tab}
            onClick={() => setActiveTab("plan")}
          >
            Plan & Billing
          </button>
          <button
            type="button"
            style={activeTab === "usage" ? { ...S.tab, ...S.tabActive } : S.tab}
            onClick={() => setActiveTab("usage")}
          >
            Usage
          </button>
          {platformTranscodeEnabled !== false && (
            <button
              type="button"
              style={activeTab === "destinations" ? { ...S.tab, ...S.tabActive } : S.tab}
              onClick={() => setActiveTab("destinations")}
            >
              Stream Keys
            </button>
          )}
          {platformHlsSettingsTabEnabled !== false && (
            <button
              type="button"
              style={activeTab === "hls" ? { ...S.tab, ...S.tabActive } : S.tab}
              onClick={() => setActiveTab("hls")}
            >
              HLS
            </button>
          )}
          <button
            type="button"
            style={activeTab === "defaults" ? { ...S.tab, ...S.tabActive } : S.tab}
            onClick={() => setActiveTab("defaults")}
          >
            Media Defaults
          </button>
          <button
            type="button"
            style={activeTab === "roles" ? { ...S.tab, ...S.tabActive } : S.tab}
            onClick={() => setActiveTab("roles")}
          >
            Mod/Guest Setup
          </button>
          <button
            type="button"
            style={activeTab === "close" ? { ...S.tab, ...S.tabActive } : S.tab}
            onClick={() => setActiveTab("close")}
          >
            Close Account
          </button>
        </div>

        {/* ================================================================ */}
        {/* SECTION: HLS (Viewer page setup per room) */}
        {/* ================================================================ */}
        {platformHlsSettingsTabEnabled !== false && (
          <div style={{
            ...S.card,
            opacity: isBlocked ? 0.6 : 1,
            display: activeTab === "hls" ? "block" : "none",
          }}>
            <div style={S.cardHeader}>
              <h2 style={S.cardTitle}>📺 HLS</h2>
            </div>

            {!platformHlsEnabled && (
              <div style={{
                marginBottom: 12,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(245,158,11,0.35)",
                background: "rgba(245,158,11,0.10)",
                color: "#fde68a",
                fontSize: 13,
                fontWeight: 700,
              }}>
                HLS settings are currently disabled platform-wide.
              </div>
            )}

            <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.5 }}>
              Create saved viewer links (channels), copy viewer link/iframe code, and edit viewer branding. No roomId paste required.
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#e5e7eb" }}>Plan access:</div>
                <div style={{ fontSize: 12, color: entitlements.canHls ? "#22c55e" : "#f97316", fontWeight: 800 }}>
                  Runtime: {entitlements.canHls ? "Enabled" : "Not included"}
                </div>
                <div style={{ fontSize: 12, color: entitlements.hlsCustomizationEnabled ? "#22c55e" : "#f97316", fontWeight: 800 }}>
                  Setup: {entitlements.hlsCustomizationEnabled ? "Enabled" : "Upgrade required"}
                </div>
              </div>

              <SettingsHlsSetup
                platformEnabled={platformHlsEnabled}
                canCustomize={!!entitlements.hlsCustomizationEnabled}
                onUpgrade={() => setActiveTab("plan")}
              />
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* SECTION 4: ROLE DEFAULTS (Participant / Co-host templates) */}
        {/* ================================================================ */}
        {activeTab === "roles" && (
          <div style={{ ...S.card, opacity: isBlocked ? 0.6 : 1 }}>
            <div style={S.cardHeader}>
              <h2 style={S.cardTitle}>🛡️ Role Defaults</h2>
            </div>

            <p style={{ color: "#94a3b8", marginBottom: 14 }}>
              Configure what Participants and Co-hosts can do in-room. These templates apply whenever you change a guest's
              role from the Host Dashboard. Moderation (mute/remove) always stays host-only.
            </p>

            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
              {(["participant", "cohost"] as RolePresetId[]).map((id) => {
                const preset = rolePresets?.[id];
                const savingState = rolePresetsSaving[id];
                const label = ROLE_PRESET_LABELS[id];
                const description =
                  id === "participant"
                    ? "Guests who join as standard participants. Usually limited to screen share and invites."
                    : "Elevated guests who can help run the stream (destinations, layout, recording).";

                return (
                  <div
                    key={id}
                    style={{
                      border: "1px solid #1f2937",
                      borderRadius: 10,
                      padding: "10px 12px",
                      background: "rgba(15,23,42,0.85)",
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span style={{ fontWeight: 700 }}>{label}</span>
                        <span style={{ color: "#9ca3af", fontSize: 12 }}>{description}</span>
                      </div>
                      <span
                        style={{
                          color: "#22c55e",
                          background: "rgba(34,197,94,0.12)",
                          border: "1px solid rgba(34,197,94,0.4)",
                          borderRadius: 999,
                          padding: "2px 8px",
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        Template
                      </span>
                    </div>

                    {savingState === "saving" && (
                      <div style={{ color: "#6366f1", fontSize: 12, fontWeight: 600 }}>Saving…</div>
                    )}
                    {savingState === "saved" && (
                      <div style={{ color: "#16a34a", fontSize: 12, fontWeight: 600 }}>Saved</div>
                    )}
                    {savingState === "error" && (
                      <div style={{ color: "#f97316", fontSize: 12, fontWeight: 600 }}>Error — retry</div>
                    )}

                    {ROLE_PRESET_GROUPS.map((group) => (
                      <div key={group.title} style={{ display: "grid", gap: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#e5e7eb" }}>{group.title}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {group.keys.map(({ key, label: chipLabel }) => {
                            const enabled = !!(preset as any)?.[key];
                            return (
                              <button
                                key={key}
                                type="button"
                                onClick={() => {
                                  const nextValue = !enabled;
                                  saveRolePreset(id, { [key]: nextValue } as any);
                                  setRolePresets((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          [id]: {
                                            ...(prev[id] as RolePresetDoc),
                                            [key]: nextValue,
                                          } as RolePresetDoc,
                                        }
                                      : prev,
                                  );
                                }}
                                style={{
                                  padding: "3px 7px",
                                  borderRadius: 999,
                                  border: `1px solid ${enabled ? "rgba(34,197,94,0.5)" : "#1f2937"}`,
                                  background: enabled ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.02)",
                                  color: enabled ? "#22c55e" : "#94a3b8",
                                  fontSize: 11,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                }}
                              >
                                {chipLabel}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 14, color: "#9ca3af", fontSize: 12 }}>
              Notes:
              <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                <li>Host-only actions like mute/remove, mute-all, and mute-lock are never granted by these templates.</li>
                <li>
                  If any legacy roles or moderator presets exist, they are treated as Participant in-room so older data can't
                  reintroduce extra roles.
                </li>
              </ul>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* SECTION 1: PAYMENT WARNING (if blocked) */}
        {/* ================================================================ */}
        {activeTab === "plan" && (
          <>
            {(() => {
              const remaining = (billingStatusSnapshot as any)?.daily?.remaining;
              const retryAfterMs = (billingStatusSnapshot as any)?.daily?.retryAfterMs;
              if (typeof remaining !== "number") return null;
              const hours = typeof retryAfterMs === "number" && retryAfterMs > 0
                ? Math.max(1, Math.ceil(retryAfterMs / 3600000))
                : 0;
              return (
                <div
                  style={{
                    marginBottom: 14,
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(148,163,184,0.22)",
                    background: "rgba(148,163,184,0.06)",
                    color: "#e5e7eb",
                    fontSize: 13,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    Plan changes available (next 24h): <span style={{ color: remaining > 0 ? "#22c55e" : "#f59e0b" }}>{remaining}</span> / 3
                  </div>
                  {remaining === 0 && hours > 0 && (
                    <div style={{ fontSize: 12, color: "#cbd5e1", fontWeight: 700 }}>
                      Next change in ~{hours} hour{hours === 1 ? "" : "s"}
                    </div>
                  )}
                </div>
              );
            })()}

            {isBlocked && !isTestMode && (
              <div style={S.warningCard}>
                <div style={S.warningIcon}>⚠️</div>
                <div style={S.warningContent}>
                  <h3 style={S.warningTitle}>Payment Issue — Paid Features Blocked</h3>
                  <p style={S.warningText}>
                    Your payment failed or is past due. Paid features like recording, multistream, 
                    and downloads are temporarily disabled until payment is resolved.
                  </p>
                  <div style={S.warningActions}>
                    <button onClick={openPortal} style={S.fixPaymentBtn} disabled={!!actionLoading}>
                      {actionLoading === "portal" ? "⏳ Loading..." : "💳 Fix Payment"}
                    </button>
                    <a href="mailto:support@streamline.app" style={S.supportLink}>
                      Contact Support
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* ================================================================ */}
            {/* SECTION 2: YOUR PLAN (current plan card) */}
            {/* ================================================================ */}
            <div style={{ ...S.card, opacity: isBlocked ? 0.6 : 1 }}>
              <div style={S.cardHeader}>
                <h2 style={S.cardTitle}>Your Plan</h2>
                {isProcessing && (
                  <span style={S.processingBadge}>
                    {upgradeProcessing
                      ? "Upgrade processing — this can take a few seconds."
                      : user?.billing?.cancelAtPeriodEnd
                        ? `Cancellation scheduled — ends ${formatDate(user?.billing?.currentPeriodEnd)}`
                        : (user as any)?.scheduledPlanChange?.type === "downgrade" &&
                            typeof (user as any)?.scheduledPlanChange?.effectiveAtMs === "number" &&
                            (user as any)?.scheduledPlanChange?.effectiveAtMs > Date.now()
                          ? `Downgrade scheduled — stays active until ${formatDate((user as any).scheduledPlanChange.effectiveAtMs)}`
                          : `Plan change scheduled — applies on next billing date${user?.billing?.currentPeriodEnd ? ` (${formatDate(user?.billing?.currentPeriodEnd)})` : ""}`}
                  </span>
                )}
              </div>

              {currentPlan ? (
                <div style={S.planDisplay}>
                  <div style={S.planInfo}>
                    <div style={S.planNameRow}>
                      <span style={S.planName}>{currentPlan.name}</span>
                      <span style={{ ...S.statusBadge, color: statusBadge.color, background: statusBadge.bg }}>
                        {statusBadge.icon} {statusBadge.text}
                      </span>
                    </div>
                    <div style={S.planPrice}>
                      <span style={S.priceAmount}>${(currentPlan as any).priceMonthly ?? currentPlan.price}</span>
                      <span style={S.pricePeriod}>/month</span>
                    </div>
                    {currentPlan.description && (
                      <p style={S.planDescription}>{currentPlan.description}</p>
                    )}
                  </div>

                  <div style={S.billingDetails}>
                    {status === "trialing" && (
                      <div style={S.detailRow}>
                        <span style={S.detailLabel}>Trial ends</span>
                        <span style={S.detailValue}>
                          {formatDate(user?.billing?.currentPeriodEnd)}
                          <span style={S.daysLeft}>({daysLeft} days left)</span>
                        </span>
                      </div>
                    )}
                    {status === "active" && !user?.billing?.cancelAtPeriodEnd && (
                      <div style={S.detailRow}>
                        <span style={S.detailLabel}>Next billing</span>
                        <span style={S.detailValue}>{formatDate(user?.billing?.currentPeriodEnd)}</span>
                      </div>
                    )}
                    {user?.billing?.cancelAtPeriodEnd && (
                      <div style={S.detailRow}>
                        <span style={S.detailLabel}>Access ends</span>
                        <span style={{ ...S.detailValue, color: "#f59e0b" }}>
                          {formatDate(user?.billing?.currentPeriodEnd)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={S.planDisplay}>
                  <div style={S.planInfo}>
                    <div style={S.planNameRow}>
                      <span style={S.planName}>Plan unavailable</span>
                      <span style={{ ...S.statusBadge, color: statusBadge.color, background: statusBadge.bg }}>
                        {statusBadge.icon} {statusBadge.text}
                      </span>
                    </div>
                    <p style={S.planDescription}>No matching plan found for your account. Please contact support.</p>
                  </div>
                </div>
              )}

              {/* Terms of Service status + checkbox + explicit submit for checkout */}
              {!hasAcceptedCurrentTosForUi && (
                <div style={{ marginTop: 16, padding: "10px 12px", borderRadius: 10, border: "1px solid #1f2937", background: "rgba(15,23,42,0.8)", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 13, color: "#e5e7eb" }}>
                    <strong>Legal</strong>
                  </div>
                  <div style={{ fontSize: 12, color: "#9ca3af" }}>
                    {user?.tosVersion && user?.tosAcceptedAt ? (
                      <>
                        Last accepted Terms of Service: v{user.tosVersion} on {formatDate(user.tosAcceptedAt)}
                      </>
                    ) : (
                      <>You have not yet accepted the latest Terms of Service.</>
                    )}
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#e5e7eb" }}>
                    <input
                      type="checkbox"
                      checked={checkoutTosAccepted}
                      onChange={(e) => {
                        setCheckoutTosAccepted(e.target.checked);
                        setCheckoutTosError(null);
                      }}
                    />
                    <span>
                      I agree to the <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", textDecoration: "underline" }}>Terms of Service</a>
                    </span>
                  </label>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 2 }}>
                    <button
                      type="button"
                      onClick={submitTosAcceptance}
                      disabled={!checkoutTosAccepted || checkoutTosSubmitting}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 999,
                        border: "1px solid rgba(96,165,250,0.3)",
                        background: !checkoutTosAccepted || checkoutTosSubmitting ? "rgba(31,41,55,0.8)" : "rgba(37,99,235,0.9)",
                        color: "#e5e7eb",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: !checkoutTosAccepted || checkoutTosSubmitting ? "not-allowed" : "pointer",
                      }}
                    >
                      {checkoutTosSubmitting ? "Submitting..." : "Submit acceptance"}
                    </button>
                  </div>
                  {checkoutTosError && (
                    <div style={{ fontSize: 12, color: "#f97316" }}>{checkoutTosError}</div>
                  )}
                </div>
              )}

              {!platformTranscodeEnabled && (
                <div
                  style={{
                    marginTop: 12,
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(248,113,113,0.45)",
                    background: "rgba(30,64,175,0.45)",
                    color: "#fee2e2",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  <div style={{ marginBottom: 4 }}>Transcoding: Temporarily Disabled (Beta)</div>
                  <div style={{ fontSize: 12, color: "#fecaca", fontWeight: 400 }}>
                    Recordings are still available, but export/transcode features are paused while we stabilize the pipeline.
                  </div>
                </div>
              )}

              {/* Primary Actions */}
              <div style={S.actionButtons}>
                {isTestMode ? (
                  <div style={{ fontSize: 13, color: "#e5e7eb" }}>
                    Billing is disabled for this workspace. Use the "Switch Plan (Test Mode)" buttons in the comparison grid
                    below to simulate different plans. No Stripe charges will occur.
                  </div>
                ) : (
                  <>
                    {/* Free user, no billing */}
                    {userPlanId === "free" && (!status || status === "none") && !isProcessing && (
                      <>
                        <button
                          onClick={() => startCheckout("starter_trial")}
                          style={S.primaryBtn}
                          disabled={!!actionLoading}
                        >
                          {actionLoading === "starter_trial" ? "⏳ Loading..." : "🚀 Start Free Trial"}
                        </button>

                        <button
                          onClick={() => startCheckout("basic")}
                          style={S.secondaryBtn}
                          disabled={!!actionLoading}
                        >
                          {actionLoading === "basic" ? "⏳ Loading..." : "Choose Basic Plan"}
                        </button>

                        <button
                          onClick={() => startCheckout("starter_paid")}
                          style={S.secondaryBtn}
                          disabled={!!actionLoading}
                        >
                          {actionLoading === "starter_paid" ? "⏳ Loading..." : "Choose Starter Plan"}
                        </button>

                        <button
                          onClick={() => startCheckout("pro")}
                          style={S.secondaryBtn}
                          disabled={!!actionLoading}
                        >
                          {actionLoading === "pro" ? "⏳ Loading..." : "Choose Pro Plan"}
                        </button>
                      </>
                    )}

                    {/* Trialing */}
                    {status === "trialing" && (
                      <>
                        <button onClick={openPortal} style={S.primaryBtn} disabled={!!actionLoading}>
                          {actionLoading === "portal" ? "⏳ Loading..." : "⚙️ Manage Billing"}
                        </button>
                        {userPlanId === "starter" && (
                          <button
                            onClick={() => startCheckout("pro")}
                            style={S.secondaryBtn}
                            disabled={!!actionLoading}
                          >
                            {actionLoading === "pro" ? "⏳ Loading..." : "Upgrade to Pro"}
                          </button>
                        )}
                      </>
                    )}

                    {/* Active */}
                    {status === "active" && (
                      <>
                        <button onClick={openPortal} style={S.primaryBtn} disabled={!!actionLoading}>
                          {actionLoading === "portal" ? "⏳ Loading..." : "⚙️ Manage Billing"}
                        </button>
                        {userPlanId === "starter" && (
                          <button
                            onClick={() => startCheckout("pro")}
                            style={S.secondaryBtn}
                            disabled={!!actionLoading}
                          >
                            {actionLoading === "pro" ? "⏳ Loading..." : "Upgrade to Pro"}
                          </button>
                        )}
                      </>
                    )}

                    {/* Canceled but still has access */}
                    {status === "canceled" && (
                      <>
                        <button
                          onClick={() => startCheckout(checkoutPlanForResubscribe(user))}
                          style={S.primaryBtn}
                          disabled={!!actionLoading}
                        >
                          {actionLoading ? "⏳ Loading..." : "🔁 Resubscribe"}
                        </button>
                        <button onClick={openPortal} style={S.secondaryBtn} disabled={!!actionLoading}>
                          Manage Billing
                        </button>
                      </>
                    )}

                    {/* Processing */}
                    {isProcessing && (
                      <button onClick={handleRefreshStatus} style={S.secondaryBtn}>
                        🔄 Refresh Status
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* ================================================================ */}
            {/* SECTION 4: PLAN COMPARISON */}
            {/* ================================================================ */}

            <div style={S.card}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <h2 style={S.cardTitle}>📊 Compare Plans</h2>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => loadPlans()}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "rgba(15,23,42,0.8)",
                      color: "#e2e8f0",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                    title="Force refresh from /api/plans"
                  >
                    🔄 Refresh plans
                  </button>
                )}
                <a
                  href="/pricing/explainer"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: "#60a5fa",
                    fontSize: 13,
                    textDecoration: "underline",
                    fontWeight: 500,
                  }}
                >
                  Click here to get an explanation of our pricing
                </a>
              </div>

              {(!platformRecordingEnabled || !platformHlsEnabled || !platformTranscodeEnabled) && (
                <div
                  style={{
                    marginTop: 12,
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(245,158,11,0.45)",
                    background: "rgba(245,158,11,0.12)",
                    color: "#fde68a",
                    fontSize: 13,
                    lineHeight: 1.35,
                  }}
                >
                  <div style={{ fontWeight: 700 }}>Some features are temporarily unavailable platform-wide.</div>
                </div>
              )}

              <div style={S.plansGrid}>
                {plans.map((plan) => {
                  const planId = canonicalPlanId(plan.id);
                  const userPlan = userPlanId;
                  const color =
                    planId === "free"
                      ? "#6b7280"
                      : planId === "basic"
                      ? "#0ea5e9"
                      : planId === "starter"
                      ? "#3b82f6"
                      : "#8b5cf6";
                  const isCurrent = planId === userPlan;
                  const isUpgrade =
                    (userPlan === "free" && (planId === "basic" || planId === "starter" || planId === "pro")) ||
                    (userPlan === "basic" && (planId === "starter" || planId === "pro")) ||
                    (userPlan === "starter" && planId === "pro");
                  const isDowngrade =
                    (userPlan === "pro" && (planId === "starter" || planId === "basic" || planId === "free")) ||
                    (userPlan === "starter" && (planId === "basic" || planId === "free")) ||
                    (userPlan === "basic" && planId === "free");
                  return (
                    <div
                      key={plan.id}
                      style={{
                        ...S.planCard,
                        borderColor: isCurrent ? color : "rgba(63,63,70,0.5)",
                        boxShadow: isCurrent ? `0 0 20px ${color}30` : "none",
                      }}
                    >
                      {isCurrent && (
                        <div style={{ ...S.currentBadge, background: color }}>Current</div>
                      )}
                      <div style={S.planCardHeader}>
                        <h3 style={{ ...S.planCardName, color }}>{plan.name}</h3>
                        <div style={S.planCardPrice}>
                          <span style={S.planCardAmount}>${plan.priceMonthly ?? plan.price}</span>
                          <span style={S.planCardPeriod}>/mo</span>
                        </div>
                        {plan.description && (
                          <p style={{ margin: "4px 0 0", color: "#9ca3af", fontSize: 12 }}>
                            {plan.description}
                          </p>
                        )}
                      </div>
                      <ul style={S.featureList}>
                        <FeatureRow label={usageLabels.inRoomMinutes} value={plan.limits.monthlyMinutesIncluded} />
                        {platformTranscodeEnabled !== false && plan.limits.transcodeMinutes > 0 && (
                          <FeatureRow
                            label={usageLabels.broadcastMinutes}
                            value={plan.limits.transcodeMinutes}
                          />
                        )}
                        <FeatureRow label="Max guests" value={plan.limits.maxGuests} />
                        <FeatureRow label="Stream destinations" value={plan.limits.rtmpDestinationsMax} />
                        {platformRecordingEnabled !== false && (
                          <FeatureRow
                            label="Recording"
                            value={Boolean((plan as any).features?.recording)}
                            lockedText="Not included in this plan"
                          />
                        )}
                        {platformTranscodeEnabled !== false && (
                          <FeatureRow
                            label="Multistream"
                            value={Boolean((plan as any).features?.multistream ?? (plan as any).multistreamEnabled)}
                            lockedText="Not included in this plan"
                          />
                        )}
                        {platformHlsEnabled !== false && (
                          <FeatureRow
                            label="HLS Broadcast Page"
                            value={Boolean(
                              (plan as any).features?.hlsCustomizationEnabled ??
                              (plan as any).features?.canCustomizeHlsPage ??
                              (plan as any).features?.canHls ??
                              (plan as any).features?.hls
                            )}
                            lockedText="Not included in this plan"
                          />
                        )}
                        {/* Advanced Permissions is now removed from plan marketing UI; all accounts use simple Participant/Co-host defaults. */}
                        {plan.editing?.access && (
                          <>
                            <FeatureRow label="Projects" value={plan.editing.maxProjects} />
                            <FeatureRow label="Storage" value={`${plan.editing.maxStorageGB}GB`} />
                          </>
                        )}
                      </ul>
                      {(planId !== "free" && planId !== "basic") && (
                        <div style={{ color: "#94a3b8", fontSize: 12, margin: "8px 0 0 0", lineHeight: 1.45 }}>
                          <div>
                            <span style={{ color: "#60a5fa" }}>{usageLabels.inRoomMinutes}</span> {" "}
                            {usageTooltips.inRoomMinutes}
                          </div>
                          <div style={{ marginTop: 6 }}>
                            <span style={{ color: "#a78bfa" }}>{usageLabels.broadcastMinutes}</span> {" "}
                            {usageTooltips.broadcastMinutes}
                          </div>
                          <div style={{ marginTop: 8 }}>
                            Broadcast minutes are counted per destination, per minute.
                          </div>
                        </div>
                      )}
                      <div style={S.planCardAction}>
                        {isTestMode ? (
                          isCurrent ? (
                            <span style={S.currentLabel}>✅ Current Plan (Test Mode)</span>
                          ) : (
                            <button
                              onClick={() => openTestPlanModal(planId)}
                              style={{
                                ...S.planUpgradeBtn,
                                background: `linear-gradient(135deg, ${color}, ${color}dd)`,
                              }}
                              disabled={testModeLoading}
                            >
                              {testModeLoading && testModeTargetPlan === planId ? "⏳ Switching..." : "Switch Plan (Test Mode)"}
                            </button>
                          )
                        ) : isCurrent ? (
                          <span style={S.currentLabel}>✅ Current Plan</span>
                        ) : planId === "basic" && (userPlan === "free" || userPlan === "starter") ? (
                          <button
                            onClick={() => startCheckout("basic")}
                            style={{
                              ...S.planUpgradeBtn,
                              background: `linear-gradient(135deg, ${color}, ${color}dd)`,
                            }}
                            disabled={!!actionLoading || isBlocked || isProcessing}
                          >
                            {actionLoading === "basic"
                              ? "⏳..."
                              : getPlanActionLabel(userPlan, "basic" as any, {
                                  isProcessing,
                                  pendingPlan: user?.pendingPlan,
                                })}
                          </button>
                        ) : planId === "starter" && (userPlan === "free" || userPlan === "basic") ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            <button
                              onClick={() => startCheckout("starter_paid")}
                              style={{
                                ...S.planUpgradeBtn,
                                background: `linear-gradient(135deg, ${color}, ${color}dd)`,
                              }}
                              disabled={!!actionLoading || isBlocked || isProcessing}
                            >
                              {actionLoading === "starter_paid"
                                ? "⏳..."
                                : getPlanActionLabel(userPlan, "starter", {
                                    isProcessing,
                                    pendingPlan: user?.pendingPlan,
                                  })}
                            </button>
                            <button
                              onClick={() => startCheckout("starter_trial")}
                              style={{
                                ...S.planUpgradeBtn,
                                background: `linear-gradient(135deg, ${color}, ${color}dd)`,
                              }}
                              disabled={!!actionLoading || isBlocked || isProcessing}
                            >
                              {actionLoading === "starter_trial" ? "⏳..." : "🚀 Start Free Trial"}
                            </button>
                          </div>
                        ) : planId === "pro" && (userPlan === "free" || userPlan === "starter" || userPlan === "basic") ? (
                          <button
                            onClick={() => startCheckout("pro")}
                            style={{
                              ...S.planUpgradeBtn,
                              background: `linear-gradient(135deg, ${color}, ${color}dd)`,
                            }}
                            disabled={!!actionLoading || isBlocked || isProcessing}
                          >
                            {actionLoading === "pro"
                              ? "⏳..."
                              : getPlanActionLabel(userPlan, "pro", {
                                  isProcessing,
                                  pendingPlan: user?.pendingPlan,
                                })}
                          </button>
                        ) : planId === "free" && (userPlan === "starter" || userPlan === "pro" || userPlan === "basic") ? (
                          <button
                            onClick={openPortal}
                            style={{
                              ...S.planUpgradeBtn,
                              background: `linear-gradient(135deg, ${color}, ${color}dd)`,
                              opacity: 0.85,
                            }}
                            disabled={!!actionLoading || isBlocked}
                          >
                            Manage in Billing Portal
                          </button>
                        ) : (
                          <button
                            onClick={openPortal}
                            style={{
                              ...S.planUpgradeBtn,
                              background: `linear-gradient(135deg, ${color}, ${color}dd)`,
                              opacity: 0.85,
                            }}
                            disabled={!!actionLoading || isBlocked}
                          >
                            {getPlanActionLabel(userPlan, planId as any, {
                              isProcessing,
                              pendingPlan: user?.pendingPlan,
                            })}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ================================================================ */}
            {/* SECTION 5: WHAT'S LOCKED (if blocked or free) */}
            {/* ================================================================ */}
            {(isBlocked || userPlanId === "free") && (
              <div style={S.card}>
                <h2 style={S.cardTitle}>🔒 Locked Features</h2>
                <p style={S.lockedSubtitle}>
                  {isBlocked
                    ? "These features are blocked due to payment issues:"
                    : "Upgrade to unlock these features:"}
                </p>
                
                <div style={S.lockedGrid}>
                  {(
                    !entitlements.recording &&
                    !currentPlan.features.recording
                  ) && (
                    <LockedFeature
                      icon="🎥"
                      title="Recording"
                      description="Record your streams and download them"
                      requiredPlan="Starter"
                    />
                  )}
                  {(
                    !entitlements.rtmpMultistream &&
                    !currentPlan.features.multistream
                  ) && (
                    <LockedFeature
                      icon="📡"
                      title="Multistream"
                      description="Stream to YouTube, Twitch, and Facebook simultaneously"
                      requiredPlan="Starter"
                    />
                  )}
                  {/* Editing Suite is not yet available; hide from locked features for now. */}
                  {currentPlan.limits.maxGuests < 10 && (
                    <LockedFeature
                      icon="👥"
                      title="More Guests"
                      description="Invite up to 10 guests to your streams"
                      requiredPlan="Pro"
                    />
                  )}
                </div>

                {userPlanId === "free" && !user?.billing?.hasHadTrial && (
                  <div style={S.lockedCta}>
                    <button onClick={() => startCheckout("starter_trial")} style={S.primaryBtn} disabled={!!actionLoading}>
                      🚀 Start Free Trial to Unlock
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ================================================================ */}
        {/* SECTION 3: MEDIA DEFAULTS */}
        {/* ================================================================ */}
        {activeTab === "defaults" && (
          <div style={{ ...S.card, opacity: isBlocked ? 0.6 : 1 }}>
            <div style={S.cardHeader}>
              <h2 style={S.cardTitle}>Media Defaults</h2>
              <span style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.15)", color: "#cbd5e1", fontSize: 12 }}>
                Plan: {entitlements.planName || currentPlan?.name || "Free"}
              </span>
            </div>

            <p style={{ color: "#94a3b8", marginTop: 4, marginBottom: 14, fontSize: 13 }}>
              These settings define how new streams and recordings behave by default.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
              {/* SECTION A — Quality (applies to everything) */}
              <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 12, background: "rgba(255,255,255,0.02)" }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Stream & Recording Quality</div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>
                  How good should it look?
                </div>
                <select
                  value={mediaPrefs.defaultPresetId}
                  onChange={(e) => setMediaPrefs((prev) => ({ ...prev, defaultPresetId: e.target.value }))}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "#0f172a", color: "#e2e8f0" }}
                >
                  {presetOptions.length === 0 && <option value="standard_720p30">Standard 720p30</option>}
                  {presetOptions.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
                <div style={{ marginTop: 6, fontSize: 12, color: "#94a3b8" }}>
                  Applies to live streaming and recordings. Plan limits may apply.
                </div>

                <div style={{ marginTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 10 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700 }}>
                    <input
                      type="checkbox"
                      checked={mediaPrefs.warnOnHighQuality}
                      onChange={(e) => setMediaPrefs((prev) => ({ ...prev, warnOnHighQuality: e.target.checked }))}
                    />
                    <span>Warn when using high-quality presets</span>
                  </label>
                  <div style={{ marginTop: 6, fontSize: 12, color: "#94a3b8" }}>
                    Shows a reminder before starting streams with higher resource usage.
                  </div>
                </div>
              </div>

              {/* SECTION B — Room Layout (single source of truth) */}
              <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 12, background: "rgba(255,255,255,0.02)" }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Room Layout (Default)</div>
                <div style={{ marginTop: 2, fontSize: 12, color: "#94a3b8" }}>
                  Controls how participants and viewers are arranged. Recordings automatically use this layout.
                </div>

                <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                  <label style={{ display: "grid", gap: 6, fontSize: 13, color: "#cbd5e1" }}>
                    <span style={{ fontWeight: 600, color: "#e2e8f0" }}>Layout Mode</span>
                    <select
                      value={mediaPrefs.defaultRoomLayout?.mode || "speaker"}
                      onChange={(e) => {
                        const mode = e.target.value as RoomLayoutMode;
                        setMediaPrefs((prev) => {
                          const prevLayout = (prev.defaultRoomLayout || ({ mode: "speaker" } as RoomLayout)) as RoomLayout;
                          const next: RoomLayout = {
                            ...prevLayout,
                            mode,
                            // Max tiles only applies to grid/carousel.
                            ...(mode === "grid" || mode === "carousel" ? {} : { maxTiles: undefined }),
                          };
                          return { ...prev, defaultRoomLayout: next };
                        });
                      }}
                      style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "#0f172a", color: "#e2e8f0" }}
                    >
                      {(["speaker", "grid", "carousel"] as const).map((m) => (
                        <option key={m} value={m}>
                          {m.charAt(0).toUpperCase() + m.slice(1)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <label style={{ display: "grid", gap: 6, fontSize: 13, color: "#cbd5e1" }}>
                      <span style={{ fontWeight: 600, color: "#e2e8f0" }}>Max tiles</span>
                      <input
                        type="number"
                        min={1}
                        max={64}
                        disabled={!(mediaPrefs.defaultRoomLayout?.mode === "grid" || mediaPrefs.defaultRoomLayout?.mode === "carousel")}
                        value={typeof mediaPrefs.defaultRoomLayout?.maxTiles === "number" ? String(mediaPrefs.defaultRoomLayout.maxTiles) : ""}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const next = raw === "" ? undefined : Number(raw);
                          setMediaPrefs((prev) => ({
                            ...prev,
                            defaultRoomLayout: {
                              ...(prev.defaultRoomLayout || ({ mode: "speaker" } as RoomLayout)),
                              maxTiles: Number.isFinite(next as any) ? (next as number) : undefined,
                            },
                          }));
                        }}
                        placeholder="Auto"
                        style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "#0f172a", color: "#e2e8f0", opacity: (mediaPrefs.defaultRoomLayout?.mode === "grid" || mediaPrefs.defaultRoomLayout?.mode === "carousel") ? 1 : 0.55 }}
                      />
                    </label>

                    <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#cbd5e1", paddingTop: 26 }}>
                      <input
                        type="checkbox"
                        checked={mediaPrefs.defaultRoomLayout?.followSpeaker === true}
                        onChange={(e) => {
                          setMediaPrefs((prev) => ({
                            ...prev,
                            defaultRoomLayout: {
                              ...(prev.defaultRoomLayout || ({ mode: "speaker" } as RoomLayout)),
                              followSpeaker: e.target.checked,
                            },
                          }));
                        }}
                      />
                      <span>Follow active speaker</span>
                    </label>
                  </div>

                  <label style={{ display: "grid", gap: 6, fontSize: 13, color: "#cbd5e1" }}>
                    <span style={{ fontWeight: 600, color: "#e2e8f0" }}>Pinned participant (optional)</span>
                    <input
                      type="text"
                      value={mediaPrefs.defaultRoomLayout?.pinnedIdentity || ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setMediaPrefs((prev) => ({
                          ...prev,
                          defaultRoomLayout: {
                            ...(prev.defaultRoomLayout || ({ mode: "speaker" } as RoomLayout)),
                            pinnedIdentity: v.trim() ? v : null,
                          },
                        }));
                      }}
                      placeholder="Participant identity (optional)"
                      style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "#0f172a", color: "#e2e8f0" }}
                    />
                    <div style={{ marginTop: 6, fontSize: 12, color: "#94a3b8" }}>
                      Keeps a specific participant visible by default.
                    </div>
                  </label>
                </div>
              </div>

              {/* SECTION C — Recording Behavior (storage & reliability) */}
              <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 12, background: "rgba(255,255,255,0.02)" }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Recording Storage</div>
                <select
                  value={mediaPrefs.defaultRecordingMode}
                  onChange={(e) => setMediaPrefs((prev) => ({ ...prev, defaultRecordingMode: e.target.value as "cloud" | "dual" }))}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: entitlements.dualRecording ? "#0f172a" : "rgba(15,23,42,0.6)", color: "#e2e8f0" }}
                >
                  <option value="cloud">Standard Recording (Cloud) — Recommended</option>
                  <option value="dual" disabled={!entitlements.dualRecording}>Redundant Recording (Cloud + Backup)</option>
                </select>
                <div style={{ marginTop: 8, fontSize: 12, color: "#94a3b8", display: "grid", gap: 6 }}>
                  <div>
                    <strong style={{ color: "#e2e8f0" }}>Standard Recording (Cloud):</strong> Saves a single finalized recording to the cloud. Uses less storage and is suitable for most streams.
                  </div>
                  <div>
                    <strong style={{ color: "#e2e8f0" }}>Redundant Recording (Cloud + Backup):</strong> Saves a cloud recording and an additional backup for recovery or editing. Uses more storage.
                  </div>
                </div>
                {!entitlements.dualRecording && (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#fbbf24" }}>
                    Dual recording not included on your plan.
                  </div>
                )}
              </div>

              {/* SECTION D — Defaults Behavior (implicit) */}
              <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 12, background: "rgba(255,255,255,0.02)" }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Defaults Behavior</div>
                <div style={{ fontSize: 12, color: "#94a3b8", display: "grid", gap: 8 }}>
                  <div>These defaults are applied automatically when creating new rooms and streams.</div>
                  <div>Destination selections reuse the most recent configuration unless changed during setup.</div>
                </div>
              </div>
            </div>

            {mediaPrefsError && (
              <div style={{ marginTop: 12, padding: 10, borderRadius: 8, border: "1px solid rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.12)", color: "#fecdd3" }}>
                {mediaPrefsError}
              </div>
            )}
            {mediaPrefsMessage && (
              <div style={{ marginTop: 12, padding: 10, borderRadius: 8, border: "1px solid rgba(34,197,94,0.4)", background: "rgba(34,197,94,0.12)", color: "#bbf7d0" }}>
                {mediaPrefsMessage}
              </div>
            )}

            <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 auto", minWidth: 220, alignSelf: "center", fontSize: 12, color: "#94a3b8" }}>
                Changes apply to newly created rooms and streams.
              </div>
              <button
                type="button"
                onClick={saveMediaPrefs}
                disabled={mediaPrefsSaving}
                style={{
                  padding: "10px 16px",
                  borderRadius: 10,
                  border: "1px solid rgba(239,68,68,0.6)",
                  background: mediaPrefsSaving ? "rgba(239,68,68,0.2)" : "linear-gradient(135deg, #dc2626, #ef4444)",
                  color: "#fff",
                  fontWeight: 700,
                  cursor: mediaPrefsSaving ? "not-allowed" : "pointer",
                }}
              >
                {mediaPrefsSaving ? "Saving..." : "Save Defaults"}
              </button>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* SECTION 5: USAGE THIS MONTH */}
        {/* ================================================================ */}
        {activeTab === "usage" && usage && (
          <div style={{ ...S.card, opacity: isBlocked ? 0.6 : 1 }}>
            <div style={S.cardHeader}>
              <h2 style={S.cardTitle}>📊 Usage This Month</h2>
              {user?.billing?.currentPeriodEnd && (
                <span style={S.resetDate}>
                  Resets {formatDate(user.billing.currentPeriodEnd)}
                </span>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 4 }}>
              <div style={{ color: "#e5e7eb", fontWeight: 600 }}>Plan entitlements</div>
              <div style={{
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.15)",
                color: "#cbd5e1",
                fontSize: 12,
              }}>
                {entitlements.planName || currentPlan?.name || "Plan"}
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
                marginTop: 8,
                marginBottom: 16,
              }}
            >
              {renderEntitlementPill(
                "Recording",
                entitlements.recording ? "Enabled" : "Disabled",
                entitlements.recording
              )}
              {renderEntitlementPill(
                "Dual Recording",
                entitlements.dualRecording ? "Cloud + Local" : "Cloud only",
                entitlements.dualRecording
              )}
              {renderEntitlementPill(
                "Multistream",
                entitlements.rtmpMultistream ? "Enabled" : "Single destination",
                entitlements.rtmpMultistream
              )}
              {renderEntitlementPill(
                "Guests",
                formatLimitLabel(entitlements.maxGuests, "guest"),
                entitlements.maxGuests !== 0
              )}
              {renderEntitlementPill(
                "Stream Destinations",
                formatLimitLabel(entitlements.maxDestinations, "stream destination"),
                entitlements.maxDestinations !== 0
              )}
              {renderEntitlementPill(
                "Monthly minutes",
                `${formatLimitLabel(entitlements.participantMinutes, "min")}${entitlements.participantMinutes > 0 ? "/mo" : ""}`,
                entitlements.participantMinutes !== 0
              )}
            </div>

            <div style={{ marginTop: 8, marginBottom: 12, padding: 12, border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, background: "rgba(255,255,255,0.02)" }}>
              <div style={{ fontWeight: 700, color: "#e5e7eb", marginBottom: 6 }}>Minutes Used (This Month)</div>
              <div style={{ color: "#cbd5e1", marginBottom: 4 }}>
                {usageLabels.inRoomMinutes}: <span style={{ color: "#fff", fontWeight: 700 }}>{usage.inRoomMinutes.used}</span> min
              </div>
              {getUsageGating(user).canShowBroadcastMinutes && (
                <div style={{ color: "#cbd5e1", marginBottom: 4 }}>
                  {usageLabels.broadcastMinutes}: <span style={{ color: "#fff", fontWeight: 700 }}>{usage.broadcastMinutes.used}</span> min
                </div>
              )}
              <div style={{ color: "#cbd5e1", marginBottom: 6 }}>
                Recording: <span style={{ color: "#fff", fontWeight: 700 }}>{usage.recordingMinutes.used}</span> min
              </div>
              <div style={{ color: "#cbd5e1", marginBottom: 6 }}>
                <div style={{ fontWeight: 700, color: "#e5e7eb", marginBottom: 2 }}>Overage (this month)</div>
                <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 4 }}>
                  Minutes used beyond the plan’s included limits.
                </div>
                <span style={{ color: "#fff", fontWeight: 700 }}>
                  {Number(usage.overages?.participantMinutes ?? 0) + Number(usage.overages?.transcodeMinutes ?? 0)}
                </span>
                {" "}min
                <span style={{ color: "#94a3b8", fontSize: 12 }}>
                  {" "}(in-room: {Number(usage.overages?.participantMinutes ?? 0)} / broadcast: {Number(usage.overages?.transcodeMinutes ?? 0)})
                </span>
              </div>
              <div style={{ color: "#94a3b8", fontSize: 12 }}>
                {usageTooltips.inRoomMinutes} {usageTooltips.broadcastMinutes}
              </div>
              <div style={{ color: "#94a3b8", fontSize: 12 }}>Recording minutes are included in your total usage.</div>
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setShowLifetimeDetails((prev) => !prev)}
                  style={{
                    background: "transparent",
                    border: "1px solid rgba(255,255,255,0.15)",
                    color: "#cbd5e1",
                    padding: "6px 10px",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  {showLifetimeDetails ? "Hide lifetime details" : "Show lifetime details"}
                </button>
              </div>
              {showLifetimeDetails && (
                <div style={{ marginTop: 8, color: "#cbd5e1", fontSize: 13 }}>
                  <div>Lifetime in-room minutes: <span style={{ color: "#fff", fontWeight: 700 }}>{usage.inRoomMinutes.lifetime ?? 0}</span> min</div>
                  {getUsageGating(user).canShowBroadcastMinutes && (
                    <div>Lifetime broadcast minutes: <span style={{ color: "#fff", fontWeight: 700 }}>{usage.broadcastMinutes.lifetime ?? 0}</span> min</div>
                  )}
                  <div>Lifetime recording minutes: <span style={{ color: "#fff", fontWeight: 700 }}>{usage.recordingMinutes.lifetime}</span> min</div>
                </div>
              )}
            </div>

            {(() => {
              const eff = (user as any)?.effectiveEntitlements;
              const planId = String(eff?.planId || "").trim();
              const overagesAllowed = eff?.features?.overagesAllowed === true;
              const canShowOveragesToggle = planId === "pro" || overagesAllowed;
              if (!canShowOveragesToggle) return null;

              const enabled = Boolean((user as any)?.billingSettings?.overagesEnabled);

              return (
                <div style={{
                  marginTop: 8,
                  marginBottom: 12,
                  padding: 12,
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.02)",
                }}>
                  <div style={{ fontWeight: 800, color: "#e5e7eb", marginBottom: 4 }}>Overages</div>
                  <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 10 }}>
                    $10 per additional 100 minutes — billed automatically after your stream ends.
                  </div>

                  <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700, color: "#e5e7eb" }}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={overagesToggleSaving}
                      onChange={(e) => setOveragesEnabled(e.target.checked)}
                    />
                    <span>{enabled ? "Enabled" : "Disabled"}</span>
                  </label>

                  <div style={{ marginTop: 6, color: "#94a3b8", fontSize: 12 }}>
                    Applies to in-room minutes over your plan limit.
                  </div>

                  {overagesToggleMessage && (
                    <div style={{
                      marginTop: 10,
                      padding: 10,
                      borderRadius: 8,
                      border: "1px solid rgba(239,68,68,0.4)",
                      background: "rgba(239,68,68,0.12)",
                      color: "#fecdd3",
                      fontSize: 13,
                    }}>
                      {overagesToggleMessage}
                    </div>
                  )}
                </div>
              );
            })()}

            <div style={S.usageGrid}>
              <UsageBar
                label={usageLabels.inRoomMinutes}
                used={usage.inRoomMinutes.used}
                limit={
                  usage.inRoomMinutes.limit ||
                  currentPlan.limits?.monthlyMinutesIncluded ||
                  0
                }
                unit="min"
              />
              {getUsageGating(user).canShowBroadcastMinutes && (
                <UsageBar
                  label={usageLabels.broadcastMinutes}
                  used={usage.broadcastMinutes.used}
                  limit={
                    usage.broadcastMinutes.limit ||
                    0
                  }
                  unit="min"
                />
              )}
              <UsageBar
                label="Stream Destinations"
                used={usage.rtmpDestinations.used}
                limit={
                  entitlements.maxDestinations ??
                  usage.rtmpDestinations.limit ??
                  currentPlan.limits?.rtmpDestinationsMax ??
                  0
                }
                unit=""
              />
              {(isPaidValid || usage.storage.limit > 0) && (
                <UsageBar
                  label="Storage"
                  used={usage.storage.used}
                  limit={usage.storage.limit || currentPlan.editing?.maxStorageGB || 0}
                  unit="GB"
                />
              )}
              {(isPaidValid || usage.projects.limit > 0) && (
                <UsageBar
                  label="Projects"
                  used={usage.projects.used}
                  limit={usage.projects.limit || currentPlan.editing?.maxProjects || 0}
                  unit=""
                />
              )}
            </div>

            <div style={{ marginTop: 16, padding: 12, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, background: "rgba(255,255,255,0.02)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ color: "#e5e7eb", fontWeight: 600 }}>Emergency Download (Latest Recording)</div>
                <button
                  type="button"
                  onClick={handleEmergencyDownload}
                  disabled={emergencyLoading}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "1px solid rgba(239, 68, 68, 0.6)",
                    background: emergencyLoading ? "rgba(239, 68, 68, 0.2)" : "rgba(239, 68, 68, 0.15)",
                    color: "#fecaca",
                    cursor: emergencyLoading ? "not-allowed" : "pointer",
                    fontWeight: 600,
                  }}
                >
                  {emergencyLoading ? "Preparing..." : "Download latest recording"}
                </button>
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: "#9ca3af" }}>
                Only one emergency recording is stored at a time.
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: "#9ca3af" }}>
                Expires in {emergencyCountdown || "—"}
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: "#9ca3af" }}>
                This emergency download link expires in 1 hour. After that, the recording is automatically deleted.
              </div>
              {emergencyMessage && (
                <div style={{ marginTop: 6, fontSize: 12, color: "#fca5a5" }}>{emergencyMessage}</div>
              )}
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* SECTION 4: DESTINATIONS / STREAM KEYS */}
        {/* ================================================================ */}
        {activeTab === "destinations" && platformTranscodeEnabled !== false && (
          <div style={{ marginTop: 16 }}>
            <SettingsDestinations
              locked={Number(entitlements.maxDestinations ?? 0) < 1}
              lockReason="Stream Destinations are not included in your current plan."
              onUpgrade={() => setActiveTab("plan")}
            />
          </div>
        )}

        {/* ================================================================ */}
        {/* SECTION 5: CLOSE ACCOUNT */}
        {/* ================================================================ */}
        {activeTab === "close" && (
          <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
            <div style={S.card}>
              <div style={S.cardHeader}>
                <h2 style={S.cardTitle}>Close Account</h2>
              </div>
              <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.5 }}>
                Manage cancellation and account deletion. Cancellation keeps access until the end of the current billing period.
              </div>

              <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={cancelSubscription}
                  disabled={closeCancelLoading}
                  style={{
                    ...S.primaryBtn,
                    opacity: closeCancelLoading ? 0.8 : 1,
                  }}
                >
                  {closeCancelLoading ? "Cancelling..." : "Cancel subscription (period end)"}
                </button>
              </div>

              <div style={{ marginTop: 10, fontSize: 12, color: "#64748b" }}>
                If you don't have an active subscription, this will no-op.
              </div>
            </div>

            <div
              style={{
                ...S.card,
                border: "1px solid rgba(239, 68, 68, 0.35)",
                background: "rgba(239, 68, 68, 0.05)",
              }}
            >
              <div style={S.cardHeader}>
                <h2 style={{ ...S.cardTitle, color: "#fecaca" }}>Delete Account</h2>
              </div>
              <div style={{ color: "#fca5a5", fontSize: 13, lineHeight: 1.5 }}>
                This immediately locks you out. Your data is scheduled for purge after 7 days.
              </div>

              <div style={{ marginTop: 6, color: "#fecaca", fontSize: 12, fontWeight: 800 }}>
                Deleting your account cancels billing and permanently removes your content after 7 days.
              </div>

              <div style={{ marginTop: 12, display: "grid", gap: 10, maxWidth: 520 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 10, color: "#fee2e2", fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={closeDeleteConfirmed}
                    onChange={(e) => setCloseDeleteConfirmed(e.target.checked)}
                  />
                  I understand this will immediately lock me out
                </label>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, color: "#fecaca", fontWeight: 700 }}>Type DELETE to confirm</div>
                  <input
                    value={closeDeleteText}
                    onChange={(e) => setCloseDeleteText(e.target.value)}
                    placeholder="DELETE"
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid rgba(239, 68, 68, 0.45)",
                      background: "rgba(2,6,23,0.6)",
                      color: "#fff",
                      outline: "none",
                      fontSize: 14,
                    }}
                  />
                </div>

                <button
                  type="button"
                  onClick={deleteAccount}
                  disabled={closeDeleteLoading}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "1px solid rgba(239, 68, 68, 0.7)",
                    background: closeDeleteLoading ? "rgba(239, 68, 68, 0.18)" : "rgba(239, 68, 68, 0.12)",
                    color: "#fecaca",
                    cursor: closeDeleteLoading ? "not-allowed" : "pointer",
                    fontWeight: 800,
                    letterSpacing: 0.2,
                  }}
                >
                  {closeDeleteLoading ? "Deleting..." : "Delete account"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Test Mode Plan Switch Modal */}
      {testModeModalOpen && (
        <div
          onClick={closeTestModeModal}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 480,
              background: "#020617",
              border: "1px solid #1f2937",
              borderRadius: 16,
              padding: 20,
              boxShadow: "0 18px 60px rgba(0,0,0,0.75)",
            }}
          >
            <h3 style={{ margin: 0, marginBottom: 8, fontSize: 18 }}>Switch plan in Test Mode?</h3>
            <p style={{ marginTop: 0, marginBottom: 12, color: "#9ca3af", fontSize: 14 }}>
              Billing is disabled for this account. This will simulate switching to the
              {" "}
              <strong>{targetPlanName || "selected"}</strong>
              {" "}
              plan so you can test its limits. No Stripe charges or real billing changes will occur.
            </p>
            <p style={{ marginTop: 0, marginBottom: 16, color: "#6b7280", fontSize: 12 }}>
              After confirming, your entitlements and usage views will refresh automatically.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                onClick={closeTestModeModal}
                style={{
                  ...S.secondaryBtn,
                  padding: "10px 18px",
                }}
                disabled={testModeLoading}
              >
                Cancel
              </button>
              <button
                onClick={confirmTestPlanChange}
                style={{
                  ...S.primaryBtn,
                  padding: "10px 18px",
                  opacity: testModeLoading ? 0.8 : 1,
                }}
                disabled={testModeLoading}
              >
                {testModeLoading ? "Switching..." : "Confirm Switch"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage Picker Modal */}
      {showManagePicker && (
        <div
          onClick={() => setShowManagePicker(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 520,
              background: "#0b0b0c",
              border: "1px solid #27272a",
              borderRadius: 16,
              padding: 20,
              boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>Choose a plan to get started</h3>
              <button onClick={() => setShowManagePicker(false)} style={{ background: "transparent", border: 0, color: "#a1a1aa", fontSize: 18, cursor: "pointer" }}>×</button>
            </div>
            <p style={{ color: "#a1a1aa", marginTop: 0, marginBottom: 16 }}>You don't have a billing profile yet. Pick a plan and we'll create one for you.</p>

            {(() => {
              const trialEligible = !(user?.hasHadTrial || user?.billing?.hasHadTrial);
              const starterPlan = plans.find((p) => canonicalPlanId(p.id) === "starter");
              const proPlan = plans.find((p) => canonicalPlanId(p.id) === "pro");
              return (
                <div style={{ display: "grid", gap: 12 }}>
                  {trialEligible && (
                    <button
                      onClick={() => startCheckout("starter_trial")}
                      style={{
                        ...S.planUpgradeBtn,
                        background: "linear-gradient(135deg,#22c55e,#16a34a)",
                        border: 0,
                      }}
                      disabled={!!actionLoading}
                    >
                      {actionLoading === "starter_trial" ? "⏳ Starting Trial..." : "🚀 Start Starter Trial"}
                    </button>
                  )}

                  <button
                    onClick={() => startCheckout("starter_paid")}
                    style={{
                      ...S.planUpgradeBtn,
                      background: "linear-gradient(135deg,#3b82f6,#2563eb)",
                      border: 0,
                    }}
                    disabled={!!actionLoading}
                  >
                    {actionLoading === "starter_paid"
                      ? "⏳ Redirecting..."
                      : `Starter — $${(starterPlan as any)?.priceMonthly ?? starterPlan?.price ?? "—"}/mo`}
                  </button>

                  <button
                    onClick={() => startCheckout("pro")}
                    style={{
                      ...S.planUpgradeBtn,
                      background: "linear-gradient(135deg,#8b5cf6,#7c3aed)",
                      border: 0,
                    }}
                    disabled={!!actionLoading}
                  >
                    {actionLoading === "pro"
                      ? "⏳ Redirecting..."
                      : `Pro — $${(proPlan as any)?.priceMonthly ?? proPlan?.price ?? "—"}/mo`}
                  </button>

                  <button
                    onClick={() => setShowManagePicker(false)}
                    style={{
                      ...S.secondaryBtn,
                      width: "100%",
                      marginTop: 4,
                    }}
                  >
                    Cancel
                  </button>
                </div>
              );
            })()}

          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            background: "rgba(22,163,74,0.98)",
            color: "#ecfdf5",
            padding: "10px 16px",
            borderRadius: 999,
            fontSize: 14,
            fontWeight: 600,
            boxShadow: "0 12px 30px rgba(22,163,74,0.6)",
            zIndex: 1200,
          }}
        >
          ✓ {toast}
        </div>
      )}

      {/* styles moved to SettingsBilling.css */}
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function UsageBar({ label, used, limit, unit }: { label: string; used: number; limit: number; unit: string }) {
  const percent = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const isWarning = percent > 80;
  const isDanger = percent > 95;

  return (
    <div style={S.usageItem}>
      <div style={S.usageHeader}>
        <span style={S.usageLabel}>{label}</span>
        <span style={S.usageValue}>
          {used}{unit} / {limit}{unit}
        </span>
      </div>
      <div style={S.usageTrack}>
        <div
          style={{
            ...S.usageFill,
            width: `${percent}%`,
            background: isDanger
              ? "linear-gradient(90deg, #ef4444, #dc2626)"
              : isWarning
                ? "linear-gradient(90deg, #f59e0b, #d97706)"
                : "linear-gradient(90deg, #22c55e, #16a34a)",
          }}
        />
      </div>
    </div>
  );
}

function FeatureRow({
  label,
  value,
  pill = false,
  subBullets,
  lockedText,
}: {
  label: string;
  value: boolean | number | string | undefined;
  pill?: boolean;
  subBullets?: string[];
  lockedText?: string;
}) {
  const isBoolean = typeof value === "boolean";
  const isLocked = !pill && isBoolean && value === false && !!lockedText;
  const isIncluded = isBoolean
    ? value
    : typeof value === "string"
      ? (() => {
          const lower = value.toLowerCase();
          if (lower.startsWith("not included")) return false;
          return lower.startsWith("include");
        })()
      : false;
  const displayValue = pill
    ? (isIncluded ? "✓" : "—")
    : (isBoolean ? (value ? "✓" : (isLocked ? "🔒" : "—")) : value?.toString() || "—");
  const isEnabled = pill ? isIncluded : (value === true || (typeof value === "number" && value > 0) || (typeof value === "string" && value !== "—"));
  const effectiveSubBullets = isLocked ? [lockedText!] : subBullets;

  return (
    <li style={{ ...S.featureItem, opacity: isEnabled ? 1 : 0.5 }} title={isLocked ? lockedText : undefined}>
      <span style={S.featureLabel}>{label}</span>
      <span
        style={
          pill
            ? {
                color: isIncluded ? "#22c55e" : "#6b7280",
                fontWeight: 700,
                fontSize: 12,
              }
            : { ...S.featureValue, color: isEnabled ? "#22c55e" : "#6b7280" }
        }
      >
        {displayValue}
      </span>
      {effectiveSubBullets && effectiveSubBullets.length > 0 && (
        <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "#94a3b8", fontSize: 12, lineHeight: 1.5 }}>
          {effectiveSubBullets.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

function LockedFeature({ icon, title, description, requiredPlan }: { icon: string; title: string; description: string; requiredPlan: string }) {
  return (
    <div style={S.lockedItem}>
      <div style={S.lockedIcon}>{icon}</div>
      <div>
        <div style={S.lockedTitle}>{title}</div>
        <div style={S.lockedDesc}>{description}</div>
        <div style={S.lockedRequired}>Requires {requiredPlan}+</div>
      </div>
    </div>
  );
};

// ============================================================================
// STYLES
// ============================================================================


// Styles moved to external files: SettingsBilling.styles.ts and SettingsBilling.css