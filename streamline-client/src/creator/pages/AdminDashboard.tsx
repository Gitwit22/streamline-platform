// ============================================================================
// STREAMLINE ADMIN DASHBOARD - WITH FULL PLAN MANAGEMENT (UPDATED FOR YOUR SETUP)
// - Cookie auth (Option A) => credentials: "include" everywhere
// - Avoid 304 cache surprises => cache: "no-store"
// - Safe API_BASE normalization => prevents double "/api"
// ============================================================================

import React, { useState, useEffect, useMemo } from "react";
import { useAuthMe } from "../../hooks/useAuthMe";
import { useNavigate } from "react-router-dom";
import { clearMeCache } from "../../lib/meCache";
import { clearPlatformFlagsCache } from "../../lib/platformFlagsCache";
import { ResetCodeDialog, type IssuedResetCode } from "../components/ResetCodeDialog";
import { PlanOverridePanel, type AdminPlanOverrideView } from "../components/admin/PlanOverridePanel";
import { SystemJobsPanel } from "../components/admin/SystemJobsPanel";

// Normalize base so if you set VITE_API_BASE to ".../api" it won't double up.
const API_BASE = (import.meta.env.VITE_API_BASE || "")
  .replace(/\/?api\/?$/, "")
  .replace(/\/+$/, "");


// A single fetch helper that matches your updated admin approach
async function apiFetch(path: string, init: RequestInit = {}) {
  // Ensure we always hit `${API_BASE}/api/...`
  const url = path.startsWith("/api/")
    ? `${API_BASE}${path}`
    : `${API_BASE}/api${path.startsWith("/") ? path : `/${path}`}`;

  return fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: {
      ...((init.headers || {})),
    },
  });
}

async function describeNonOkResponse(res: Response): Promise<string> {
  try {
    const body: any = await res.json();
    const code = body?.error ?? body?.code ?? body?.message;
    const details = body?.details ?? body?.reason;
    if (code && details) return `${String(code)}: ${String(details)}`;
    if (code) return String(code);
    if (details) return String(details);
    return `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}
// ============================================================================
// TYPES
// ============================================================================

type PlanId = string;

interface User {
  uid: string;
  email: string;
  displayName?: string;
  planId: PlanId;
  isAdmin?: boolean;
  admin?: {
    isAdmin?: boolean;
  };
  passwordReset?: {
    active?: boolean;
  };
  billingEnabled?: boolean;
  minutesUsed?: number;
  bonusMinutes?: number;
  // Stripe/base plan vs admin override vs EFFECTIVE plan (server engine).
  basePlanId?: string;
  effectivePlanId?: string;
  planOverride?: AdminPlanOverrideView;
  decidedBy?: string;
  subscriptionBlockedReason?: string | null;
}

interface UsageRecord {
  userId: string;
  email?: string;
  displayName?: string;
  planId: PlanId;
  minutesUsed: number;
  bonusMinutes: number;
  planLimit: number;
  effectiveLimit: number;
  percentUsed: number;
  isBlocked: boolean;
}

interface FeatureFlag {
  name: string;
  enabled: boolean;
}

type FeatureCategory =
  | "Streaming"
  | "Recording"
  | "Editing"
  | "AI"
  | "Collaboration"
  | "Room Features"
  | "Billing"
  | "Access"
  | "Site Tools"
  | "Security"
  | "Experiments"
  | "Other";

interface AdminStats {
  totalUsers: number;
  usersByPlan: Record<string, number>;
  activeToday: number;
  activeThisWeek: number;
  activeThisMonth: number;
  totalMinutesUsed: number;
  averageMinutesPerUser: number;
}

interface Plan {
  id: string;
  name: string;
  description: string;
  price: number;
  visibility?: "public" | "hidden" | "admin";
  limits: {
    maxSessionMinutes: number;
    maxRecordingMinutesPerClip?: number;
    monthlyMinutesIncluded: number;
    maxHoursPerMonth: number;
    maxGuests: number;
    rtmpDestinationsMax?: number;
    maxDestinations?: number;
    // Legacy field name support; kept loose for admin view only
    rtmpDestinations?: number;
    participantMinutes?: number;
    transcodeMinutes?: number;
  };
  features: {
    recording: boolean;
    rtmp: boolean;
    dualRecording?: boolean;
    rtmpMultistream?: boolean;
    canHls?: boolean;
    // Canonical HLS runtime flag (requested)
    hls?: boolean;
    hlsEnabled?: boolean;
    hlsCustomizationEnabled?: boolean;
    advancedPermissions?: boolean;
    watermarkRecordings: boolean;
    monetization?: boolean;
    payPerView?: boolean;
  };
  caps?: {
    hlsMaxMinutesPerSession?: number | null;
  };
  editing: {
    access: boolean;
    maxProjects: number;
    maxTracks: number;
    maxStorageGB: number;
    maxStorageBytes: number;
    maxResolution: string | null;
    exportsPerMonth: number;
    unlimitedExports: boolean;
    ai: {
      autoCut: boolean;
      captions: boolean;
      highlights: boolean;
    };
    transitions: {
      basic: boolean;
      advanced: boolean;
    };
    export: {
      watermark: boolean;
      directUpload: boolean;
      multiPlatform: boolean;
      priorityQueue: boolean;
    };
  };
  multistreamEnabled: boolean;
  /**
   * v2 entitlement view from GET /api/admin/plans (null = unlimited, 0 = none).
   * The editor edits these; saving writes the plan as limitsVersion 2.
   */
  entitlements?: {
    storedLimitsVersion?: number;
    features: Record<string, boolean>;
    limits: Record<string, number | string | null>;
  };
}

const V2_LIMIT_FIELDS: Array<{ key: string; label: string; unit?: string; scale?: number }> = [
  { key: "monthlyStreamingMinutes", label: "Monthly streaming minutes", unit: "min" },
  { key: "destinations", label: "Stream destinations" },
  { key: "guests", label: "Max guests" },
  { key: "maxSessionMinutes", label: "Max session length", unit: "min" },
  { key: "recordingMinutesPerClip", label: "Recording cap per clip", unit: "min" },
  { key: "hlsMaxMinutesPerSession", label: "HLS max minutes per session", unit: "min" },
  { key: "projects", label: "Max projects" },
  { key: "storageBytes", label: "Storage", unit: "GB", scale: 1024 * 1024 * 1024 },
];

const V2_FEATURE_FIELDS: Array<{ key: string; label: string }> = [
  { key: "multistream", label: "Stream destinations (multistream)" },
  { key: "recording", label: "Recording" },
  { key: "dualRecording", label: "Dual recording" },
  { key: "hls", label: "HLS broadcast" },
  { key: "hlsCustomization", label: "HLS branded viewer page" },
  { key: "editing", label: "Editor" },
  { key: "projects", label: "Projects" },
  { key: "contentLibrary", label: "Content library" },
  { key: "monetization", label: "Monetization" },
  { key: "payPerView", label: "Pay-per-view" },
  { key: "invisibleHost", label: "Invisible host" },
  { key: "overages", label: "Overages allowed" },
  { key: "watermark", label: "Watermark recordings" },
];

const V2_PRESET_OPTIONS = ["", "standard_720p30", "hd_1080p30", "sports_1080p60", "pro_1440p30", "ultra_4k30"];

function entLimit(plan: Plan, key: string): number | null {
  const v = plan.entitlements?.limits?.[key];
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatEntLimit(v: number | null, unit?: string, scale?: number): string {
  if (v === null) return "Unlimited";
  const n = scale ? Math.round((v / scale) * 100) / 100 : v;
  return unit ? `${n} ${unit}` : String(n);
}

const PLAN_COLORS: Record<string, string> = {
  free: "#6b7280",
  basic: "#3b82f6",
  starter: "#8b5cf6",
  pro: "#f59e0b",
  enterprise: "#ef4444",
};

const FEATURE_CATEGORY_ORDER: FeatureCategory[] = [
  "Streaming",
  "Recording",
  "Editing",
  "AI",
  "Collaboration",
  "Room Features",
  "Billing",
  "Access",
  "Site Tools",
  "Security",
  "Experiments",
  "Other",
];

const FEATURE_META: Record<
  string,
  {
    category: FeatureCategory;
    label?: string;
    description?: string;
  }
> = {
  multistream: { category: "Streaming", label: "Multistream", description: "Send to multiple stream destinations (RTMP)." },
  rtmp_multistream: { category: "Streaming", label: "Stream Destinations (Legacy)", description: "Legacy Stream Destinations (RTMP) toggle." },
  live_captions: { category: "Streaming", label: "Live Captions", description: "Enable captions during live sessions." },
  low_latency: { category: "Streaming", label: "Low Latency", description: "Prefer lower-latency LiveKit profiles." },

  recording: { category: "Recording", label: "Recording", description: "Allow session recording." },
  dual_recording: { category: "Recording", label: "Dual Recording", description: "Cloud + local capture." },
  cloud_recording: { category: "Recording", label: "Cloud Recording" },
  vod_downloads: { category: "Recording", label: "VOD Downloads", description: "Enable video downloads." },

  editorenabled: { category: "Editing", label: "Editor Access", description: "Allow timeline editor usage." },
  projectsenabled: { category: "Editing", label: "Projects", description: "Allow saved projects / project dashboard." },
  contentlibraryenabled: { category: "Access", label: "Content Library", description: "Allow content library access." },
  mycontentenabled: { category: "Access", label: "My Content", description: "Allow My Content section." },
  mycontentrecordingsenabled: { category: "Access", label: "My Content Recordings", description: "Allow My Content recordings tab." },
  // Group all AI-related flags under a dedicated AI category
  ai_highlights: { category: "AI", label: "AI Highlights", description: "Generate highlight reels." },
  // If a global flag exists for direct uploads, keep it under Recording
  direct_uploads: { category: "Recording", label: "Direct Uploads", description: "Allow direct upload of recordings." },

  guests: { category: "Collaboration", label: "Guests", description: "Allow guest links to rooms." },
  guest_invites: { category: "Collaboration", label: "Guest Invites" },
  chat: { category: "Collaboration", label: "Chat" },

  billing_portal: { category: "Billing", label: "Billing Portal" },
  usage_meters: { category: "Billing", label: "Usage Meters" },

  login_rate_limit: { category: "Security", label: "Login Rate Limit" },
  guardrails: { category: "Security", label: "Guardrails", description: "Safety and abuse protections." },

  experiment_a: { category: "Experiments", label: "Experiment A" },
  experiment_b: { category: "Experiments", label: "Experiment B" },
    forcesimplemode: { category: "Security", label: "Advanced Permissions Global Lock", description: "Force everyone into Simple permissions temporarily." },
  hlssettingstab: { category: "Streaming", label: "HLS Settings Tab", description: "Globally toggle the HLS controls section in room settings." },

  audiomixerenabled: { category: "Room Features", label: "Audio Mixer", description: "Enable the bus-based audio mixer panel (gain, ducking, program output) in rooms." },
  advancedscreenshareenabled: { category: "Room Features", label: "Advanced Screen Share", description: "Enable advanced screen share routing (pop-out window, main-stage modes) in rooms." },
  mixedaudiopublishenabled: { category: "Room Features", label: "Mixed Audio Publish", description: "Publish the mixer's program audio instead of the raw microphone track." },
  monetizationenabled: { category: "Billing", label: "Monetization", description: "Enable monetization features platform-wide (per-room toggles, event creation)." },
  payperviewenabled: { category: "Billing", label: "Pay-Per-View", description: "Enable pay-per-view gating for HLS events platform-wide." },
};

const titleize = (value: string) =>
  value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

function categorizeFeature(flag: FeatureFlag): { category: FeatureCategory; label: string; description?: string } {
  const key = flag.name.toLowerCase();
  const meta = FEATURE_META[key];
  if (meta) {
    return {
      category: meta.category,
      label: meta.label || titleize(flag.name),
      description: meta.description,
    };
  }

  // Heuristic grouping for flags without explicit metadata
  // 1) AI-related flags
  if (key.includes("ai")) return { category: "AI", label: titleize(flag.name) };

  // 2) Access programs: waitlist, greenroom, priority access
  if (key.includes("waitlist") || key.includes("greenroom") || key.includes("priority")) {
    return { category: "Access", label: titleize(flag.name) };
  }

  // 3) Site tools: maintenance, support, status
  if (key.includes("maintenance") || key.includes("support") || key.includes("status_page")) {
    return { category: "Site Tools", label: titleize(flag.name) };
  }

  // 4) Transitions (basic / advanced) live under Editing
  if (key.includes("transition")) {
    return { category: "Editing", label: titleize(flag.name) };
  }

  // 5) Direct uploads should live under Recording
  if (key.includes("direct") && key.includes("upload")) {
    return { category: "Recording", label: titleize(flag.name) };
  }

  if (key.includes("record")) return { category: "Recording", label: titleize(flag.name) };
  if (key.includes("stream") || key.includes("rtmp") || key.includes("live"))
    return { category: "Streaming", label: titleize(flag.name) };
  if (key.includes("edit")) return { category: "Editing", label: titleize(flag.name) };
  if (key.includes("guest") || key.includes("collab") || key.includes("invite"))
    return { category: "Collaboration", label: titleize(flag.name) };
  if (key.includes("bill") || key.includes("usage") || key.includes("meter"))
    return { category: "Billing", label: titleize(flag.name) };
  if (key.includes("guard") || key.includes("security") || key.includes("auth"))
    return { category: "Security", label: titleize(flag.name) };
  if (key.includes("mixer") || key.includes("screenshare"))
    return { category: "Room Features", label: titleize(flag.name) };

  return { category: "Other", label: titleize(flag.name) };
}
// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function AdminDashboard() {
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<"overview" | "users" | "usage" | "features" | "plans" | "jobs">("overview");
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  // Rename to match “updated admin” mental model
  const [pageLoading, setPageLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState(false);

  const [toast, setToast] = useState<string | null>(null);

  // Data states
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [usage, setUsage] = useState<UsageRecord[]>([]);
  const [features, setFeatures] = useState<FeatureFlag[]>([]);
  const groupedFeatures = useMemo(() => {
    const groups: Record<FeatureCategory, Array<{ flag: FeatureFlag; label: string; description?: string }>> = {
      Streaming: [],
      Recording: [],
      Editing: [],
      AI: [],
      Collaboration: [],
      Billing: [],
      Access: [],
      "Site Tools": [],
      "Room Features": [],
      Security: [],
      Experiments: [],
      Other: [],
    };

    features.forEach((flag) => {
      const meta = categorizeFeature(flag);
      groups[meta.category].push({ flag, label: meta.label, description: meta.description });
    });

    // Sort labels within each group for quick scanning
    FEATURE_CATEGORY_ORDER.forEach((cat) => {
      groups[cat].sort((a, b) => a.label.localeCompare(b.label));
    });

    return groups;
  }, [features]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [seedingPlans, setSeedingPlans] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [resetLoadingUserId, setResetLoadingUserId] = useState<string | null>(null);
  const [issuedResetCode, setIssuedResetCode] = useState<IssuedResetCode | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);
  const [savingPlan, setSavingPlan] = useState<string | null>(null);

  // Persist collapsible section state per title
  const SECTION_COLLAPSE_STORAGE_KEY = "admin.planSectionCollapse";
  const [sectionCollapse, setSectionCollapse] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(SECTION_COLLAPSE_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SECTION_COLLAPSE_STORAGE_KEY, JSON.stringify(sectionCollapse));
    } catch {
      // ignore persistence errors
    }
  }, [sectionCollapse]);

  const getSectionCollapsed = (title: string, fallback = false) => {
    const stored = sectionCollapse[title];
    return typeof stored === "boolean" ? stored : fallback;
  };

  const setSectionCollapsedValue = (title: string, value: boolean) => {
    setSectionCollapse((prev) => ({ ...prev, [title]: value }));
  };

  // Add state for selected users (multi-select)
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3000);
  };

  // Use /api/auth/me for admin check
  const { user: authUser, loading: authLoading, refresh: refreshAuth } = useAuthMe();
  useEffect(() => {
    if (!authLoading) {
      setIsAdmin(!!authUser?.isAdmin);
      setPageLoading(false);
    }
  }, [authUser, authLoading]);

  const [platformBillingEnabled, setPlatformBillingEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    if (!authLoading && authUser) {
      if (typeof (authUser as any).platformBillingEnabled === "boolean") {
        setPlatformBillingEnabled((authUser as any).platformBillingEnabled);
      } else {
        setPlatformBillingEnabled(true);
      }
    }
  }, [authLoading, authUser]);

  // 2) Load data for active tab (only when admin)
  useEffect(() => {
    if (!isAdmin) return;
    void loadTabData(activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isAdmin]);

  const loadTabData = async (tab: typeof activeTab) => {
    setTabLoading(true);
    try {
      if (tab === "overview") await loadStats();
      if (tab === "users") {
        // Users view needs plan names for the plan dropdown; fetch both.
        await Promise.all([loadUsers(), loadPlans()]);
      }
      if (tab === "usage") await loadUsage();
      if (tab === "features") await loadFeatures();
      if (tab === "plans") {
        // Plans UI also needs global feature flags (ex: HLS Settings Tab) so we can
        // hide/show plan UI affordances based on sitewide toggles.
        await Promise.all([loadPlans(), loadFeatures()]);
      }
    } catch (err) {
      console.error("Failed to load data:", err);
      showToast("Failed to load admin data");
    } finally {
      setTabLoading(false);
    }
  };

  const platformHlsEnabled = useMemo(() => {
    const flag = features.find((f) => f.name === "hlsSettingsTab");
    return typeof flag?.enabled === "boolean" ? flag.enabled : true;
  }, [features]);

  const platformMonetizationEnabled = useMemo(() => {
    const flag = features.find((f) => f.name === "monetizationEnabled");
    return flag?.enabled === true;
  }, [features]);

  const platformPayPerViewEnabled = useMemo(() => {
    const flag = features.find((f) => f.name === "payPerViewEnabled");
    return flag?.enabled === true;
  }, [features]);

  const loadStats = async () => {
    const res = await apiFetch("/api/admin/stats");
    if (res.ok) setStats(await res.json());
  };

  const loadUsers = async () => {
    const res = await apiFetch("/api/admin/users?limit=100");
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users || []);
    }
  };

  const loadUsage = async () => {
    const res = await apiFetch("/api/admin/usage?limit=100");
    if (res.ok) {
      const data = await res.json();
      setUsage(data.usage || []);
    }
  };

  const loadFeatures = async () => {
    const res = await apiFetch("/api/admin/features");
    if (res.ok) {
      const data = await res.json();
      setFeatures(data.features || []);
    }
  };

  const loadPlans = async () => {
    const res = await apiFetch("/api/admin/plans");
    if (res.ok) {
      const data = await res.json();
      setPlans(data.plans || []);
    }
  };

  // ============================================================================
  // ACTION HANDLERS (payloads kept the same as your working Full version)
  // ============================================================================

  const toggleFeature = async (name: string) => {
    const prev = features;
    const feat = features.find((f) => f.name === name);
    const newEnabled = !feat?.enabled;

    // optimistic update
    setFeatures(features.map((f) => (f.name === name ? { ...f, enabled: newEnabled } : f)));

    try {
      const res = await apiFetch("/api/admin/features/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureName: name, enabled: newEnabled }),
      });
      if (!res.ok) throw new Error("toggle failed");
      // Invalidate cached /me and platform flags so other pages pick up the change
      clearMeCache();
      clearPlatformFlagsCache();
      showToast(`${name.replace(/_/g, " ")} ${newEnabled ? "enabled" : "disabled"}`);
    } catch {
      setFeatures(prev);
      showToast("Feature toggle failed");
    }
  };

  const togglePlatformBilling = async () => {
    if (platformBillingEnabled === null) return;

    const previous = platformBillingEnabled;
    const next = !previous;
    setPlatformBillingEnabled(next);

    try {
      let reason: string | undefined = undefined;
      if (!next) {
        const input = window.prompt(
          "Reason for disabling platform billing (required in production):",
          ""
        );
        if (input === null) {
          // User canceled; revert local state and abort.
          setPlatformBillingEnabled(previous);
          return;
        }
        reason = input || undefined;
      }

      const res = await apiFetch("/api/admin/feature-flags/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next, reason }),
      });

      if (!res.ok) {
        throw new Error("toggle failed");
      }

      showToast(`Platform billing ${next ? "enabled" : "disabled"}`);

      // Refresh auth/me so any derived flags on the admin user stay in sync.
      try {
        await refreshAuth();
      } catch {}
    } catch {
      setPlatformBillingEnabled(previous);
      showToast("Platform billing toggle failed");
    }
  };

  // Sets the BASE plan (normally owned by Stripe). A paid base plan without a
  // subscription is billing-blocked; use the Admin Override instead to grant
  // a plan without billing.
  const changePlan = async (userId: string, newPlan: string) => {
    if (
      !window.confirm(
        `Set the BASE (Stripe/billing) plan to "${newPlan}"?\n\nPaid base plans without a Stripe subscription are billing-blocked (user gets Free). To grant a plan without billing, use "Admin Override" in the user actions (⚡) instead.`
      )
    ) {
      return;
    }
    const res = await apiFetch(`/api/admin/users/${userId}/change-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPlan }),
    });
    if (res.ok) {
      showToast(`Base plan set to ${newPlan}`);
      await loadUsers();
    } else {
      showToast(`Plan change failed: ${await describeNonOkResponse(res)}`);
    }
  };

  const grantMinutes = async (userId: string, minutes: number) => {
    const res = await apiFetch(`/api/admin/users/${userId}/grant-minutes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minutes }),
    });
    if (res.ok) {
      showToast(`+${minutes} minutes granted!`);
      setSelectedUser(null);
      await loadUsers();
    } else {
      showToast(`Grant failed: ${await describeNonOkResponse(res)}`);
    }
  };

  const resetPlanGuards = async (userId: string) => {
    const res = await apiFetch(`/api/admin/users/${userId}/reset-plan-guards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) {
      showToast("Plan-change limits reset");
    } else {
      showToast(`Reset failed: ${await describeNonOkResponse(res)}`);
    }
  };

  const toggleBilling = async (userId: string, enabled: boolean) => {
    const res = await apiFetch(`/api/admin/users/${userId}/toggle-billing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (res.ok) {
      showToast(`Billing ${enabled ? "enabled" : "disabled"}`);
      await loadUsers();
    } else {
      showToast(`Billing toggle failed: ${await describeNonOkResponse(res)}`);
    }
  };

  const canEnablePasswordResetForUser = (user: User) => {
    const currentUid = String((authUser as any)?.id || (authUser as any)?.uid || "");
    const targetIsAdmin = Boolean(user.isAdmin ?? user.admin?.isAdmin);
    if (!user?.uid) return false;
    if (targetIsAdmin) return false;
    if (currentUid && currentUid === user.uid) return false;
    return true;
  };

  const enablePasswordReset = async (user: User) => {
    if (!canEnablePasswordResetForUser(user)) {
      showToast("Password reset can only be enabled for other non-admin users");
      return;
    }
    if (resetLoadingUserId) return;
    if (
      user.passwordReset?.active &&
      !window.confirm(`Issue a new reset code for ${user.email}? The previous code will stop working.`)
    ) {
      return;
    }

    setResetLoadingUserId(user.uid);
    try {
      const res = await apiFetch(`/api/admin/users/${user.uid}/enable-password-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        throw new Error(String(data?.error || "Failed to enable password reset"));
      }

      setUsers((current) =>
        current.map((entry) =>
          entry.uid === user.uid
            ? {
                ...entry,
                passwordReset: data.passwordReset,
              }
            : entry
        )
      );
      if (typeof data?.resetSecret === "string" && data.resetSecret) {
        setIssuedResetCode({
          email: user.email,
          code: data.resetSecret,
          expiresAt: data?.passwordReset?.expiresAt ?? null,
        });
      }
      showToast(`Password reset enabled for ${user.email}`);
    } catch (err: any) {
      showToast(`Enable reset failed: ${err?.message || "unknown error"}`);
    } finally {
      setResetLoadingUserId(null);
    }
  };

  const updatePlanField = (planId: string, path: string, value: any) => {
    setPlans((prevPlans) =>
      prevPlans.map((p) => {
        if (p.id !== planId) return p;
        const updated = JSON.parse(JSON.stringify(p)); // Deep clone
        const keys = path.split(".");
        let obj: any = updated;
        for (let i = 0; i < keys.length - 1; i++) {
          if (typeof obj[keys[i]] !== "object" || obj[keys[i]] === undefined) {
            obj[keys[i]] = {};
          }
          obj = obj[keys[i]];
        }
        obj[keys[keys.length - 1]] = value;

        // Entitlement fields (features / limits) are edited through
        // updatePlanEnt in v2 form; this helper only edits other plan fields.
        return updated;
      })
    );
  };

  // v2 entitlement edits (null = unlimited, 0 = none).
  const updatePlanEnt = (planId: string, kind: "features" | "limits", key: string, value: any) => {
    setPlans((prevPlans) =>
      prevPlans.map((p) => {
        if (p.id !== planId) return p;
        const ent = p.entitlements || { features: {}, limits: {} };
        return {
          ...p,
          entitlements: {
            ...ent,
            [kind]: { ...(ent as any)[kind], [key]: value },
          },
        };
      })
    );
  };

  const savePlan = async (plan: Plan) => {
    setSavingPlan(plan.id);
    try {
      // Always save entitlements as v2; legacy features/limits/caps maps are
      // not sent (the server rewrites them from the v2 values).
      const { entitlements, features: _legacyFeatures, limits: _legacyLimits, caps: _legacyCaps, ...rest } = plan as any;
      const body: any = { ...rest, limitsVersion: 2 };
      if (entitlements) {
        body.features = entitlements.features || {};
        body.limits = entitlements.limits || {};
      }
      const res = await apiFetch(`/api/admin/plans/${plan.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        showToast(`${plan.name} plan saved!`);
        await loadPlans();
        setExpandedPlan(null); // Collapse the expanded plan section
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(`Error: ${err.error || "Failed to save plan"}`);
      }
    } catch {
      showToast("Failed to save plan");
    } finally {
      setSavingPlan(null);
    }
  };

  // Delete a single user
  const deleteUser = async (userId: string) => {
    if (!window.confirm("Are you sure you want to delete this user? This cannot be undone.")) return;
    setDeleteLoading(true);
    try {
      const res = await apiFetch(`/api/admin/users/${userId}`, { method: "DELETE" });
      if (res.ok) {
        showToast("User deleted");
        await loadUsers();
        setSelectedUserIds((ids) => ids.filter((id) => id !== userId));
      } else {
        showToast(`Delete failed: ${await describeNonOkResponse(res)}`);
      }
    } finally {
      setDeleteLoading(false);
    }
  };

  // Bulk delete
  const deleteSelectedUsers = async () => {
    if (selectedUserIds.length === 0) return;
    if (!window.confirm(`Delete ${selectedUserIds.length} users? This cannot be undone.`)) return;
    setDeleteLoading(true);
    try {
      for (const userId of selectedUserIds) {
        await apiFetch(`/api/admin/users/${userId}`, { method: "DELETE" });
      }
      showToast("Selected users deleted");
      await loadUsers();
      setSelectedUserIds([]);
    } finally {
      setDeleteLoading(false);
    }
  };

  const filteredUsers = users.filter((u) => {
    const q = searchQuery.toLowerCase();
    return (
      u.email?.toLowerCase().includes(q) ||
      u.displayName?.toLowerCase().includes(q) ||
      u.uid.toLowerCase().includes(q)
    );
  });



  // ============================================================================
  // LOADING / ACCESS DENIED SCREENS
  // ============================================================================

  if (pageLoading && isAdmin === null) {
    return (
      <div style={S.container}>
        <div style={S.center}>
          <div style={S.spinner} />
          <p>Verifying admin access...</p>
        </div>
        <style>{CSS}</style>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div style={S.container}>
        <div style={S.center}>
          <div style={{ fontSize: "4rem" }}>🔒</div>
          <h1>Access Denied</h1>
          <p>You don't have admin privileges.</p>
          <button onClick={() => navigate("/")} style={S.primaryBtn}>
            ← Back to Home
          </button>
        </div>
        <style>{CSS}</style>
      </div>
    );
  }

  // ============================================================================
  // RENDER (UI unchanged from your Full version)
  // ============================================================================

  return (
    <div style={S.container}>
      <div style={S.orb1} />
      <div style={S.orb2} />
      {toast && <div style={S.toast}>✓ {toast}</div>}
      {issuedResetCode && (
        <ResetCodeDialog issued={issuedResetCode} onClose={() => setIssuedResetCode(null)} />
      )}

      {/* Header */}
      <header style={S.header}>
        <div style={S.headerInner}>
          <div>
            <h1 style={S.title}>⚙️ Admin Dashboard</h1>
            <p style={S.subtitle}>StreamLine Control Center</p>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={() => navigate("/join")} style={S.ghostBtn}>
              ← Back to Join
            </button>
            <button onClick={() => loadTabData(activeTab)} style={S.redBtn} disabled={tabLoading}>
              {tabLoading ? "⏳" : "🔄"} Refresh
            </button>
          </div>
        </div>
      </header>

      {/* Nav */}
      <nav style={S.nav}>
        {(["overview", "users", "usage", "features", "plans", "jobs"] as const).map((t) => (
          <button key={t} onClick={() => setActiveTab(t)} style={{ ...S.tab, ...(activeTab === t ? S.tabActive : {}) }}>
            {t === "overview" && "📊 Overview"}
            {t === "users" && "👥 Users"}
            {t === "usage" && "📈 Usage"}
            {t === "features" && "🎛️ Features"}
            {t === "plans" && "💎 Plans"}
            {t === "jobs" && "🕒 System Jobs"}
          </button>
        ))}
      </nav>

      {/* Main */}
      <main style={S.main}>
        {tabLoading ? (
          <div style={{ ...S.center, minHeight: 260 }}>
            <div style={S.spinner} />
          </div>
        ) : (
          <>
            {/* OVERVIEW TAB */}
            {activeTab === "overview" && stats && (
              <div>
                <div style={S.grid6}>
                  {[
                    { l: "Total Users", v: stats.totalUsers, i: "👥" },
                    { l: "Active Today", v: stats.activeToday, i: "🟢" },
                    { l: "Active Week", v: stats.activeThisWeek, i: "📅" },
                    { l: "Active Month", v: stats.activeThisMonth, i: "📆" },
                    { l: "Total Minutes", v: stats.totalMinutesUsed.toLocaleString(), i: "⏱️" },
                    { l: "Avg/User", v: stats.averageMinutesPerUser.toFixed(1), i: "📊" },
                  ].map((s, i) => (
                    <div key={i} style={S.statCard}>
                      <div style={{ fontSize: 28 }}>{s.i}</div>
                      <div style={{ fontSize: 28, fontWeight: 700 }}>{s.v}</div>
                      <div style={{ fontSize: 12, color: "#9ca3af" }}>{s.l}</div>
                    </div>
                  ))}
                </div>

                <div style={S.card}>
                  <h3 style={{ margin: "0 0 16px" }}>Users by Plan</h3>
                  {Object.entries(stats.usersByPlan).map(([p, c]) => {
                    const pct = stats.totalUsers > 0 ? ((c / stats.totalUsers) * 100).toFixed(1) : "0";
                    return (
                      <div key={p} style={{ marginBottom: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 4 }}>
                          <span style={{ textTransform: "capitalize" }}>{p}</span>
                          <span style={{ color: "#9ca3af" }}>
                            {c} ({pct}%)
                          </span>
                        </div>
                        <div style={S.barTrack}>
                          <div style={{ ...S.barFill, width: `${pct}%`, background: PLAN_COLORS[p] || "#6b7280" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* USERS TAB */}
            {activeTab === "users" && (
              <div>
                <input
                  placeholder="🔍 Search users..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={S.input}
                />
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                  <button onClick={deleteSelectedUsers} style={{ ...S.redBtn, opacity: selectedUserIds.length === 0 ? 0.7 : 1 }} disabled={selectedUserIds.length === 0 || deleteLoading}>
                    {deleteLoading ? "⏳" : "🗑️ Delete Selected"}
                  </button>
                </div>
                <div style={S.card}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={{ ...S.th, width: 48 }}>
                          <input
                            type="checkbox"
                            checked={selectedUserIds.length === filteredUsers.length && filteredUsers.length > 0}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setSelectedUserIds(checked ? filteredUsers.map((u) => u.uid) : []);
                            }}
                            style={{ transform: "scale(1.5)", cursor: "pointer" }}
                          />
                        </th>
                        {["User", "Plan", "Minutes", "Bonus", "Billing", "Actions"].map((h) => (
                          <th key={h} style={S.th}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((u) => (
                        <tr key={u.uid} style={S.tr}>
                          <td style={S.td}>
                            <input
                              type="checkbox"
                              checked={selectedUserIds.includes(u.uid)}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setSelectedUserIds((ids) => (checked ? [...ids, u.uid] : ids.filter((id) => id !== u.uid)));
                              }}
                              style={{ transform: "scale(1.5)", cursor: "pointer" }}
                            />
                          </td>
                          <td style={S.td}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                              <div style={S.avatar}>{(u.displayName || u.email || "?")[0].toUpperCase()}</div>
                              <div>
                                <div style={{ fontWeight: 500 }}>{u.displayName || "No Name"}</div>
                                <div style={{ fontSize: 11, color: "#6b7280" }}>{u.email}</div>
                              </div>
                            </div>
                          </td>

                          <td style={S.td}>
                            <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 2 }}>Base (Stripe)</div>
                            <select
    value={u.planId || "free"}
    onChange={(e) => changePlan(u.uid, e.target.value)}
    style={S.select}
    title="Base plan (owned by Stripe/billing). Prefer Admin Override (⚡) to grant a plan."
>
    {plans.length > 0
      ? plans.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))
      : ["free", "basic", "starter", "pro", "enterprise", "internal_unlimited"].map((p) => (
          <option key={p} value={p}>
            {p === "internal_unlimited" ? "Internal Unlimited" : p}
          </option>
        ))}
</select>
                            {u.planOverride ? (
                              <div style={{ fontSize: 11, color: "#a5b4fc", marginTop: 4 }}>
                                Override: {u.planOverride.planId}
                                {u.planOverride.active === false ? " (inactive)" : ""}
                              </div>
                            ) : null}
                            {u.effectivePlanId && u.effectivePlanId !== (u.planId || "free") ? (
                              <div style={{ fontSize: 11, color: "#4ade80", marginTop: 2 }}>Effective: {u.effectivePlanId}</div>
                            ) : null}
                          </td>

                          <td style={S.td}>
                            <span style={S.blueBadge}>{u.minutesUsed || 0}m</span>
                          </td>
                          <td style={S.td}>
                            <span style={S.greenBadge}>+{u.bonusMinutes || 0}m</span>
                          </td>

                          <td style={S.td}>
                            <button
                              onClick={() => toggleBilling(u.uid, !u.billingEnabled)}
                              style={{
                                ...S.billingBtn,
                                background: u.billingEnabled ? "rgba(34,197,94,0.2)" : "rgba(107,114,128,0.2)",
                                color: u.billingEnabled ? "#4ade80" : "#9ca3af",
                              }}
                            >
                              {u.billingEnabled ? "✓ On" : "○ Off"}
                            </button>
                          </td>

                          <td style={S.td}>
                            <div style={{ display: "flex", gap: 8 }}>
                              <button onClick={() => setSelectedUser(u)} style={S.actionBtn} title="Grant minutes">
                                ⚡
                              </button>
                              <button onClick={() => resetPlanGuards(u.uid)} style={S.actionBtn} title="Reset plan-change limits">
                                🔄
                              </button>
                              <button
                                onClick={() => enablePasswordReset(u)}
                                style={{
                                  ...S.actionBtn,
                                  background: u.passwordReset?.active ? "rgba(217,119,6,0.22)" : "rgba(220,38,38,0.2)",
                                  border: u.passwordReset?.active
                                    ? "1px solid rgba(245,158,11,0.45)"
                                    : "1px solid rgba(220,38,38,0.45)",
                                  opacity:
                                    canEnablePasswordResetForUser(u) && resetLoadingUserId !== u.uid
                                      ? 1
                                      : 0.55,
                                  cursor:
                                    canEnablePasswordResetForUser(u) && resetLoadingUserId !== u.uid
                                      ? "pointer"
                                      : "not-allowed",
                                }}
                                disabled={!canEnablePasswordResetForUser(u) || resetLoadingUserId === u.uid}
                                title={
                                  !canEnablePasswordResetForUser(u)
                                    ? "Only available for other non-admin users"
                                    : u.passwordReset?.active
                                    ? "Reset enabled. Click to issue a new one-time code (voids the old one)"
                                    : "Enable password reset and get a one-time code for the user"
                                }
                              >
                                {resetLoadingUserId === u.uid ? "⏳" : u.passwordReset?.active ? "✅" : "🔐"}
                              </button>
                              <button onClick={() => deleteUser(u.uid)} style={{ ...S.actionBtn, opacity: deleteLoading ? 0.7 : 1 }} disabled={deleteLoading}>
                                🗑️
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* USAGE TAB */}
            {activeTab === "usage" && (
              <div>
                <h3 style={{ margin: "0 0 8px" }}>Usage by User</h3>
                <p style={{ margin: "0 0 16px", color: "#9ca3af", fontSize: 14 }}>Sorted by % used</p>
                {usage
                  .slice()
                  .sort((a, b) => b.percentUsed - a.percentUsed)
                  .map((r) => (
                    <div
                      key={r.userId}
                      style={{
                        ...S.card,
                        marginBottom: 12,
                        borderColor: r.isBlocked
                          ? "rgba(239,68,68,0.5)"
                          : r.percentUsed > 80
                          ? "rgba(245,158,11,0.5)"
                          : undefined,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                        <div>
                          <div style={{ fontWeight: 600 }}>{r.displayName || r.email}</div>
                          <div style={{ fontSize: 11, color: "#6b7280" }}>{r.email}</div>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <span
                            style={{
                              ...S.planBadge,
                              background: `${PLAN_COLORS[r.planId] || "#6b7280"}33`,
                              color: PLAN_COLORS[r.planId] || "#6b7280",
                            }}
                          >
                            {r.planId.toUpperCase()}
                          </span>
                          {r.isBlocked && <span style={S.blockedBadge}>🚫 BLOCKED</span>}
                        </div>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8 }}>
                        <span>
                          {r.minutesUsed}m / {r.effectiveLimit}m
                        </span>
                        <span
                          style={{
                            fontWeight: 600,
                            color: r.percentUsed > 90 ? "#ef4444" : r.percentUsed > 70 ? "#f59e0b" : "#22c55e",
                          }}
                        >
                          {r.percentUsed.toFixed(1)}%
                        </span>
                      </div>

                      <div style={S.barTrack}>
                        <div
                          style={{
                            ...S.barFill,
                            width: `${Math.min(100, r.percentUsed)}%`,
                            background: r.percentUsed > 90 ? "#ef4444" : r.percentUsed > 70 ? "#f59e0b" : "#22c55e",
                          }}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            )}

            {/* FEATURES TAB */}
            {activeTab === "features" && (
              <div>
                <h3 style={{ margin: "0 0 16px" }}>Global Feature Flags</h3>
                <p style={{ margin: "0 0 12px", color: "#94a3b8", fontSize: 13 }}>
                  Grouped by domain so you can scan streaming, recording, editing, and collaboration toggles quickly.
                </p>

                {/* Platform-wide Billing Flag */}
                <div
                  style={{
                    marginBottom: 18,
                    padding: 16,
                    borderRadius: 12,
                    border: "1px solid #1f2937",
                    background: "#020617",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>Platform Billing System</div>
                      <div style={{ fontSize: 12, color: "#9ca3af" }}>
                        When disabled, Stripe checkout and the billing portal are turned off globally. Test Mode
                        plan switching stays available while billing is disabled.
                      </div>
                    </div>
                    <button
                      onClick={togglePlatformBilling}
                      disabled={platformBillingEnabled === null}
                      style={{
                        ...S.toggle,
                        opacity: platformBillingEnabled === null ? 0.5 : 1,
                        cursor: platformBillingEnabled === null ? "not-allowed" : "pointer",
                        background:
                          platformBillingEnabled === false
                            ? "#374151"
                            : "linear-gradient(135deg,#22c55e,#16a34a)",
                      }}
                    >
                      <div
                        style={{
                          ...S.toggleKnob,
                          left: platformBillingEnabled ? 27 : 3,
                        }}
                      />
                    </button>
                  </div>
                  <div style={{ fontSize: 12, color: "#9ca3af" }}>
                    Status:{" "}
                    {platformBillingEnabled === null
                      ? "Loading..."
                      : platformBillingEnabled
                      ? "Enabled (Stripe live)"
                      : "Disabled (Test Mode only)"}
                    {" · "}
                    May take up to ~30s to propagate to all sessions.
                  </div>
                </div>

                {FEATURE_CATEGORY_ORDER.map((category) => {
                  const items = groupedFeatures[category];
                  if (!items || items.length === 0) return null;

                  return (
                    <div key={category} style={{ marginBottom: 18 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <h4 style={{ margin: 0, fontSize: 15 }}>{category}</h4>
                        <span style={{ fontSize: 12, color: "#9ca3af" }}>{items.length} {items.length === 1 ? "flag" : "flags"}</span>
                      </div>

                      <div style={S.grid2}>
                        {items.map(({ flag, label, description }) => (
                          <div key={flag.name} style={S.featureCard}>
                            <div>
                              <div style={{ fontWeight: 600 }}>{label}</div>
                              <div style={{ fontSize: 11, color: "#6b7280" }}>
                                {description || "Platform toggle"}
                              </div>
                            </div>
                            <button
                              onClick={() => toggleFeature(flag.name)}
                              style={{
                                ...S.toggle,
                                background: flag.enabled ? "linear-gradient(135deg,#22c55e,#16a34a)" : "#374151",
                              }}
                            >
                              <div style={{ ...S.toggleKnob, left: flag.enabled ? 27 : 3 }} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* SYSTEM JOBS TAB (self-loading; see SystemJobsPanel) */}
            {activeTab === "jobs" && <SystemJobsPanel onMessage={showToast} />}

            {/* PLANS TAB */}
            {activeTab === "plans" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
                  <div>
                    <h3 style={{ margin: 0 }}>Plan Configuration</h3>
                    <p style={{ margin: "4px 0 0", color: "#9ca3af", fontSize: 14 }}>
                      Edit and save plan limits, features, and pricing. Changes will update for all users on each plan.
                    </p>
                  </div>
                  <button
                    disabled={seedingPlans}
                    onClick={async () => {
                      if (!window.confirm("Seed / update ALL plans with canonical features, limits, and editing fields? Existing Stripe config is preserved.")) return;
                      setSeedingPlans(true);
                      try {
                        const res = await apiFetch("/api/admin/plans/seed", { method: "POST" });
                        if (res.ok) {
                          const data = await res.json();
                          showToast(`Plans seeded: ${data.created?.length || 0} created, ${data.updated?.length || 0} updated`);
                          await loadPlans();
                        } else {
                          showToast("Seed failed: " + (await describeNonOkResponse(res)));
                        }
                      } catch { showToast("Seed plans failed"); }
                      finally { setSeedingPlans(false); }
                    }}
                    style={{ padding: "8px 16px", background: "#4f46e5", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13, opacity: seedingPlans ? 0.6 : 1, whiteSpace: "nowrap", alignSelf: "flex-start" }}
                  >
                    {seedingPlans ? "⏳ Seeding…" : "🌱 Seed All Plans"}
                  </button>
                </div>

                <div style={S.plansGrid}>
                  {plans.map((plan) => {
                    const isExpanded = expandedPlan === plan.id;
                    const isSaving = savingPlan === plan.id;
                    const color = PLAN_COLORS[plan.id] || "#6b7280";

                    return (
                      <div key={plan.id} style={{ ...S.planCard, borderColor: `${color}60` }}>
                        {/* Header */}
                        <div
                          style={{
                            ...S.planHeader,
                            background: `linear-gradient(135deg, ${color}20, ${color}10)`,
                            borderBottom: `1px solid ${color}40`,
                          }}
                        >
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ fontWeight: 700, fontSize: 18 }}>{plan.name}</span>
                              <span
                                style={{
                                  fontSize: 10,
                                  padding: "2px 6px",
                                  background: `${color}30`,
                                  color,
                                  borderRadius: 4,
                                  fontWeight: 600,
                                }}
                              >
                                {plan.id.toUpperCase()}
                              </span>
                              {/* Visibility badge */}
                              {(() => {
                                const v = plan.visibility || "public";
                                const styles: Record<string, any> = {
                                  public: { bg: "rgba(34,197,94,0.15)", fg: "#22c55e", label: "Public" },
                                  hidden: { bg: "rgba(107,114,128,0.2)", fg: "#9ca3af", label: "Hidden" },
                                  admin: { bg: "rgba(239,68,68,0.15)", fg: "#ef4444", label: "Admin-only" },
                                };
                                const st = styles[v];
                                return (
                                  <span
                                    style={{
                                      fontSize: 10,
                                      padding: "2px 6px",
                                      background: st.bg,
                                      color: st.fg,
                                      borderRadius: 4,
                                      fontWeight: 600,
                                    }}
                                  >
                                    {st.label}
                                  </span>
                                );
                              })()}
                            </div>
                            <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>{plan.description}</p>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: 28, fontWeight: 700, color }}>
                              ${plan.price}
                              <span style={{ fontSize: 12, color: "#9ca3af", fontWeight: 400 }}>/mo</span>
                            </div>
                          </div>
                        </div>

                        {/* Quick Stats (v2: "Unlimited" = null; 0 = none, hidden) */}
                        <div style={S.quickStats}>
                          {plan.entitlements && (
                            <>
                              {(["monthlyStreamingMinutes", "guests", "destinations", "projects", "storageBytes"] as const).map((key) => {
                                const f = V2_LIMIT_FIELDS.find((x) => x.key === key)!;
                                const v = entLimit(plan, key);
                                if (v === 0) return null;
                                return (
                                  <div key={key} style={S.stat}>
                                    <span style={S.statValue}>{formatEntLimit(v, f.unit === "GB" ? "GB" : undefined, f.scale)}</span>
                                    <span style={S.statLabel}>{f.label.toLowerCase()}</span>
                                  </div>
                                );
                              })}
                            </>
                          )}
                        </div>

                        {/* Feature Pills — only show enabled features */}
                        <div style={S.featurePills}>
                          {V2_FEATURE_FIELDS.filter((f) => plan.entitlements?.features?.[f.key]).map((f) => (
                            <FeaturePill key={f.key} enabled label={f.label} />
                          ))}
                          {plan.editing?.ai?.autoCut && <FeaturePill enabled label="AI AutoCut" />}
                          {plan.editing?.ai?.captions && <FeaturePill enabled label="AI Captions" />}
                        </div>

                        {/* Expand Toggle */}
                        <button onClick={() => setExpandedPlan(isExpanded ? null : plan.id)} style={S.expandBtn}>
                          {isExpanded ? "▲ Collapse" : "▼ Expand & Edit"}
                        </button>

                        {/* Expanded Edit Section */}
                        {isExpanded && (
                          <div style={S.expandedSection}>
                            {/* Top Save Bar (sticky) */}
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "flex-end",
                                alignItems: "center",
                                gap: 8,
                                position: "sticky",
                                top: 0,
                                zIndex: 2,
                                background: "rgba(10,10,12,0.7)",
                                backdropFilter: "blur(6px)",
                                borderBottom: "1px solid #1f2937",
                                padding: "10px 12px",
                                borderRadius: 8,
                                marginBottom: 12,
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => savePlan(plan)}
                                disabled={isSaving}
                                style={{ ...S.saveBtn, opacity: isSaving ? 0.7 : 1 }}
                              >
                                {isSaving ? "⏳ Saving..." : "💾 Save changes"}
                              </button>
                            </div>

                            <PlanSection
                              title="🔒 Availability"
                              collapsed={getSectionCollapsed("🔒 Availability")}
                              onToggle={(next) => setSectionCollapsedValue("🔒 Availability", next)}
                            >
                              <div style={S.editRow}>
                                <label style={S.editLabel}>Visibility</label>
                                <select
                                  value={plan.visibility || "public"}
                                  onChange={(e) => updatePlanField(plan.id, "visibility", e.target.value)}
                                  style={{ ...S.editInput, width: 220 }}
                                >
                                  <option value="public">Public (visible to users)</option>
                                  <option value="hidden">Hidden (not shown to users)</option>
                                  <option value="admin">Admin-only (internal)</option>
                                </select>
                              </div>
                            </PlanSection>
                            {/* ── Entitlements (v2: null = Unlimited, 0 = none) ── */}
                            <PlanSection
                              title="📊 Limits"
                              collapsed={getSectionCollapsed("📊 Limits")}
                              onToggle={(next) => setSectionCollapsedValue("📊 Limits", next)}
                            >
                              <div style={{ fontSize: 12, color: "#9ca3af", margin: "0 0 8px" }}>
                                Check “Unlimited” for no cap. A number is a hard cap; <b>0 means the plan gets none</b>.
                                {plan.entitlements?.storedLimitsVersion !== 2
                                  ? " This plan is stored in the legacy format; saving converts it to v2 with the same meaning."
                                  : ""}
                              </div>
                              {V2_LIMIT_FIELDS.map((f) => (
                                <LimitRow
                                  key={f.key}
                                  label={f.label}
                                  unit={f.unit}
                                  scale={f.scale}
                                  value={entLimit(plan, f.key)}
                                  onChange={(v) => updatePlanEnt(plan.id, "limits", f.key, v)}
                                />
                              ))}
                              <div style={S.editRow}>
                                <label style={S.editLabel}>Max media quality</label>
                                <select
                                  value={String(plan.entitlements?.limits?.maxPresetId ?? "")}
                                  onChange={(e) => updatePlanEnt(plan.id, "limits", "maxPresetId", e.target.value || null)}
                                  style={{ ...S.editInput, width: 200 }}
                                >
                                  {V2_PRESET_OPTIONS.map((id) => (
                                    <option key={id || "default"} value={id}>
                                      {id || "Plan default"}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </PlanSection>

                            <PlanSection
                              title="🎛️ Features"
                              collapsed={getSectionCollapsed("🎛️ Features")}
                              onToggle={(next) => setSectionCollapsedValue("🎛️ Features", next)}
                            >
                              <div style={{ fontSize: 12, color: "#9ca3af", margin: "0 0 8px" }}>
                                Plan features. Platform kill switches (Features tab) can still turn a feature off for everyone
                                {!platformHlsEnabled ? " — HLS is currently off platform-wide" : ""}
                                {!platformMonetizationEnabled ? " — monetization is currently off platform-wide" : ""}
                                {!platformPayPerViewEnabled ? " — pay-per-view is currently off platform-wide" : ""}.
                              </div>
                              {V2_FEATURE_FIELDS.map((f) => (
                                <ToggleRow
                                  key={f.key}
                                  label={f.label}
                                  value={Boolean(plan.entitlements?.features?.[f.key])}
                                  onChange={(v) => {
                                    updatePlanEnt(plan.id, "features", f.key, v);
                                    if (f.key === "monetization" && !v) updatePlanEnt(plan.id, "features", "payPerView", false);
                                    if (f.key === "multistream" && v && entLimit(plan, "destinations") === 0) {
                                      updatePlanEnt(plan.id, "limits", "destinations", 1);
                                    }
                                    if (f.key === "multistream" && !v) updatePlanEnt(plan.id, "limits", "destinations", 0);
                                  }}
                                />
                              ))}
                            </PlanSection>

                            <PlanSection
                              title="✂️ Editing Suite"
                              defaultCollapsed
                              collapsed={getSectionCollapsed("✂️ Editing Suite", true)}
                              onToggle={(next) => setSectionCollapsedValue("✂️ Editing Suite", next)}
                            >
                              {/* Editor access, projects and storage live in Features / Limits above. */}
                              <EditRow label="Max Tracks" value={plan.editing?.maxTracks || 0} onChange={(v) => updatePlanField(plan.id, "editing.maxTracks", Number(v))} />
                              <EditRow
                                label="Exports/Month"
                                value={plan.editing?.exportsPerMonth || 0}
                                onChange={(v) => updatePlanField(plan.id, "editing.exportsPerMonth", Number(v))}
                              />
                              <ToggleRow
                                label="Unlimited Exports"
                                value={plan.editing?.unlimitedExports}
                                onChange={(v) => updatePlanField(plan.id, "editing.unlimitedExports", v)}
                              />
                            </PlanSection>

                            <PlanSection
                              title="🤖 AI Features"
                              defaultCollapsed
                              collapsed={getSectionCollapsed("🤖 AI Features", true)}
                              onToggle={(next) => setSectionCollapsedValue("🤖 AI Features", next)}
                            >
                              <ToggleRow label="AI AutoCut" value={plan.editing?.ai?.autoCut} onChange={(v) => updatePlanField(plan.id, "editing.ai.autoCut", v)} />
                              <ToggleRow label="AI Captions" value={plan.editing?.ai?.captions} onChange={(v) => updatePlanField(plan.id, "editing.ai.captions", v)} />
                              <ToggleRow label="AI Highlights" value={plan.editing?.ai?.highlights} onChange={(v) => updatePlanField(plan.id, "editing.ai.highlights", v)} />
                            </PlanSection>

                            <PlanSection
                              title="🎬 Transitions"
                              defaultCollapsed
                              collapsed={getSectionCollapsed("🎬 Transitions", true)}
                              onToggle={(next) => setSectionCollapsedValue("🎬 Transitions", next)}
                            >
                              <ToggleRow label="Basic Transitions" value={plan.editing?.transitions?.basic} onChange={(v) => updatePlanField(plan.id, "editing.transitions.basic", v)} />
                              <ToggleRow label="Advanced Transitions" value={plan.editing?.transitions?.advanced} onChange={(v) => updatePlanField(plan.id, "editing.transitions.advanced", v)} />
                            </PlanSection>

                            <PlanSection
                              title="📤 Export Options"
                              defaultCollapsed
                              collapsed={getSectionCollapsed("📤 Export Options", true)}
                              onToggle={(next) => setSectionCollapsedValue("📤 Export Options", next)}
                            >
                              <ToggleRow label="Export Watermark" value={plan.editing?.export?.watermark} onChange={(v) => updatePlanField(plan.id, "editing.export.watermark", v)} />
                              <ToggleRow label="Direct Upload" value={plan.editing?.export?.directUpload} onChange={(v) => updatePlanField(plan.id, "editing.export.directUpload", v)} />
                              <ToggleRow label="Multi-Platform" value={plan.editing?.export?.multiPlatform} onChange={(v) => updatePlanField(plan.id, "editing.export.multiPlatform", v)} />
                              <ToggleRow label="Priority Queue" value={plan.editing?.export?.priorityQueue} onChange={(v) => updatePlanField(plan.id, "editing.export.priorityQueue", v)} />
                            </PlanSection>

                            <PlanSection title="💰 Pricing" collapsible={false}>
                              <EditRow label="Price ($/month)" value={plan.price} onChange={(v) => updatePlanField(plan.id, "price", Number(v))} />
                              <div style={S.editRow}>
                                <label style={S.editLabel}>Description</label>
                                <input
                                  type="text"
                                  value={plan.description || ""}
                                  onChange={(e) => updatePlanField(plan.id, "description", e.target.value)}
                                  style={{ ...S.editInput, width: "100%" }}
                                />
                              </div>
                            </PlanSection>

                            <div style={S.saveSection}>
                              <button onClick={() => savePlan(plan)} disabled={isSaving} style={{ ...S.saveBtn, opacity: isSaving ? 0.7 : 1 }}>
                                {isSaving ? "⏳ Saving..." : `💾 Save changes`}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* User Actions Modal */}
      {selectedUser && (
        <div style={S.modalBg} onClick={() => setSelectedUser(null)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalHead}>
              <span>Actions: {selectedUser.displayName || selectedUser.email}</span>
              <button onClick={() => setSelectedUser(null)} style={S.closeBtn}>
                ×
              </button>
            </div>
            <div style={{ padding: 20 }}>
              <label style={S.label}>Quick Grant Minutes</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {[30, 60, 120, 300, 600].map((m) => (
                  <button key={m} onClick={() => grantMinutes(selectedUser.uid, m)} style={S.grantBtn}>
                    +{m}m
                  </button>
                ))}
              </div>
              <label style={{ ...S.label, marginTop: 20, display: "block" }}>Admin Override</label>
              <PlanOverridePanel
                userId={selectedUser.uid}
                basePlanId={selectedUser.basePlanId || selectedUser.planId}
                effectivePlanId={selectedUser.effectivePlanId}
                planOverride={selectedUser.planOverride ?? null}
                decidedBy={selectedUser.decidedBy}
                subscriptionBlockedReason={selectedUser.subscriptionBlockedReason}
                planOptions={
                  plans.length > 0
                    ? plans.map((p) => ({ id: p.id, name: p.name }))
                    : ["free", "basic", "starter", "pro", "enterprise", "internal_unlimited"].map((id) => ({ id }))
                }
                onMessage={showToast}
                onChanged={async () => {
                  setSelectedUser(null);
                  await loadUsers();
                }}
              />
            </div>
          </div>
        </div>
      )}

      <style>{CSS}</style>
    </div>
  );
}

// ============================================================================
// HELPER COMPONENTS (unchanged)
// ============================================================================

function FeaturePill({ enabled, label }: { enabled?: boolean; label: string }) {
  return (
    <span
      style={{
        padding: "4px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 500,
        background: enabled ? "rgba(34,197,94,0.2)" : "rgba(107,114,128,0.2)",
        color: enabled ? "#4ade80" : "#6b7280",
        border: `1px solid ${enabled ? "rgba(34,197,94,0.3)" : "rgba(107,114,128,0.3)"}`,
      }}
    >
      {enabled ? "✓" : "×"} {label}
    </span>
  );
}

function PlanSection({ title, children, defaultCollapsed = false, collapsible = true, collapsed, onToggle }: { title: string; children: React.ReactNode; defaultCollapsed?: boolean; collapsible?: boolean; collapsed?: boolean; onToggle?: (next: boolean) => void }) {
  const isControlled = typeof collapsed === "boolean";
  const [internalCollapsed, setInternalCollapsed] = React.useState(defaultCollapsed);
  const currentCollapsed = isControlled ? (collapsed as boolean) : internalCollapsed;

  const header = (
    <div
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "8px 6px 6px",
        color: "#ef4444",
        fontSize: 12,
        fontWeight: 700,
        textAlign: "left",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        {collapsible && (
          <span style={{ display: "inline-block", transform: currentCollapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 120ms ease" }}>
            ▼
          </span>
        )}
        {title}
      </span>
      {collapsible && <span style={{ color: "#9ca3af", fontWeight: 600 }}>{currentCollapsed ? "Show" : "Hide"}</span>}
    </div>
  );

  const toggle = () => {
    if (!collapsible) return;
    const next = !currentCollapsed;
    if (!isControlled) setInternalCollapsed(next);
    onToggle?.(next);
  };

  return (
    <div style={{ marginBottom: 16, borderBottom: "1px solid rgba(220,38,38,0.18)", paddingBottom: 8 }}>
      {collapsible ? (
        <button
          onClick={toggle}
          style={{ width: "100%", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
          aria-expanded={!currentCollapsed}
        >
          {header}
        </button>
      ) : (
        header
      )}
      {(!collapsible || !currentCollapsed) && <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "2px 0 2px" }}>{children}</div>}
    </div>
  );
}

function EditRow({ label, value, onChange }: { label: string; value: string | number; onChange: (v: string) => void }) {
  return (
    <div style={S.editRow}>
      <label style={S.editLabel}>{label}</label>
      <input type="number" value={value} onChange={(e) => onChange(e.target.value)} style={{ ...S.editInput, width: 80 }} />
    </div>
  );
}

/** v2 limit editor: "Unlimited" checkbox (null) or a number (0 = none). */
function LimitRow({
  label,
  value,
  unit,
  scale,
  onChange,
}: {
  label: string;
  value: number | null;
  unit?: string;
  scale?: number;
  onChange: (v: number | null) => void;
}) {
  const unlimited = value === null;
  const display = value === null ? "" : scale ? Math.round((value / scale) * 100) / 100 : value;
  return (
    <div style={S.editRow}>
      <label style={S.editLabel}>
        {label}
        {unit ? ` (${unit})` : ""}
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input
          type="number"
          min={0}
          disabled={unlimited}
          value={display}
          placeholder={unlimited ? "Unlimited" : "0 = none"}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n) || n < 0) return;
            onChange(scale ? Math.round(n * scale) : Math.floor(n));
          }}
          style={{ ...S.editInput, width: 100, opacity: unlimited ? 0.5 : 1 }}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#d1d5db" }}>
          <input type="checkbox" checked={unlimited} onChange={(e) => onChange(e.target.checked ? null : 0)} />
          Unlimited
        </label>
      </div>
    </div>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={S.editRow}>
      <label style={S.editLabel}>{label}</label>
      <button
        type="button"
        onClick={() => onChange(!value)}
        style={{ ...S.toggleSmall, background: value ? "linear-gradient(135deg,#22c55e,#16a34a)" : "#374151" }}
        aria-pressed={!!value}
      >
        <div style={{ ...S.toggleKnobSmall, left: value ? 20 : 2 }} />
      </button>
    </div>
  );
}

// Styles
const S: Record<string, React.CSSProperties> = {
  container: { minHeight: "100vh", background: "#000", color: "#fff", fontFamily: "system-ui", position: "relative", overflow: "hidden" },
  orb1: { position: "fixed", top: "5%", left: "5%", width: 400, height: 400, background: "rgba(220,38,38,0.1)", borderRadius: "50%", filter: "blur(100px)", pointerEvents: "none" },
  orb2: { position: "fixed", bottom: "10%", right: "10%", width: 500, height: 500, background: "rgba(239,68,68,0.08)", borderRadius: "50%", filter: "blur(120px)", pointerEvents: "none" },
  toast: { position: "fixed", top: 20, right: 20, background: "rgba(34,197,94,0.9)", color: "#fff", padding: "12px 20px", borderRadius: 8, zIndex: 100, fontWeight: 600 },
  center: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", gap: 16 },
  spinner: { width: 40, height: 40, border: "3px solid rgba(220,38,38,0.3)", borderTopColor: "#dc2626", borderRadius: "50%", animation: "spin 1s linear infinite" },
  header: { position: "relative", zIndex: 10, background: "rgba(15,15,15,0.8)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(220,38,38,0.3)", padding: "20px 32px" },
  headerInner: { maxWidth: 1200, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" },
  title: { margin: 0, fontSize: 24, fontWeight: 700, background: "linear-gradient(to right,#fff,#fecaca)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" },
  subtitle: { margin: "4px 0 0", fontSize: 14, color: "#9ca3af" },
  ghostBtn: { padding: "8px 16px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 8, color: "#fff", cursor: "pointer" },
  redBtn: { padding: "8px 16px", background: "rgba(220,38,38,0.2)", border: "1px solid rgba(220,38,38,0.5)", borderRadius: 8, color: "#fff", cursor: "pointer" },
  primaryBtn: { padding: "10px 18px", background: "rgba(220,38,38,0.9)", border: "1px solid rgba(220,38,38,1)", borderRadius: 10, color: "#fff", cursor: "pointer", fontWeight: 700 },
  nav: { maxWidth: 1200, margin: "0 auto", display: "flex", gap: 8, padding: "14px 32px", position: "relative", zIndex: 10, flexWrap: "wrap" },
  tab: { padding: "10px 14px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, color: "#fff", cursor: "pointer" },
  tabActive: { background: "rgba(220,38,38,0.20)", borderColor: "rgba(220,38,38,0.5)" },
  main: { maxWidth: 1200, margin: "0 auto", padding: "20px 32px 60px", position: "relative", zIndex: 10 },
  card: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 14, padding: 18, backdropFilter: "blur(20px)" },
  grid6: { display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 12, marginBottom: 12 },
  statCard: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 14, padding: 14 },
  barTrack: { height: 10, background: "rgba(255,255,255,0.06)", borderRadius: 999 },
  barFill: { height: 10, borderRadius: 999 },
  input: { width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)", color: "#fff", outline: "none", marginBottom: 12 },
  th: { textAlign: "left", fontSize: 12, color: "#9ca3af", padding: "12px 10px", borderBottom: "1px solid rgba(255,255,255,0.08)" },
  td: { padding: "12px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)", verticalAlign: "middle" },
  tr: {},
  avatar: { width: 36, height: 36, borderRadius: 12, background: "rgba(220,38,38,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 },
  select: { padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.35)", color: "#fff" },
  blueBadge: { padding: "6px 10px", borderRadius: 999, background: "rgba(59,130,246,0.18)", border: "1px solid rgba(59,130,246,0.35)", color: "#bfdbfe", fontSize: 12, fontWeight: 700 },
  greenBadge: { padding: "6px 10px", borderRadius: 999, background: "rgba(34,197,94,0.18)", border: "1px solid rgba(34,197,94,0.35)", color: "#bbf7d0", fontSize: 12, fontWeight: 700 },
  billingBtn: { padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer", fontWeight: 700, minWidth: 72 },
  actionBtn: { padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", color: "#fff", cursor: "pointer" },
  planBadge: { padding: "6px 10px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.10)", fontSize: 12, fontWeight: 800 },
  blockedBadge: { padding: "6px 10px", borderRadius: 999, background: "rgba(239,68,68,0.18)", border: "1px solid rgba(239,68,68,0.4)", color: "#fecaca", fontSize: 12, fontWeight: 800 },
  grid2: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 },
  featureCard: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 14, padding: 16, display: "flex", alignItems: "center", justifyContent: "space-between" },
  toggle: { width: 52, height: 28, borderRadius: 999, border: "1px solid rgba(255,255,255,0.15)", position: "relative", cursor: "pointer" },
  toggleKnob: { width: 22, height: 22, borderRadius: 999, background: "#fff", position: "absolute", top: 2, transition: "left 140ms ease" },

  modalBg: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 },
  modal: { width: 520, maxWidth: "90vw", background: "rgba(15,15,15,0.96)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, overflow: "hidden" },
  modalHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.10)" },
  closeBtn: { border: "none", background: "transparent", color: "#fff", fontSize: 22, cursor: "pointer" },
  label: { display: "block", marginBottom: 10, color: "#9ca3af", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6 },
  grantBtn: { padding: "10px 12px", borderRadius: 12, background: "rgba(220,38,38,0.18)", border: "1px solid rgba(220,38,38,0.35)", color: "#fff", cursor: "pointer", fontWeight: 800 },

  // Plans tab
  grid4: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 },
  planCard: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 14, overflow: "hidden" },
  planHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottom: "1px solid rgba(255,255,255,0.08)" },
  planSection: { fontSize: 12, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
  planRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" },
  planLabel: { fontSize: 12, color: "#d1d5db" },
  planInput: { width: 90, padding: "6px 8px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.35)", color: "#fff" },
  planFeatBtn: { width: 34, height: 30, borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", color: "#fff", cursor: "pointer", fontWeight: 900 },
  saveBtn: { padding: "12px 18px", borderRadius: 14, background: "rgba(220,38,38,0.25)", border: "1px solid rgba(220,38,38,0.45)", color: "#fff", cursor: "pointer", fontWeight: 900 },

  // Add these NEW styles (the ones that are missing):
plansGrid: { display: "flex", flexDirection: "column", gap: 16 },
planHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: 20 },
quickStats: { display: "flex", gap: 24, padding: "16px 20px", background: "rgba(0,0,0,0.2)" },
stat: { display: "flex", flexDirection: "column", alignItems: "center" },
statValue: { fontSize: 18, fontWeight: 700, color: "#fff" },
statLabel: { fontSize: 11, color: "#6b7280", textTransform: "uppercase" },
featurePills: { display: "flex", flexWrap: "wrap", gap: 6, padding: "12px 20px" },
expandBtn: { width: "100%", padding: "12px", background: "linear-gradient(135deg, #dc2626, #b91c1c)", border: "none", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 13 },
expandedSection: { padding: 20, background: "rgba(0,0,0,0.3)", borderTop: "1px solid rgba(255,255,255,0.08)" },
saveSection: { marginTop: 20, paddingTop: 16, borderTop: "1px solid rgba(220,38,38,0.3)", display: "flex", justifyContent: "flex-end" },
editRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" },
editLabel: { fontSize: 13, color: "#d1d5db" },
editInput: { padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.4)", color: "#fff", fontSize: 13 },
toggleSmall: { width: 40, height: 22, borderRadius: 11, border: "none", position: "relative", cursor: "pointer", transition: "background 0.2s" },
toggleKnobSmall: { width: 18, height: 18, borderRadius: 9, background: "#fff", position: "absolute", top: 2, transition: "left 0.15s ease" },
};

const CSS = `
@keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }
@media (max-width: 1100px) {
  ._grid6 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 720px) {
  ._grid6 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
`;

// NOTE: If you want responsive grid6/grid4 without refactoring styles,
// you can convert S.grid6 and S.grid4 to className-based grids.
// Keeping your current style approach to minimize changes.
