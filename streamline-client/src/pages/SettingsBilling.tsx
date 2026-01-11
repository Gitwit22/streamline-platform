


import React, { useEffect, useState } from "react";
import { PLAN_IDS, PlanId, isPlanId } from "../lib/planIds";
import { useLocation, useNavigate } from "react-router-dom";
import "./SettingsBilling.css";
import { S } from "./SettingsBilling.styles";
import SettingsDestinations from "./SettingsDestinations";
import { apiFetch } from "../lib/api";
import { useAuthMe, isAuthUserInTestMode } from "../hooks/useAuthMe";
import { formatLimitLabel } from "../lib/entitlements";

const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

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
  moderator: {
    label: "Moderator",
    permissions: {
      canStream: false,
      canRecord: false,
      canDestinations: false,
      canModerate: true,
      canLayout: true,
      canScreenShare: false,
      canInvite: false,
      canAnalytics: false,
    },
  },
  cohost: {
    label: "Co-host",
    permissions: {
      canStream: false,
      canRecord: false,
      canDestinations: false,
      canModerate: false,
      canLayout: true,
      canScreenShare: true,
      canInvite: false,
      canAnalytics: false,
    },
    expiresHours: 24,
    maxUses: 1,
  },
};

// ============================================================================
// TYPES
// ============================================================================

interface BillingInfo {
  provider?: string;
  customerId?: string;
  subscriptionId?: string;
  priceId?: string;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: number;
  updatedAt?: number;
  hasHadTrial?: boolean;
}

interface UserData {
  id: string;
  email?: string;
  displayName?: string;
  planId: string;
  pendingPlan?: string | null;
  billingStatus?: string;
  billingActive?: boolean;
  billing?: BillingInfo;
  hasHadTrial?: boolean;
  billingEnabled?: boolean;
  billingMode?: "test" | "live";
}

interface PlanDefinition {
  id: string;
  name: string;
  price: number;
  description?: string;
  limits: {
    monthlyMinutesIncluded: number;
    maxGuests: number;
    rtmpDestinationsMax: number;
    maxSessionMinutes: number;
    maxHoursPerMonth: number;
  };
  features: {
    recording: boolean;
    rtmp: boolean;
    multistream?: boolean;
    advancedPermissions?: boolean;
  };
  editing?: {
    access: boolean;
    maxProjects: number;
    maxStorageGB: number;
  };
}

interface UsageData {
  streamingMinutes: { used: number; limit: number; lifetime?: number };
  recordingMinutes: { used: number; lifetime: number };
  rtmpDestinations: { used: number; limit: number };
  storage: { used: number; limit: number };
  projects: { used: number; limit: number };
}

interface Entitlements {
  planId: string;
  planName?: string;
  recording: boolean;
  dualRecording: boolean;
  rtmpMultistream: boolean;
  maxGuests: number;
  maxDestinations: number;
  participantMinutes: number;
  transcodeMinutes: number;
}

interface MediaPrefs {
  defaultLayout: "speaker" | "grid";
  defaultRecordingMode: "cloud" | "dual";
  defaultPresetId: string;
  warnOnHighQuality: boolean;
  destinationsDefaultMode: "last_used" | "pick_each_time";
  autoClamp?: boolean;
  permissionsMode?: "simple" | "advanced";
}

interface AdvancedPermissionsState {
  enabled: boolean;
  plan: boolean;
  override: boolean;
  globalLock?: boolean;
  lockReason?: string | null;
  effectivePermissionsMode?: "simple" | "advanced";
  permissionsModeLockReason?: string | null;
}

// Plans are loaded from the API; no hardcoded defaults to keep the DB/admin as source of truth.


// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function formatDate(timestamp: number | undefined): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getDaysUntil(timestamp: number | undefined): number {
  if (!timestamp) return 0;
  const now = Date.now();
  const diff = timestamp - now;
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function getStatusBadge(status: string | undefined, cancelAtPeriodEnd?: boolean): { text: string; color: string; bg: string; icon: string } {
  if (cancelAtPeriodEnd && (status === "active" || status === "trialing")) {
    return { text: "Canceling", color: "#f59e0b", bg: "rgba(245,158,11,0.15)", icon: "⏳" };
  }
  switch (status) {
    case "active":
      return { text: "Active", color: "#22c55e", bg: "rgba(34,197,94,0.15)", icon: "✓" };
    case "trialing":
      return { text: "Trial", color: "#3b82f6", bg: "rgba(59,130,246,0.15)", icon: "🧪" };
    case "past_due":
      return { text: "Past Due", color: "#ef4444", bg: "rgba(239,68,68,0.15)", icon: "⚠️" };
    case "unpaid":
      return { text: "Unpaid", color: "#ef4444", bg: "rgba(239,68,68,0.15)", icon: "⛔" };
    case "canceled":
      return { text: "Canceled", color: "#6b7280", bg: "rgba(107,114,128,0.15)", icon: "✕" };
    default:
      return { text: "Free", color: "#6b7280", bg: "rgba(107,114,128,0.15)", icon: "○" };
  }
}
// Button label logic (frontend-only)
function getPlanActionLabel(
  currentPlan: string,
  targetPlan: "free" | "starter" | "basic" |"pro",
  isProcessing: boolean
) {
  // Normalize variants to canonical plan ids
  const plan =
    currentPlan === "starter_paid" || currentPlan === "starter_trial"
      ? "starter"
      : currentPlan;

  // Current plan label
  if (plan === targetPlan) return "Current";

  // Moving to Free is managed in portal; keep label readable
  if ((plan === "pro" || plan === "starter") && targetPlan === "free") return "Manage";

  // For all other non-current targets, prefer a simple CTA
  return "Choose Plan";
}


// Map canonical plan id to checkout variant for resubscribe
type CheckoutPlanVariant = "starter_paid" | "starter_trial" | "pro" | "basic";

// Loading state key for actions like checkout and portal
type ActionLoading = CheckoutPlanVariant | "portal" | null;

function checkoutPlanForResubscribe(user: any): CheckoutPlanVariant {
  const p = getCanonicalPlanId(user); // expected: "free" | "starter" | "pro" | ...
  if (p === "pro" || p === "internal_unlimited") return "pro";
  // default resubscribe goes to paid Starter
  return "starter_paid";
}


// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function SettingsBilling() {
  const nav = useNavigate();
  const location = useLocation();
  const { refresh: refreshAuth } = useAuthMe();

  
  const DEFAULT_USAGE: UsageData = {
    streamingMinutes: { used: 0, limit: 60, lifetime: 0 },
    recordingMinutes: { used: 0, lifetime: 0 },
    rtmpDestinations: { used: 0, limit: 1 },
    storage: { used: 0, limit: 5 },
    projects: { used: 0, limit: 1 },
  };

  const DEFAULT_ENTITLEMENTS: Entitlements = {
    planId: "free",
    planName: "Free",
    recording: false,
    dualRecording: false,
    rtmpMultistream: false,
    maxGuests: 1,
    maxDestinations: 1,
    participantMinutes: 60,
    transcodeMinutes: 0,
  };

  const DEFAULT_MEDIA_PREFS: MediaPrefs = {
    defaultLayout: "speaker",
    defaultRecordingMode: "cloud",
    defaultPresetId: "standard_720p30",
    warnOnHighQuality: true,
    destinationsDefaultMode: "last_used",
    autoClamp: true,
    permissionsMode: "simple",
  };

  const [user, setUser] = useState<UserData | null>(null);
  const [plans, setPlans] = useState<PlanDefinition[]>([]);
  const [usage, setUsage] = useState<UsageData>(DEFAULT_USAGE);
  const [showLifetimeDetails, setShowLifetimeDetails] = useState(false);
  const [entitlements, setEntitlements] = useState<Entitlements>(DEFAULT_ENTITLEMENTS);
  const [mediaPrefs, setMediaPrefs] = useState<MediaPrefs>(DEFAULT_MEDIA_PREFS);
  const [advancedPermissions, setAdvancedPermissions] = useState<AdvancedPermissionsState>({ enabled: false, plan: false, override: false, globalLock: false, lockReason: null, effectivePermissionsMode: "simple", permissionsModeLockReason: null });
  const [presetOptions, setPresetOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [mediaPrefsSaving, setMediaPrefsSaving] = useState(false);
  const [mediaPrefsMessage, setMediaPrefsMessage] = useState<string | null>(null);
  const [mediaPrefsError, setMediaPrefsError] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<ActionLoading>(null);
  const [error, setError] = useState<string | null>(null);
  const [showManagePicker, setShowManagePicker] = useState(false);
  const [activeTab, setActiveTab] = useState<"plan" | "usage" | "destinations" | "defaults" | "roles">("plan");
  const [cohostProfile, setCohostProfile] = useState({
    label: "Co-Host",
    canStream: false,
    canRecord: false,
    canDestinations: false,
    canModerate: false,
    canLayout: false,
    canScreenShare: false,
    canInvite: false,
    canAnalytics: false,
    expiresHours: 24,
    maxUses: 1,
  });
  const [roleProfiles, setRoleProfiles] = useState<any[]>([]);
  const [quickRoleIds, setQuickRoleIds] = useState<string[]>([]);
  const [roleLabelInput, setRoleLabelInput] = useState("");
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<any | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [roleMessage, setRoleMessage] = useState<string | null>(null);
  const [cohostSaving, setCohostSaving] = useState(false);
  const [cohostMessage, setCohostMessage] = useState<string | null>(null);
  const [emergencyLoading, setEmergencyLoading] = useState(false);
  const [emergencyMessage, setEmergencyMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [testModeTargetPlan, setTestModeTargetPlan] = useState<PlanId | null>(null);
  const [testModeModalOpen, setTestModeModalOpen] = useState(false);
  const [testModeLoading, setTestModeLoading] = useState(false);
  const [testModeSummary, setTestModeSummary] = useState<string | null>(null);
  const effectivePermissionsMode = advancedPermissions.effectivePermissionsMode || ((advancedPermissions.enabled && (mediaPrefs.permissionsMode ?? "simple") === "advanced") ? "advanced" : "simple");
  const simpleMode = effectivePermissionsMode === "simple";
  useEffect(() => {
    loadAllData();
  }, []);

  // Sync tab from URL query (?tab=destinations|plan|usage) so deep links open the correct view
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get("tab");
    if (tabParam === "plan" || tabParam === "usage" || tabParam === "destinations" || tabParam === "defaults" || tabParam === "roles") {
      setActiveTab(tabParam as any);
    }
  }, [location.search]);

  // Safe pending cleanup: only clear under safe conditions
  useEffect(() => {
    (async () => {
      if (!user?.pendingPlan) return;
      try {
        const res = await apiFetch(`${API_BASE}/api/billing/pending-change`);
        const info = await res.json();
        const isFreeNoSub = user.planId === "free" && !info?.hasSubscription && !info?.billingActive;
        const noScheduled = info?.scheduledChange === false;
        const completed = user.billingStatus === "active" || user.billingStatus === "trialing";
        if (isFreeNoSub || noScheduled || completed) {
          try {
            await apiFetch(`${API_BASE}/api/billing/clear-pending`, { method: "POST" });
          } catch {}
          setUser((prev) => (prev ? { ...prev, pendingPlan: null } : prev));
        }
      } catch {}
    })();
  }, [user?.planId, user?.pendingPlan, user?.billingStatus]);

  // If billing is active or trialing, ensure pendingPlan is cleared to avoid stuck UI
  useEffect(() => {
    if (!user) return;
    if ((user.billingStatus === "active" || user.billingStatus === "trialing") && user.pendingPlan) {
      setUser((prev) => (prev ? { ...prev, pendingPlan: null } : prev));
    }
  }, [user?.billingStatus]);

  // Reset transient actionLoading when page regains visibility (e.g., returning from Stripe)
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        setActionLoading(null);
        // Refresh data to clear any stale pendingPlan
        loadAllData();
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
      await Promise.all([loadUser(), loadPlans(), loadUsage(), loadEntitlements(), loadMediaPrefs(), loadCohostProfile(), loadRoles()]);
    } catch (err: any) {
      setError(err?.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  const loadUser = async () => {
    const res = await apiFetch(`${API_BASE}/api/auth/me`);
    const data = await res.json();
    setUser(data);
    try {
      window.localStorage.setItem("sl_user", JSON.stringify(data));
      if ((data as any)?.id || (data as any)?.uid) {
        window.localStorage.setItem("sl_userId", String((data as any).id || (data as any).uid));
      }
    } catch {}
  };

  const loadPlans = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/plans`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
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
      const res = await apiFetch(`${API_BASE}/api/account/me`);
      if (!res.ok) {
        throw new Error("account/me failed");
      }
      const data = await res.json();

      const eff = (data as any)?.effectiveEntitlements;

      if (eff && typeof eff === "object") {
        const features = eff.features || {};
        const limits = eff.limits || {};
        setEntitlements({
          planId: eff.planId || data.planId || "free",
          planName: eff.planName || data.planId || eff.planId || "Free",
          recording: !!features.recording,
          dualRecording: !!features.dualRecording,
          rtmpMultistream: !!features.rtmpMultistream,
          maxGuests: Number(limits.maxGuests ?? 0),
          maxDestinations: Number(limits.maxDestinations ?? 0),
          participantMinutes: Number(limits.participantMinutes ?? 0),
          transcodeMinutes: Number(limits.transcodeMinutes ?? 0),
        });
        return;
      }

      // Fallback: legacy usage entitlements endpoint
      const legacyRes = await apiFetch(`${API_BASE}/api/usage/entitlements`);
      if (!legacyRes.ok) throw new Error("usage/entitlements failed");
      const legacy = await legacyRes.json();
      setEntitlements({
        planId: legacy?.planId || "free",
        planName: legacy?.planName || legacy?.planId || "Free",
        recording: !!legacy?.recording,
        dualRecording: !!legacy?.dualRecording,
        rtmpMultistream: !!legacy?.rtmpMultistream,
        maxGuests: Number(legacy?.maxGuests ?? 0),
        maxDestinations: Number(legacy?.maxDestinations ?? 0),
        participantMinutes: Number(legacy?.participantMinutes ?? 0),
        transcodeMinutes: Number(legacy?.transcodeMinutes ?? 0),
      });
    } catch (err) {
      console.warn("loadEntitlements failed; using defaults", err);
      setEntitlements((prev) => prev || DEFAULT_ENTITLEMENTS);
    }
  };

 
  const loadUsage = async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/usage/me`);
      const data = await res.json();
      const limits = data?.plan?.limits || {};

      const usageMonthly = data?.usageMonthly || {};
      const usageInner = usageMonthly.usage || {};
      const usageWrapper = data?.usage || {};
      const usageMinutes = usageWrapper.minutes || usageInner.minutes || {};
      // Fallback to legacy hours on user.usage if monthly doc not present
      const legacyHours = Number(data?.user?.usage?.hoursStreamedThisMonth || 0);
      const legacyMinutes = Math.max(0, Math.round(legacyHours * 60));
      const participantUsed = Number(usageMonthly.participantMinutes ?? usageInner.participantMinutes ?? legacyMinutes ?? 0);

      const liveCurrent = Number(
        usageMinutes.live?.currentPeriod ?? usageInner.minutes?.live?.currentPeriod ?? participantUsed
      );
      const liveLifetime = Number(
        usageMinutes.live?.lifetime ??
        usageMonthly?.ytd?.minutes?.live?.lifetime ??
        usageInner.minutes?.live?.lifetime ??
        usageMonthly?.ytd?.participantMinutes ??
        participantUsed
      );
      const recordingCurrent = Number(
        usageMinutes.recording?.currentPeriod ?? usageInner.minutes?.recording?.currentPeriod ?? 0
      );
      const recordingLifetime = Number(
        usageMinutes.recording?.lifetime ??
        usageMonthly?.ytd?.minutes?.recording?.lifetime ??
        usageInner.minutes?.recording?.lifetime ??
        0
      );

      setUsage({
        streamingMinutes: {
          used: liveCurrent,
          limit: Number(limits.participantMinutes ?? 0) || (data?.plan?.id === "pro" ? 1200 : data?.plan?.id === "starter" ? 300 : 60),
          lifetime: liveLifetime,
        },
        recordingMinutes: {
          used: recordingCurrent,
          lifetime: recordingLifetime,
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
      const [presetsRes, meRes] = await Promise.all([
        fetch(`${API_BASE}/api/account/presets`, { credentials: "include" }),
        fetch(`${API_BASE}/api/account/me`, { credentials: "include" }),
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

      if (meRes.ok) {
        try {
          const me = await meRes.json();
          const prefs = me?.mediaPrefs ? { ...DEFAULT_MEDIA_PREFS, ...me.mediaPrefs } : DEFAULT_MEDIA_PREFS;
          const adv = me?.advancedPermissions || { enabled: false, plan: false, override: false, global: false, lockReason: me?.advancedPermissionsLockedReason };
          setAdvancedPermissions({
            enabled: !!adv.enabled,
            plan: !!adv.plan,
            override: !!adv.override,
            globalLock: !!adv.global,
            lockReason: adv.lockReason || me?.advancedPermissionsLockedReason || null,
            effectivePermissionsMode: me?.effectivePermissionsMode || (adv.enabled && prefs.permissionsMode === "advanced" ? "advanced" : "simple"),
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
        } catch (err) {
          console.error("Failed to parse /account/me", err);
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
      const res = await fetch(`${API_BASE}/api/account/cohost-profile`, { credentials: "include" });
      if (!res.ok) throw new Error("cohost profile endpoint failed");
      const data = await res.json();
      if (data?.profile) {
        setCohostProfile((prev) => ({ ...prev, ...data.profile }));
      }
    } catch (err) {
      console.warn("loadCohostProfile failed; using defaults", err);
    }
  };

  const applySimpleRoleDefaults = () => {
    const simpleList = ["participant", "cohost", "moderator"].map((key) => {
      const roleKey = key as keyof typeof SIMPLE_ROLE_DEFAULTS;
      const def = SIMPLE_ROLE_DEFAULTS[roleKey];
      return {
        id: key,
        label: def.label,
        system: true,
        lockedName: true,
        permissions: def.permissions,
      };
    });
    setRoleProfiles(simpleList);
    setQuickRoleIds(["participant", "cohost", "moderator"]);
  };

  const loadRoles = async () => {
    try {
      if ((mediaPrefs.permissionsMode ?? "simple") === "simple") {
        applySimpleRoleDefaults();
        return;
      }
      const res = await fetch(`${API_BASE}/api/account/roles`, { credentials: "include" });
      if (!res.ok) throw new Error("roles endpoint failed");
      const data = await res.json();
      if (Array.isArray(data?.roles)) {
        setRoleProfiles(data.roles);
        if (!selectedRoleId && data.roles.length) {
          const preferred = data.roles.find((r: any) => r.id === "cohost" || r.slug === "cohost") || data.roles[0];
          setSelectedRoleId(preferred?.id || null);
        }
      }
      if (Array.isArray(data?.quickRoleIds)) setQuickRoleIds(data.quickRoleIds);
      const currentEdit = data?.roles?.find((r: any) => r.id === editingRoleId);
      if (currentEdit) setEditingDraft({ ...(currentEdit.permissions || EMPTY_PERMISSIONS) });
    } catch (err) {
      console.warn("loadRoles failed", err);
    }
  };

  const saveCohostProfile = async () => {
    setCohostSaving(true);
    setCohostMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/account/cohost-profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(cohostProfile),
      });
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
      const res = await fetch(`${API_BASE}/api/account/cohost-profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(next),
      });
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

  const saveRoles = async (payload: any, method: string, path: string) => {
    const res = await fetch(`${API_BASE}/api/account/${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: payload ? JSON.stringify(payload) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "role update failed");
    }
    const data = await res.json();
    if (Array.isArray(data?.roles)) setRoleProfiles(data.roles);
    if (Array.isArray(data?.quickRoleIds)) setQuickRoleIds(data.quickRoleIds);
  };

  const addRole = async () => {
    const label = roleLabelInput.trim();
    if (!label) return;
    try {
      await saveRoles({ label, permissions: EMPTY_PERMISSIONS }, "POST", "roles");
      setRoleLabelInput("");
    } catch (err: any) {
      setError(err?.message || "Failed to add role");
    }
  };

  const updateRolePermissions = async (roleId: string, permissions: any, label?: string) => {
    try {
      await saveRoles({ permissions, label }, "PATCH", `roles/${roleId}`);
      setRoleMessage("Role updated");
      setTimeout(() => setRoleMessage(null), 2000);
    } catch (err: any) {
      setError(err?.message || "Failed to update role");
    }
  };

  useEffect(() => {
    if (!editingRoleId) {
      setEditingDraft(null);
      return;
    }
    const role = roleProfiles.find((r) => r.id === editingRoleId);
    if (role) {
      setEditingDraft({ ...(role.permissions || EMPTY_PERMISSIONS) });
    }
  }, [editingRoleId, roleProfiles]);

  const deleteRole = async (roleId: string) => {
    try {
      await saveRoles(null, "DELETE", `roles/${roleId}`);
    } catch (err: any) {
      setError(err?.message || "Failed to delete role");
    }
  };

  const updateQuickRoles = async (next: string[]) => {
    setQuickRoleIds(next);
    try {
      await saveRoles({ roleIds: next }, "PUT", "roles/quick");
    } catch (err: any) {
      setError(err?.message || "Failed to update quick roles");
    }
  };

  const updatePermissionsMode = async (mode: "simple" | "advanced") => {
    if (mode === "advanced" && (!advancedPermissions.enabled || advancedPermissions.globalLock)) {
      if (advancedPermissions.lockReason === "global_lock") {
        setError("Advanced Permissions are temporarily disabled during an upgrade. Check back soon.");
      } else {
        setError("Advanced permissions are not available on your plan. Upgrade or request an override.");
      }
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/account/media-prefs`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ permissionsMode: mode }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to update permissions mode");
      }
      const data = await res.json();
      if (data?.mediaPrefs) {
        setMediaPrefs((prev) => ({ ...prev, ...data.mediaPrefs, permissionsMode: mode }));
      } else {
        setMediaPrefs((prev) => ({ ...prev, permissionsMode: mode }));
      }
      setAdvancedPermissions((prev) => ({ ...prev, effectivePermissionsMode: mode }));
      if (mode === "simple") {
        setEditingRoleId(null);
        setEditingDraft(null);
        setSelectedRoleId(null);
        setCohostProfile((prev) => ({
          ...prev,
          ...SIMPLE_ROLE_DEFAULTS.cohost.permissions,
          label: SIMPLE_ROLE_DEFAULTS.cohost.label,
          expiresHours: SIMPLE_ROLE_DEFAULTS.cohost.expiresHours || 24,
          maxUses: SIMPLE_ROLE_DEFAULTS.cohost.maxUses || 1,
        }));
        applySimpleRoleDefaults();
      } else {
        await loadRoles();
      }
    } catch (err: any) {
      setError(err?.message || "Failed to update permissions mode");
    }
  };

  const saveMediaPrefs = async () => {
    setMediaPrefsSaving(true);
    setMediaPrefsMessage(null);
    setMediaPrefsError(null);
    try {
      const res = await fetch(`${API_BASE}/api/account/media-prefs`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(mediaPrefs),
      });
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

  const handleEmergencyDownload = async () => {
    try {
      setEmergencyLoading(true);
      setEmergencyMessage(null);

      let res: Response;
      try {
        res = await fetch(`${API_BASE}/api/recordings/emergency-latest`, {
          credentials: "include",
          cache: "no-store",
        });
      } catch (err) {
        console.error("Emergency download failed (network)", err);
        setEmergencyMessage("Network error. Check your connection and try again.");
        return;
      }

      const { json, text } = await safeReadJson(res);

      if (!res.ok) {
        console.error("Emergency download failed (http)", {
          status: res.status,
          body: json ?? text,
        });
        setEmergencyMessage("Server error fetching recording. Try again.");
        return;
      }

      const url = (json as any)?.url || (json as any)?.data?.url;
      if (!url) {
        console.error("Emergency download failed (shape)", { body: json ?? text });
        setEmergencyMessage("Recording URL missing. Contact support.");
        return;
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
    setError("Billing is disabled in Test Mode. Use 'Switch Plan (Test Mode)' below instead.");
    setActionLoading(null);
    return;
  }

  setActionLoading(plan);
  const requestId = `${plan}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  try {
    const res = await apiFetch(`${API_BASE}/api/billing/checkout`, {
      method: "POST",
      body: JSON.stringify({ plan, requestId }),
    });

    const data = await res.json();
    if (!data.success || !data.url) {
      throw new Error(data.error || "Checkout failed");
    }

    window.location.href = data.url;
  } catch (err: any) {
    if (err?.status === 403 && err?.body?.error === "billing_disabled") {
      setError("Billing is disabled for this account. Use Test Mode plan switching instead.");
    } else if (err?.body?.error) {
      setError(err.body.error);
    } else {
      setError(err.message || "Failed to start checkout. Please try again.");
    }
    setActionLoading(null);
    setUser((prev) => (prev ? { ...prev, pendingPlan: null } : prev));
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
      const res = await apiFetch(`${API_BASE}/api/billing/portal`, {
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
      const res = await apiFetch(`${API_BASE}/api/billing/test/change-plan`, {
        method: "POST",
        body: JSON.stringify({ newPlanId: testModeTargetPlan }),
      });
      const data = await res.json();
      const newPlanId = (data?.planId || testModeTargetPlan) as PlanId;

      setUser((prev) => (prev ? { ...prev, planId: newPlanId, pendingPlan: null } : prev));

      try {
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
        setError("Test Mode plan switching is disabled for this account.");
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

// Canonical Test Mode detection prefers effectiveBillingEnabled, with legacy fallbacks
// handled by the shared auth helper.
const isTestMode = isAuthUserInTestMode(user as any);

const targetPlanForModal = testModeTargetPlan
  ? plans.find((p) => canonicalPlanId(p.id) === testModeTargetPlan)
  : null;
const targetPlanName = targetPlanForModal?.name || testModeTargetPlan || "";

const isPaidPlan = userPlanId === "starter" || userPlanId === "pro" || userPlanId === "basic";
const isBlocked = isPaidPlan && (status === "past_due" || status === "unpaid");
const isPaidValid = status === "active" || status === "trialing";

// Only treat pendingPlan as processing for paid plans; always consider active action loads
const isProcessing = !!actionLoading || (userPlanId !== "free" && !!user?.pendingPlan);

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
          <button
            type="button"
            style={activeTab === "destinations" ? { ...S.tab, ...S.tabActive } : S.tab}
            onClick={() => setActiveTab("destinations")}
          >
            Stream Keys
          </button>
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
        </div>

        {/* ================================================================ */}
        {/* SECTION 4: MOD/GUEST SETUP (Cohost profile) */}
        {/* ================================================================ */}
        {activeTab === "roles" && (
          <div style={{ ...S.card, opacity: isBlocked ? 0.6 : 1 }}>
            <div style={S.cardHeader}>
              <h2 style={S.cardTitle}>🛡️ Mod/Guest Setup</h2>
              {cohostMessage && <div style={S.successPill}>{cohostMessage}</div>}
            </div>
            {simpleMode ? (
              <div style={{ display: "grid", gap: 12 }}>
                <p style={{ color: "#94a3b8", marginBottom: 0 }}>
                  Simple permissions keep Participant, Co-host, and Moderator fixed. Switch to Advanced to customize.
                </p>
                {["participant", "cohost", "moderator"].map((key) => {
                  const roleKey = key as keyof typeof SIMPLE_ROLE_DEFAULTS;
                  const role = SIMPLE_ROLE_DEFAULTS[roleKey];
                  const perms = role.permissions;
                  return (
                    <div key={roleKey} style={{
                      border: "1px solid #1f2937",
                      borderRadius: 10,
                      padding: "10px 12px",
                      background: "rgba(255,255,255,0.02)",
                      display: "grid",
                      gap: 8,
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 700 }}>{role.label}</span>
                          <span style={{
                            color: "#22c55e",
                            background: "rgba(34,197,94,0.12)",
                            border: "1px solid rgba(34,197,94,0.4)",
                            borderRadius: 999,
                            padding: "2px 8px",
                            fontSize: 11,
                            fontWeight: 700,
                          }}>System</span>
                        </div>
                        <span style={{ color: "#9ca3af", fontSize: 12 }}>Standard access</span>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {PERMISSION_ITEMS.map((item) => {
                          const enabled = !!(perms as any)[item.key];
                          return (
                            <span key={item.key} style={{
                              padding: "3px 7px",
                              borderRadius: 999,
                              border: `1px solid ${enabled ? "rgba(34,197,94,0.5)" : "#1f2937"}`,
                              background: enabled ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.02)",
                              color: enabled ? "#22c55e" : "#94a3b8",
                              fontSize: 11,
                              fontWeight: 600,
                            }}>
                              {item.label}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
                  <span style={{ color: "#94a3b8", fontSize: 12 }}>
                    {advancedPermissions.lockReason === "global_lock"
                      ? "Advanced Permissions temporarily disabled during an upgrade. Check back soon."
                      : advancedPermissions.enabled
                        ? "Need custom roles and fine-grained permissions? Enable Advanced Permissions Mode."
                        : "Advanced Permissions Mode is not included on this plan. Upgrade or ask an admin for an override."}
                  </span>
                  <button
                    onClick={() => updatePermissionsMode("advanced")}
                    style={advancedPermissions.enabled && advancedPermissions.lockReason !== "global_lock" ? S.primaryBtn : { ...S.primaryBtn, opacity: 0.5, cursor: "not-allowed" }}
                    disabled={!advancedPermissions.enabled || advancedPermissions.lockReason === "global_lock"}
                  >
                    {advancedPermissions.lockReason === "global_lock"
                      ? "Temporarily disabled"
                      : advancedPermissions.enabled
                        ? "Enable Advanced Permissions Mode"
                        : "Locked on current plan"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p style={{ color: "#94a3b8", marginBottom: 14 }}>
                  Define what a Co-Host can do. Links will carry this profile.
                </p>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                  {PERMISSION_ITEMS.map((item) => (
                    <label key={item.key} style={{
                      border: "1px solid #1f2937",
                      borderRadius: 10,
                      padding: "10px 12px",
                      display: "grid",
                      gap: 6,
                      background: "rgba(255,255,255,0.02)",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={(cohostProfile as any)[item.key]}
                          onChange={(e) => setCohostProfile((prev) => ({ ...prev, [item.key]: e.target.checked }))}
                        />
                        <span style={{ fontWeight: 600 }}>{item.label}</span>
                      </div>
                      <span style={{ color: "#9ca3af", fontSize: 12 }}>
                        {item.label === "Start/Stop Stream" ? "Allow controlling broadcast egress." :
                         item.label === "Start/Stop Recording" ? "Control recording sessions." :
                         item.label === "Manage Destinations" ? "Edit stream keys and platforms." :
                         item.label === "Mute/Kick Guests" ? "Basic moderation tools." :
                         item.label === "Change Layout/Scene" ? "Switch layouts or scenes." :
                         item.label === "Share Screen" ? "Allow co-host screen share." :
                         item.label === "Invite/Generate Links" ? "Create guest invites from the room." : "Read-only analytics/usage view."}
                      </span>
                    </label>
                  ))}
                </div>

                <div style={{ marginTop: 16, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <label style={{ fontWeight: 700 }}>Role Display Name</label>
                    <input
                      type="text"
                      value={cohostProfile.label}
                      onChange={(e) => setCohostProfile((prev) => ({ ...prev, label: e.target.value }))}
                      style={{ ...S.input, color: "#000", background: "#fff" }}
                      placeholder="Co-Host"
                    />
                  </div>
                  <div style={{ display: "grid", gap: 6 }}>
                    <label style={{ fontWeight: 700 }}>Link Expiry (hours)</label>
                    <input
                      type="number"
                      min={1}
                      max={168}
                      value={cohostProfile.expiresHours}
                      onChange={(e) => setCohostProfile((prev) => ({ ...prev, expiresHours: Number(e.target.value) }))}
                      style={{ ...S.input, color: "#000", background: "#fff" }}
                    />
                  </div>
                  <div style={{ display: "grid", gap: 6 }}>
                    <label style={{ fontWeight: 700 }}>Max Uses</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={cohostProfile.maxUses}
                      onChange={(e) => setCohostProfile((prev) => ({ ...prev, maxUses: Number(e.target.value) }))}
                      style={{ ...S.input, color: "#000", background: "#fff" }}
                    />
                  </div>
                </div>

                <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 700 }}>Roles & Presets</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        type="text"
                        value={roleLabelInput}
                        onChange={(e) => setRoleLabelInput(e.target.value)}
                        placeholder="Add custom role"
                        style={{ ...S.input, color: "#000", background: "#fff", width: 180 }}
                      />
                      <button onClick={addRole} style={S.secondaryBtn}>Add</button>
                    </div>
                  </div>

                  {roleMessage && (
                    <div style={{ color: "#22c55e", fontWeight: 600 }}>{roleMessage}</div>
                  )}

                  <div style={{ display: "grid", gap: 8 }}>
                    {roleProfiles.map((role) => {
                      const isViewer = role.id === "viewer" || role.slug === "viewer";
                      const isSystem = !!role.system || isViewer;
                      const isEditing = editingRoleId === role.id;
                      const isSelected = selectedRoleId === role.id;
                      return (
                        <div
                          key={role.id}
                          style={{
                            display: "grid",
                            gap: 8,
                            padding: "10px 12px",
                            borderRadius: 8,
                            border: isEditing ? "1px solid #6366f1" : isSelected ? "1px solid rgba(34,197,94,0.5)" : "1px solid #1f2937",
                            background: isEditing ? "rgba(99,102,241,0.08)" : isSelected ? "rgba(34,197,94,0.06)" : "rgba(255,255,255,0.02)",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <span style={{ fontWeight: 600 }}>{role.label}</span>
                              <span style={{
                                color: isSystem ? "#22c55e" : "#38bdf8",
                                background: isSystem ? "rgba(34,197,94,0.12)" : "rgba(56,189,248,0.12)",
                                border: isSystem ? "1px solid rgba(34,197,94,0.4)" : "1px solid rgba(56,189,248,0.4)",
                                borderRadius: 999,
                                padding: "2px 8px",
                                fontSize: 11,
                                fontWeight: 700,
                              }}>
                                {isSystem ? "System" : "Custom"}
                              </span>
                              {isEditing && (
                                <span style={{ color: "#6366f1", fontSize: 12, fontWeight: 700 }}>Editing</span>
                              )}
                              {!isEditing && isSelected && (
                                <span style={{ color: "#16a34a", fontSize: 12, fontWeight: 700 }}>Applied</span>
                              )}
                            </div>
                            <div style={{ display: "flex", gap: 8 }}>
                              <button
                                onClick={() => {
                                  const next = {
                                    ...cohostProfile,
                                    ...role.permissions,
                                  };
                                  setCohostProfile(next);
                                  saveCohostProfileWith(next);
                                  setSelectedRoleId(role.id);
                                }}
                                style={{
                                  ...S.primaryBtn,
                                  ...(isSelected ? { background: "#16a34a", border: "1px solid #16a34a" } : {}),
                                  opacity: cohostSaving ? 0.7 : 1,
                                }}
                                disabled={cohostSaving}
                              >
                                {isSelected ? "Applied" : "Apply"}
                              </button>
                              {isEditing ? (
                                <button
                                  onClick={async () => {
                                    const roleRef = roleProfiles.find((r) => r.id === role.id);
                                    if (roleRef && editingDraft) {
                                      await updateRolePermissions(roleRef.id, editingDraft, roleRef.label);
                                      if (selectedRoleId === roleRef.id) {
                                        const next = { ...cohostProfile, ...editingDraft };
                                        setCohostProfile(next);
                                        await saveCohostProfileWith(next);
                                      }
                                      setEditingRoleId(null);
                                      setEditingDraft(null);
                                    }
                                  }}
                                  style={S.primaryBtn}
                                >
                                  Save
                                </button>
                              ) : (
                                <button
                                  onClick={() => {
                                    if (isViewer) return;
                                    setEditingRoleId(role.id);
                                    setEditingDraft({ ...(role.permissions || EMPTY_PERMISSIONS) });
                                  }}
                                  style={S.secondaryBtn}
                                  disabled={isViewer}
                                >
                                  Edit
                                </button>
                              )}
                              {isEditing && (
                                <button
                                  onClick={() => {
                                    setEditingRoleId(null);
                                    setEditingDraft(null);
                                  }}
                                  style={S.secondaryBtn}
                                >
                                  Cancel
                                </button>
                              )}
                              {!isSystem && (
                                <button onClick={() => deleteRole(role.id)} style={S.dangerGhostBtn}>Delete</button>
                              )}
                            </div>
                          </div>

                          {isEditing ? (
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                              {PERMISSION_ITEMS.map((item) => {
                                const enabled = !!editingDraft?.[item.key];
                                return (
                                  <button
                                    key={item.key}
                                    onClick={() => setEditingDraft((prev: any) => ({ ...(prev || {}), [item.key]: !enabled }))}
                                    style={{
                                      padding: "6px 10px",
                                      borderRadius: 999,
                                      border: enabled ? "1px solid rgba(34,197,94,0.6)" : "1px solid #1f2937",
                                      background: enabled ? "rgba(34,197,94,0.14)" : "rgba(255,255,255,0.04)",
                                      color: enabled ? "#22c55e" : "#94a3b8",
                                      fontSize: 12,
                                      fontWeight: 700,
                                      cursor: "pointer",
                                    }}
                                  >
                                    {item.label}
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {PERMISSION_ITEMS.map((item) => {
                                const enabled = !!role.permissions?.[item.key];
                                return (
                                  <span key={item.key} style={{
                                    padding: "3px 7px",
                                    borderRadius: 999,
                                    border: `1px solid ${enabled ? "rgba(34,197,94,0.5)" : "#1f2937"}`,
                                    background: enabled ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.02)",
                                    color: enabled ? "#22c55e" : "#94a3b8",
                                    fontSize: 11,
                                    fontWeight: 600,
                                  }}>
                                    {item.label}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Current saved defaults</div>
                  <div style={{
                    border: "1px solid #1f2937",
                    borderRadius: 10,
                    padding: "10px 12px",
                    background: "rgba(255,255,255,0.02)",
                    display: "grid",
                    gap: 6,
                  }}>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ fontWeight: 600 }}>{cohostProfile.label || "Co-Host"}</span>
                      <span style={{ color: "#9ca3af", fontSize: 12 }}>Expires: {cohostProfile.expiresHours}h</span>
                      <span style={{ color: "#9ca3af", fontSize: 12 }}>Max uses: {cohostProfile.maxUses}</span>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {PERMISSION_ITEMS.map((item) => {
                        const enabled = (cohostProfile as any)[item.key];
                        return (
                          <span
                            key={item.key}
                            style={{
                              padding: "4px 8px",
                              borderRadius: 999,
                              border: `1px solid ${enabled ? "rgba(34,197,94,0.5)" : "#1f2937"}`,
                              background: enabled ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.02)",
                              color: enabled ? "#22c55e" : "#94a3b8",
                              fontSize: 12,
                              fontWeight: 600,
                            }}
                          >
                            {item.label}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 10 }}>
                  <button
                    onClick={() => {
                      if (window.confirm("Switch to Simple Permissions? Custom roles will be hidden until you re-enable Advanced.")) {
                        updatePermissionsMode("simple");
                      }
                    }}
                    style={S.secondaryBtn}
                  >
                    Switch to Simple
                  </button>
                </div>
              </>
            )}

            {!simpleMode ? (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Quick roles shown in Room</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {roleProfiles.map((role) => {
                    const checked = quickRoleIds.includes(role.id);
                    return (
                      <label key={role.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#e5e7eb", border: "1px solid #1f2937", borderRadius: 10, padding: "6px 10px", background: "rgba(255,255,255,0.02)" }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...quickRoleIds, role.id]
                              : quickRoleIds.filter((id) => id !== role.id);
                            updateQuickRoles(next);
                          }}
                        />
                        <span>{role.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 14, color: "#9ca3af", fontSize: 12 }}>
                Quick roles are fixed in Simple mode and hidden here.
              </div>
            )}
          </div>
        )}

        {/* ================================================================ */}
        {/* SECTION 1: PAYMENT WARNING (if blocked) */}
        {/* ================================================================ */}
        {activeTab === "plan" && (
          <>
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
                    {user?.billing?.cancelAtPeriodEnd
                      ? `Cancellation scheduled — ends ${formatDate(user?.billing?.currentPeriodEnd)}`
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
                      <span style={S.priceAmount}>${currentPlan.price}</span>
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
                      <button onClick={loadAllData} style={S.secondaryBtn}>
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
              <h2 style={S.cardTitle}>📊 Compare Plans</h2>

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
                          <span style={S.planCardAmount}>${plan.price}</span>
                          <span style={S.planCardPeriod}>/mo</span>
                        </div>
                        {plan.description && (
                          <p style={{ margin: "4px 0 0", color: "#9ca3af", fontSize: 12 }}>
                            {plan.description}
                          </p>
                        )}
                      </div>
                      <ul style={S.featureList}>
                        <FeatureRow label="Monthly minutes" value={plan.limits.monthlyMinutesIncluded} />
                        <FeatureRow label="Max guests" value={plan.limits.maxGuests} />
                        <FeatureRow label="RTMP destinations" value={plan.limits.rtmpDestinationsMax} />
                        <FeatureRow label="Recording" value={plan.features.recording} />
                        <FeatureRow label="Multistream" value={(plan as any).features?.multistream ?? (plan as any).multistreamEnabled} />
                        <FeatureRow
                          label="Advanced Permissions Mode"
                          value={!!plan.features.advancedPermissions}
                          pill
                          subBullets={plan.features.advancedPermissions && planId !== "starter" ? [] : undefined}
                        />
                        {plan.editing?.access && (
                          <>
                            <FeatureRow label="Projects" value={plan.editing.maxProjects} />
                            <FeatureRow label="Storage" value={`${plan.editing.maxStorageGB}GB`} />
                          </>
                        )}
                      </ul>
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
                            {actionLoading === "basic" ? "⏳..." : getPlanActionLabel(userPlan, "basic" as any, isProcessing)}
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
                              {actionLoading === "starter_paid" ? "⏳..." : getPlanActionLabel(userPlan, "starter", isProcessing)}
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
                            {actionLoading === "pro" ? "⏳..." : getPlanActionLabel(userPlan, "pro", isProcessing)}
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
                            {getPlanActionLabel(userPlan, planId as any, isProcessing)}
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
                  {!currentPlan.features.recording && (
                    <LockedFeature
                      icon="🎥"
                      title="Recording"
                      description="Record your streams and download them"
                      requiredPlan="Starter"
                    />
                  )}
                  {!currentPlan.features.multistream && (
                    <LockedFeature
                      icon="📡"
                      title="Multistream"
                      description="Stream to YouTube, Twitch, and Facebook simultaneously"
                      requiredPlan="Starter"
                    />
                  )}
                  {!currentPlan.editing?.access && (
                    <LockedFeature
                      icon="🎬"
                      title="Editing Suite"
                      description="Edit your recordings with our built-in editor"
                      requiredPlan="Starter"
                    />
                  )}
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
              <h2 style={S.cardTitle}>🎛️ Streaming & Recording Defaults</h2>
              <span style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.15)", color: "#cbd5e1", fontSize: 12 }}>
                Plan: {entitlements.planName || currentPlan?.name || "Free"}
              </span>
            </div>

            <p style={{ color: "#94a3b8", marginTop: 4, marginBottom: 14, fontSize: 13 }}>
              These defaults pre-fill the in-room setup for new streams and recordings. Higher presets may be clamped by your plan automatically.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
              <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 12, background: "rgba(255,255,255,0.02)" }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Media Preset</div>
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
                  Applies to both streaming and recording quality; plan caps still apply.
                </div>
              </div>

              <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 12, background: "rgba(255,255,255,0.02)" }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Recording Layout</div>
                <div style={{ display: "flex", gap: 10 }}>
                  {(["speaker", "grid"] as const).map((opt) => (
                    <label key={opt} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
                      <input
                        type="radio"
                        name="recLayout"
                        value={opt}
                        checked={mediaPrefs.defaultLayout === opt}
                        onChange={() => setMediaPrefs((prev) => ({ ...prev, defaultLayout: opt }))}
                      />
                      <span style={{ textTransform: "capitalize" }}>{opt}</span>
                    </label>
                  ))}
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: "#94a3b8" }}>
                  Used when starting recordings from the room controls.
                </div>
              </div>

              <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 12, background: "rgba(255,255,255,0.02)" }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Recording Mode</div>
                <select
                  value={mediaPrefs.defaultRecordingMode}
                  onChange={(e) => setMediaPrefs((prev) => ({ ...prev, defaultRecordingMode: e.target.value as "cloud" | "dual" }))}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: entitlements.dualRecording ? "#0f172a" : "rgba(15,23,42,0.6)", color: "#e2e8f0" }}
                >
                  <option value="cloud">Standard Recording (cloud only)</option>
                  <option value="dual" disabled={!entitlements.dualRecording}>Backup Recording (cloud + local)</option>
                </select>
                <div style={{ marginTop: 6, fontSize: 12, color: "#94a3b8", display: "grid", gap: 4 }}>
                  <span style={{ color: "#22c55e" }}><strong>Standard Recording:</strong> saves one final video to the cloud. Uses less storage.</span>
                  <span style={{ color: "#f87171" }}><strong>Backup Recording:</strong> saves the cloud video and a local backup for recovery or editing. Uses more storage.</span>
                </div>
                {!entitlements.dualRecording && (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#fbbf24" }}>
                    Dual recording not included on your plan.
                  </div>
                )}
              </div>

              <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 12, background: "rgba(255,255,255,0.02)" }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Destinations Default</div>
                <div style={{ display: "flex", gap: 10 }}>
                  {([
                    { id: "last_used", label: "Reuse last" },
                    { id: "pick_each_time", label: "Pick each time" },
                  ] as const).map((opt) => (
                    <label key={opt.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
                      <input
                        type="radio"
                        name="destMode"
                        value={opt.id}
                        checked={mediaPrefs.destinationsDefaultMode === opt.id}
                        onChange={() => setMediaPrefs((prev) => ({ ...prev, destinationsDefaultMode: opt.id }))}
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: "#94a3b8" }}>
                  Controls how the stream setup modal seeds destination selection.
                </div>
              </div>

              <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 12, background: "rgba(255,255,255,0.02)" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700 }}>
                  <input
                    type="checkbox"
                    checked={mediaPrefs.warnOnHighQuality}
                    onChange={(e) => setMediaPrefs((prev) => ({ ...prev, warnOnHighQuality: e.target.checked }))}
                  />
                  <span>Warn when using high-quality presets</span>
                </label>
                <div style={{ marginTop: 6, fontSize: 12, color: "#94a3b8" }}>
                  Shows a reminder before starting with higher-bitrate presets.
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
                {mediaPrefsSaving ? "Saving..." : "Save defaults"}
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
                entitlements.rtmpMultistream ? "RTMP enabled" : "Single platform",
                entitlements.rtmpMultistream
              )}
              {renderEntitlementPill(
                "Guests",
                formatLimitLabel(entitlements.maxGuests, "guest"),
                entitlements.maxGuests !== 0
              )}
              {renderEntitlementPill(
                "Destinations",
                formatLimitLabel(entitlements.maxDestinations, "destination"),
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
                Live streaming: <span style={{ color: "#fff", fontWeight: 700 }}>{usage.streamingMinutes.used}</span> min
              </div>
              <div style={{ color: "#cbd5e1", marginBottom: 6 }}>
                Recording: <span style={{ color: "#fff", fontWeight: 700 }}>{usage.recordingMinutes.used}</span> min
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
                  <div>Lifetime live minutes: <span style={{ color: "#fff", fontWeight: 700 }}>{usage.streamingMinutes.lifetime ?? 0}</span> min</div>
                  <div>Lifetime recording minutes: <span style={{ color: "#fff", fontWeight: 700 }}>{usage.recordingMinutes.lifetime}</span> min</div>
                </div>
              )}
            </div>

            <div style={S.usageGrid}>
              <UsageBar
                label="Streaming Minutes"
                used={usage.streamingMinutes.used}
                limit={
                  usage.streamingMinutes.limit ||
                  currentPlan.limits?.monthlyMinutesIncluded ||
                  0
                }
                unit="min"
              />
              <UsageBar
                label="RTMP Destinations"
                used={usage.rtmpDestinations.used}
                limit={
                  usage.rtmpDestinations.limit ||
                  currentPlan.limits?.rtmpDestinationsMax ||
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
                Use this if your in-room download didn’t work. Downloads are available for a limited time.
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
        {activeTab === "destinations" && (
          <div style={{ marginTop: 16 }}>
            <SettingsDestinations />
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
                    {actionLoading === "starter_paid" ? "⏳ Redirecting..." : `Starter — $${starterPlan?.price ?? 15}/mo`}
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
                    {actionLoading === "pro" ? "⏳ Redirecting..." : `Pro — $${proPlan?.price ?? 49}/mo`}
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

function FeatureRow({ label, value, pill = false, subBullets }: { label: string; value: boolean | number | string | undefined; pill?: boolean; subBullets?: string[] }) {
  const isBoolean = typeof value === "boolean";
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
    : (isBoolean ? (value ? "✓" : "—") : value?.toString() || "—");
  const isEnabled = pill ? isIncluded : (value === true || (typeof value === "number" && value > 0) || (typeof value === "string" && value !== "—"));

  return (
    <li style={{ ...S.featureItem, opacity: isEnabled ? 1 : 0.5 }}>
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
      {subBullets && subBullets.length > 0 && (
        <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "#94a3b8", fontSize: 12, lineHeight: 1.5 }}>
          {subBullets.map((item) => (
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