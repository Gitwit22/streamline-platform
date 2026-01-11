// ============================================================================
// STREAMLINE ADMIN DASHBOARD - WITH FULL PLAN MANAGEMENT (UPDATED FOR YOUR SETUP)
// - Cookie auth (Option A) => credentials: "include" everywhere
// - Avoid 304 cache surprises => cache: "no-store"
// - Safe API_BASE normalization => prevents double "/api"
// ============================================================================

import React, { useState, useEffect, useMemo } from "react";
import { useAuthMe } from "../hooks/useAuthMe";
import { useNavigate } from "react-router-dom";

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
// ============================================================================
// TYPES
// ============================================================================

type PlanId = string;

interface User {
  uid: string;
  email: string;
  displayName?: string;
  planId: PlanId;
  billingEnabled?: boolean;
  minutesUsed?: number;
  bonusMinutes?: number;
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
    advancedPermissions?: boolean;
    watermarkRecordings: boolean;
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
}

function resolvePlanMaxDestinations(limits: Plan["limits"]): number {
  if (!limits) return 0;
  return (
    limits.maxDestinations ??
    limits.rtmpDestinationsMax ??
    limits.rtmpDestinations ??
    0
  );
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
  multistream: { category: "Streaming", label: "Multistream", description: "Send to multiple RTMP destinations." },
  rtmp_multistream: { category: "Streaming", label: "RTMP Multistream", description: "Legacy RTMP toggle." },
  live_captions: { category: "Streaming", label: "Live Captions", description: "Enable captions during live sessions." },
  low_latency: { category: "Streaming", label: "Low Latency", description: "Prefer lower-latency LiveKit profiles." },

  recording: { category: "Recording", label: "Recording", description: "Allow session recording." },
  dual_recording: { category: "Recording", label: "Dual Recording", description: "Cloud + local capture." },
  cloud_recording: { category: "Recording", label: "Cloud Recording" },
  vod_downloads: { category: "Recording", label: "VOD Downloads", description: "Enable video downloads." },

  editing_access: { category: "Editing", label: "Editor Access", description: "Allow timeline editor usage." },
  editing_sharing: { category: "Editing", label: "Editor Sharing", description: "Share projects with collaborators." },
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

  return { category: "Other", label: titleize(flag.name) };
}
// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function AdminDashboard() {
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<"overview" | "users" | "usage" | "features" | "plans">("overview");
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
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

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
      if (tab === "users") await loadUsers();
      if (tab === "usage") await loadUsage();
      if (tab === "features") await loadFeatures();
      if (tab === "plans") await loadPlans();
    } catch (err) {
      console.error("Failed to load data:", err);
      showToast("Failed to load admin data");
    } finally {
      setTabLoading(false);
    }
  };

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

  const changePlan = async (userId: string, newPlan: string) => {
    const res = await apiFetch(`/api/admin/users/${userId}/change-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPlan }),
    });
    if (res.ok) {
      showToast(`Plan changed to ${newPlan}`);
      await loadUsers();
    } else {
      showToast("Plan change failed");
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
      showToast("Grant failed");
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
      showToast("Billing toggle failed");
    }
  };

  const updatePlanField = (planId: string, path: string, value: any) => {
    setPlans(
      plans.map((p) => {
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

        // Auto-populate maxHoursPerMonth when monthlyMinutesIncluded is changed
        if (path === "limits.monthlyMinutesIncluded") {
          const mins = Number(value);
          if (!isNaN(mins)) {
            updated.limits.maxHoursPerMonth = Math.round(mins / 60);
          }
        }

        return updated;
      })
    );
  };

  const savePlan = async (plan: Plan) => {
    setSavingPlan(plan.id);
    try {
      const res = await apiFetch(`/api/admin/plans/${plan.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(plan),
      });

      if (res.ok) {
        showToast(`${plan.name} plan saved!`);
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
        showToast("Delete failed");
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
        {(["overview", "users", "usage", "features", "plans"] as const).map((t) => (
          <button key={t} onClick={() => setActiveTab(t)} style={{ ...S.tab, ...(activeTab === t ? S.tabActive : {}) }}>
            {t === "overview" && "📊 Overview"}
            {t === "users" && "👥 Users"}
            {t === "usage" && "📈 Usage"}
            {t === "features" && "🎛️ Features"}
            {t === "plans" && "💎 Plans"}
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
                            <select
  value={u.planId || "free"}
  onChange={(e) => changePlan(u.uid, e.target.value)}
  style={S.select}
>
  {plans.length > 0
    ? plans.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))
    : ["free", "starter", "pro", "enterprise", "internal_unlimited"].map((p) => (
        <option key={p} value={p}>
          {p === "internal_unlimited" ? "Internal Unlimited" : p}
        </option>
      ))}
</select>
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
                              <button onClick={() => setSelectedUser(u)} style={S.actionBtn}>
                                ⚡
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
                    {"  b7 "}
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

                        {/* Quick Stats */}
                        <div style={S.quickStats}>
                          <div style={S.stat}>
                            <span style={S.statValue}>{plan.limits?.monthlyMinutesIncluded || 0}</span>
                            <span style={S.statLabel}>mins/mo</span>
                          </div>
                          <div style={S.stat}>
                            <span style={S.statValue}>{plan.limits?.maxGuests || 0}</span>
                            <span style={S.statLabel}>guests</span>
                          </div>
                          {resolvePlanMaxDestinations(plan.limits) > 0 ? (
                            <div style={S.stat}>
                              <span style={S.statValue}>{resolvePlanMaxDestinations(plan.limits)}</span>
                              <span style={S.statLabel}>destinations</span>
                            </div>
                          ) : null}
                          {plan.editing?.access && plan.editing?.maxProjects > 0 && (
                            <div style={S.stat}>
                              <span style={S.statValue}>{plan.editing.maxProjects}</span>
                              <span style={S.statLabel}>projects</span>
                            </div>
                          )}
                          {plan.editing?.access && plan.editing?.maxStorageGB > 0 && (
                            <div style={S.stat}>
                              <span style={S.statValue}>{plan.editing.maxStorageGB}GB</span>
                              <span style={S.statLabel}>storage</span>
                            </div>
                          )}
                        </div>

                        {/* Feature Pills */}
                        <div style={S.featurePills}>
                          <FeaturePill enabled={plan.features?.recording} label="Recording" />
                          <FeaturePill enabled={plan.features?.dualRecording} label="Dual Recording" />
                          <FeaturePill enabled={plan.features?.rtmpMultistream ?? plan.multistreamEnabled} label="Multistream" />
                          <FeaturePill enabled={plan.features?.advancedPermissions} label="Advanced Permissions Mode" />
                          <FeaturePill enabled={plan.editing?.access} label="Editing" />
                          <FeaturePill enabled={plan.editing?.ai?.autoCut} label="AI AutoCut" />
                          <FeaturePill enabled={plan.editing?.ai?.captions} label="AI Captions" />
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
                            <PlanSection
                              title="📊 Limits"
                              collapsed={getSectionCollapsed("📊 Limits")}
                              onToggle={(next) => setSectionCollapsedValue("📊 Limits", next)}
                            >
                              <EditRow
                                label="Monthly Minutes"
                                value={plan.limits?.monthlyMinutesIncluded || 0}
                                onChange={(v) => updatePlanField(plan.id, "limits.monthlyMinutesIncluded", Number(v))}
                              />
                              <EditRow
                                label="Participant Minutes"
                                value={plan.limits?.participantMinutes || 0}
                                onChange={(v) => updatePlanField(plan.id, "limits.participantMinutes", Number(v))}
                              />
                              <EditRow
                                label="Transcode Minutes"
                                value={plan.limits?.transcodeMinutes || 0}
                                onChange={(v) => updatePlanField(plan.id, "limits.transcodeMinutes", Number(v))}
                              />
                              <EditRow
                                label="Max Session (mins)"
                                value={plan.limits?.maxSessionMinutes || 0}
                                onChange={(v) => updatePlanField(plan.id, "limits.maxSessionMinutes", Number(v))}
                              />
                              <EditRow
                                label="Recording Cap per Clip (mins)"
                                value={plan.limits?.maxRecordingMinutesPerClip || 0}
                                onChange={(v) => updatePlanField(plan.id, "limits.maxRecordingMinutesPerClip", Number(v))}
                              />
                              <EditRow
                                label="Max Hours/Month"
                                value={plan.limits?.maxHoursPerMonth || 0}
                                onChange={(v) => updatePlanField(plan.id, "limits.maxHoursPerMonth", Number(v))}
                              />
                              <EditRow
                                label="Max Guests"
                                value={plan.limits?.maxGuests || 0}
                                onChange={(v) => updatePlanField(plan.id, "limits.maxGuests", Number(v))}
                              />
                              <EditRow
                                label="Destinations Max (RTMP)"
                                value={resolvePlanMaxDestinations(plan.limits)}
                                onChange={(v) => {
                                  const num = Number(v);
                                  updatePlanField(plan.id, "limits.maxDestinations", num);
                                }}
                              />
                            </PlanSection>

                            <PlanSection
                              title="🎛️ Core Features"
                              collapsed={getSectionCollapsed("🎛️ Core Features")}
                              onToggle={(next) => setSectionCollapsedValue("🎛️ Core Features", next)}
                            >
                              <ToggleRow label="Recording" value={plan.features?.recording} onChange={(v) => updatePlanField(plan.id, "features.recording", v)} />
                              <ToggleRow label="Dual Recording" value={plan.features?.dualRecording} onChange={(v) => updatePlanField(plan.id, "features.dualRecording", v)} />
                              <ToggleRow
                                label="RTMP Multistream"
                                value={plan.features?.rtmpMultistream ?? plan.multistreamEnabled}
                                onChange={(v) => {
                                  // Canonical schema: write only features.rtmpMultistream
                                  updatePlanField(plan.id, "features.rtmpMultistream", v);
                                }}
                              />
                              <ToggleRow label="RTMP Streaming" value={plan.features?.rtmp} onChange={(v) => updatePlanField(plan.id, "features.rtmp", v)} />
                              <ToggleRow
                                label="Advanced Permissions Mode"
                                value={plan.features?.advancedPermissions}
                                onChange={(v) => updatePlanField(plan.id, "features.advancedPermissions", v)}
                              />
                              <ToggleRow
                                label="Watermark Recordings"
                                value={plan.features?.watermarkRecordings}
                                onChange={(v) => updatePlanField(plan.id, "features.watermarkRecordings", v)}
                              />
                            </PlanSection>

                            <PlanSection
                              title="✂️ Editing Suite"
                              defaultCollapsed
                              collapsed={getSectionCollapsed("✂️ Editing Suite", true)}
                              onToggle={(next) => setSectionCollapsedValue("✂️ Editing Suite", next)}
                            >
                              <ToggleRow label="Editing Access" value={plan.editing?.access} onChange={(v) => updatePlanField(plan.id, "editing.access", v)} />
                              <EditRow label="Max Projects" value={plan.editing?.maxProjects || 0} onChange={(v) => updatePlanField(plan.id, "editing.maxProjects", Number(v))} />
                              <EditRow label="Max Tracks" value={plan.editing?.maxTracks || 0} onChange={(v) => updatePlanField(plan.id, "editing.maxTracks", Number(v))} />
                              <EditRow
                                label="Storage (GB)"
                                value={plan.editing?.maxStorageGB || 0}
                                onChange={(v) => {
                                  const gb = Number(v);
                                  updatePlanField(plan.id, "editing.maxStorageGB", gb);
                                  updatePlanField(plan.id, "editing.maxStorageBytes", gb * 1024 * 1024 * 1024);
                                }}
                              />
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

function ToggleRow({ label, value, onChange }: { label: string; value?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={S.editRow}>
      <label style={S.editLabel}>{label}</label>
      <button onClick={() => onChange(!value)} style={{ ...S.toggleSmall, background: value ? "linear-gradient(135deg,#22c55e,#16a34a)" : "#374151" }}>
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
