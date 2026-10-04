import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetchAuth } from "../../lib/api";
import { ResetCodeDialog, type IssuedResetCode } from "../components/ResetCodeDialog";
import { PlanOverridePanel, type AdminPlanOverrideView } from "../components/admin/PlanOverridePanel";
import { UsageCreditsPanel } from "../components/admin/UsageCreditsPanel";
import { AdminNav } from "../components/admin/AdminGuard";
import { buildUsagePath, filterUsageRows, planLabel, type PlanOption } from "./adminUsageQuery";

interface UsageData {
  userId: string;
  email?: string | null;
  displayName?: string;
  isAdmin?: boolean;
  /** Base plan id (any plan doc id). */
  planId: string;
  passwordReset?: {
    active?: boolean;
    requestedAt?: number | null;
    expiresAt?: number | null;
    usedAt?: number | null;
  };
  recovery?: {
    configured?: boolean;
  };
  recoveryConfigured?: boolean;
  canEnablePasswordReset?: boolean;
  billingTruthStatus?: "free" | "active" | "trialing" | "past_due" | "canceled" | string;
  stripeConnected?: boolean;
  stripeCustomerId?: string | null;
  billingEnabled?: boolean;
  platformBillingEnabled?: boolean;
  effectiveBillingEnabled?: boolean;
  /** Monthly streaming minutes (union of output time). */
  minutesUsed: number;
  streamingMinutes?: number;
  /** Analytics only (duration x destinations). */
  destinationMinutes?: number;
  recordingMinutes?: number;
  /** Plan every feature reads (override > platform admin > base). */
  effectivePlanId?: string;
  /** Stripe/billing base plan (users.planId). */
  basePlanId?: string;
  planOverride?: AdminPlanOverrideView;
  decidedBy?: string;
  subscriptionBlockedReason?: string | null;
  unlimited?: boolean;
  overageStreamingMinutes?: number;
  overageParticipantMinutes?: number;
  overageTranscodeMinutes?: number;
  overageMinutesTotal?: number;
  /** Credit minutes in this month's allowance (consumed this month + remaining). */
  bonusMinutes: number;
  /** Remaining one-time usage credit minutes (carry over month to month). */
  creditRemainingMinutes?: number;
  /** Minutes of this month's usage paid by credits. */
  creditConsumedThisMonth?: number;
  /** Plan monthly streaming minutes; null = unlimited, 0 = none. */
  planLimit: number | null;
  /** plan + credit allowance; null = unlimited, 0 = none */
  effectiveLimit: number | null;
  percentUsed: number;
  isBlocked: boolean;
  lastActive?: Date;
  lastActiveAt?: number | null;
}

interface AdminStats {
  totalUsers: number;
  usersByPlan: Record<string, number>;
  activeToday: number;
  activeThisWeek: number;
  activeThisMonth: number;
  /** Streaming minutes this (UTC) month across all users. */
  totalMinutesUsed: number;
  averageMinutesPerUser: number;
  averageMinutesPerActiveUser?: number;
  monthKey?: string;
}

const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

export default function AdminUsage() {
  const nav = useNavigate();
  const [usageData, setUsageData] = useState<UsageData[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [selectedPlan, setSelectedPlan] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  // Server-side email prefix search (users.emailLower) + cursor pagination.
  const [emailPrefix, setEmailPrefix] = useState("");
  const [appliedPrefix, setAppliedPrefix] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  
  // Modal states
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UsageData | null>(null);
  
  // Form states
  const [newPlan, setNewPlan] = useState<string>("free");
  const [planChangeReason, setPlanChangeReason] = useState("");
  const [resetLoadingUserId, setResetLoadingUserId] = useState<string | null>(null);
  const [issuedResetCode, setIssuedResetCode] = useState<IssuedResetCode | null>(null);

  // The server identifies the admin from the session; this is kept only for
  // older request bodies that still carry it.
  const adminUserId = "";

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlan, appliedPrefix]);

  // Plan list for filters / dropdowns (no hardcoded plan ids).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetchAuth(`${API_BASE}/api/admin/plans`, {}, { allowNonOk: true });
        if (!res.ok || cancelled) return;
        const body = await res.json().catch(() => ({}));
        setPlans(((body?.plans || []) as Array<{ id: string; name?: string }>).map((p) => ({ id: p.id, name: p.name })));
      } catch {
        // dropdowns fall back to the ids present in the data
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const planOptions: PlanOption[] =
    plans.length > 0
      ? plans
      : Array.from(new Set(usageData.map((u) => u.planId || "free"))).map((id) => ({ id }));

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await apiFetchAuth(
        `${API_BASE}${buildUsagePath({ plan: selectedPlan, emailPrefix: appliedPrefix, cursor: nextCursor, limit: 100 })}`,
        {},
        { allowNonOk: true }
      );
      if (!res.ok) throw new Error(`Failed to fetch usage: ${res.status}`);
      const body = await res.json();
      setUsageData((prev) => [...prev, ...((body.usage || []) as UsageData[])]);
      setNextCursor(body.nextCursor || null);
    } catch (err: any) {
      alert(`Error: ${err?.message || "Failed to load more users"}`);
    } finally {
      setLoadingMore(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch usage data (relative-safe path; see buildUsagePath)
      const usageRes = await apiFetchAuth(
        `${API_BASE}${buildUsagePath({ plan: selectedPlan, emailPrefix: appliedPrefix, limit: 100 })}`,
        {},
        { allowNonOk: true }
      );
      
      if (usageRes.status === 403) {
        setError("Access denied. Admin privileges required.");
        setLoading(false);
        return;
      }

      if (!usageRes.ok) {
        throw new Error(`Failed to fetch usage: ${usageRes.status}`);
      }

      const usageJson = await usageRes.json();
      setUsageData(usageJson.usage || []);
      setNextCursor(usageJson.nextCursor || null);

      // Fetch stats
      const statsRes = await apiFetchAuth(`${API_BASE}/api/admin/stats`, {}, { allowNonOk: true });
      if (statsRes.ok) {
        const statsJson = await statsRes.json();
        setStats(statsJson);
      }

      setLoading(false);
    } catch (err: any) {
      console.error("Failed to fetch admin data:", err);
      setError(err.message || "Failed to fetch data");
      setLoading(false);
    }
  };

  const handleChangePlan = async () => {
    if (!selectedUser) return;
    if (
      !window.confirm(
        `Set the BASE (Stripe/billing) plan of ${selectedUser.email} to "${newPlan}"?\n\nPaid base plans without a Stripe subscription are billing-blocked (user gets Free). Use the Admin Override above to grant a plan without billing.`
      )
    ) {
      return;
    }

    try {
      const res = await apiFetchAuth(`${API_BASE}/api/admin/users/${selectedUser.userId}/change-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminUserId,
          newPlan,
          reason: planChangeReason,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to change plan");
      }

      alert(`Base plan of ${selectedUser.email} set to ${newPlan}`);
      setShowPlanModal(false);
      setPlanChangeReason("");
      fetchData(); // Refresh data
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleToggleBilling = async (user: UsageData) => {
    // billingEnabled is tri-state in Firestore; missing => true.
    const current = user.billingEnabled !== false;
    const newState = !current;

    try {
      const res = await apiFetchAuth(`${API_BASE}/api/admin/users/${user.userId}/toggle-billing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminUserId,
          enabled: newState,
          reason: "Admin toggle from UI",
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to toggle billing");
      }

      alert(`Billing ${newState ? "enabled" : "disabled"} for ${user.email}`);
      fetchData();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleEnablePasswordReset = async (user: UsageData) => {
    if (!user.canEnablePasswordReset || resetLoadingUserId) return;
    if (
      user.passwordReset?.active &&
      !window.confirm(`Issue a new reset code for ${user.email}? The previous code will stop working.`)
    ) {
      return;
    }

    setResetLoadingUserId(user.userId);
    try {
      const res = await apiFetchAuth(
        `${API_BASE}/api/admin/users/${user.userId}/enable-password-reset`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
        { allowNonOk: true }
      );

      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        throw new Error(String(data?.error || "Failed to enable password reset"));
      }

      setUsageData((current) =>
        current.map((entry) =>
          entry.userId === user.userId
            ? {
                ...entry,
                passwordReset: data.passwordReset,
                canEnablePasswordReset: data.canEnablePasswordReset,
              }
            : entry
        )
      );
      if (typeof data?.resetSecret === "string" && data.resetSecret) {
        setIssuedResetCode({
          email: user.email || user.userId,
          code: data.resetSecret,
          expiresAt: data?.passwordReset?.expiresAt ?? null,
        });
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setResetLoadingUserId(null);
    }
  };

  // Filter the loaded rows (email / name / uid); missing emails are fine.
  const filteredData = filterUsageRows(usageData, searchQuery);

  if (loading && !stats) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl mb-2">Loading admin panel...</div>
          <div className="text-gray-400">Please wait</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl text-red-500 mb-4">❌ {error}</div>
          <button
            onClick={() => nav("/admin/dashboard")}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
          >
            Back to Admin Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-6">
      {issuedResetCode && (
        <ResetCodeDialog issued={issuedResetCode} onClose={() => setIssuedResetCode(null)} />
      )}
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">Admin Usage Dashboard</h1>
            <p className="text-gray-400 mb-2">Streaming usage, credits, overrides and billing per user</p>
            <AdminNav current="usage" />
          </div>
          <button
            onClick={() => nav("/admin/dashboard")}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded transition"
          >
            ← Back
          </button>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <StatCard label="Total Users" value={stats.totalUsers} icon="👥" />
            <StatCard label="Active Today" value={stats.activeToday} icon="🟢" />
            <StatCard
              label={`Streaming min (${stats.monthKey || "this month"})`}
              value={Math.round(stats.totalMinutesUsed || 0).toLocaleString()}
              icon="⏱️"
            />
            <StatCard
              label="Avg min / active user"
              value={Math.round(stats.averageMinutesPerActiveUser ?? stats.averageMinutesPerUser ?? 0)}
              icon="📊"
            />
          </div>
        )}

        {/* Plan Distribution */}
        {stats && (
          <div className="bg-gray-900 rounded-lg p-6 mb-8">
            <h2 className="text-xl font-semibold mb-4">Users by Base Plan</h2>
            <div className="grid grid-cols-4 gap-4">
              {Object.entries(stats.usersByPlan).map(([plan, count]) => (
                <div key={plan} className="text-center">
                  <div className="text-2xl font-bold text-red-500">{count}</div>
                  <div className="text-sm text-gray-400">{planLabel(planOptions, plan)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="bg-gray-900 rounded-lg p-4 mb-6">
          <div className="flex gap-4">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Filter loaded rows by email, name, or user ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded text-white"
              />
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setAppliedPrefix(emailPrefix.trim().toLowerCase());
              }}
            >
              <input
                type="search"
                aria-label="Search all users by email prefix"
                placeholder="Email starts with… (all users)"
                value={emailPrefix}
                onChange={(e) => {
                  setEmailPrefix(e.target.value);
                  if (!e.target.value.trim()) setAppliedPrefix("");
                }}
                className="px-4 py-2 bg-gray-800 border border-gray-700 rounded text-white"
              />
              <button type="submit" className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm">
                Search
              </button>
            </form>
            <select
              value={selectedPlan}
              onChange={(e) => setSelectedPlan(e.target.value)}
              className="px-4 py-2 bg-gray-800 border border-gray-700 rounded text-white"
            >
              <option value="all">All Plans</option>
              {planOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.id}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Usage Table */}
        <div className="bg-gray-900 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-800">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold">User</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">Plan</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">Billing</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold">
                    <div>Streaming min (this month)</div>
                    <div className="text-xs font-normal text-gray-400">
                      Output time; overlaps count once. Resets on the 1st (UTC).
                    </div>
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-semibold">
                    <div>Overage (this month)</div>
                    <div className="text-xs font-normal text-gray-400">
                      Billable minutes beyond limit (overages opted in).
                    </div>
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-semibold">
                    <div>Limit this month</div>
                    <div className="text-xs font-normal text-gray-400">Plan + one-time credits</div>
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-semibold">
                    <div>Credits</div>
                    <div className="text-xs font-normal text-gray-400">Remaining (carries over)</div>
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-semibold">Status</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filteredData.map((user) => (
                  <tr key={user.userId} className="hover:bg-gray-800/50 transition">
                    <td className="px-4 py-3">
                      <div className="font-medium">{user.displayName || "No name"}</div>
                      <div className="text-sm text-gray-400">{user.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-1 rounded text-xs font-semibold ${getPlanColor(
                          user.planId
                        )}`}
                      >
                        {planLabel(planOptions, user.planId)}
                      </span>
                      <div className="text-[11px] text-gray-500 mt-1">Stripe/base plan</div>
                      {user.planOverride && (
                        <div className="text-xs text-indigo-300">
                          Override: {user.planOverride.planId}
                          {user.planOverride.active === false ? " (inactive)" : ""}
                        </div>
                      )}
                      {user.effectivePlanId && user.effectivePlanId !== user.planId && (
                        <div className="text-xs text-green-300">Effective: {user.effectivePlanId}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-semibold">
                          {String(user.billingTruthStatus || "free").toLowerCase() === "free"
                            ? "Free (ready)"
                            : String(user.billingTruthStatus || "unknown")}
                        </span>
                        <span className="text-xs text-gray-400">
                          Stripe: {user.stripeConnected ? "connected" : "not connected"}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {user.streamingMinutes ?? user.minutesUsed} min
                      <div className="text-xs text-gray-400" title="Destination minutes are analytics only">
                        dest: {user.destinationMinutes ?? 0} · rec: {user.recordingMinutes ?? 0}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-orange-300">
                      {user.overageStreamingMinutes ?? user.overageMinutesTotal ?? 0} min
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {user.unlimited || user.effectiveLimit === null ? "Unlimited" : `${user.effectiveLimit} min`}
                      {!user.unlimited && user.planLimit !== null && user.effectiveLimit !== null && user.effectiveLimit !== user.planLimit && (
                        <div className="text-[11px] text-gray-400">plan {user.planLimit}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-green-400">
                      {user.creditRemainingMinutes ?? 0} min
                      {(user.creditConsumedThisMonth ?? 0) > 0 && (
                        <div className="text-[11px] text-gray-400">used {user.creditConsumedThisMonth} this month</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex flex-col items-center gap-2">
                        {user.isBlocked ? (
                          <span className="px-2 py-1 bg-red-500/20 text-red-400 rounded text-xs font-semibold">
                            BLOCKED
                          </span>
                        ) : (
                          <span className="px-2 py-1 bg-green-500/20 text-green-400 rounded text-xs font-semibold">
                            ACTIVE
                          </span>
                        )}
                        {user.passwordReset?.active ? (
                          <div className="text-[11px] text-amber-300 text-center">
                            Reset Enabled
                            <div className="text-[10px] text-amber-200/80">
                              Expires {formatResetExpiry(user.passwordReset.expiresAt)}
                            </div>
                          </div>
                        ) : user.recoveryConfigured === false ? (
                          <div className="text-[11px] text-orange-300 text-center">Recovery setup required</div>
                        ) : (
                          <div className="text-[11px] text-gray-500 text-center">Recovery ready</div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => {
                            setSelectedUser(user);
                            setShowGrantModal(true);
                          }}
                          className="px-3 py-1 bg-green-600 hover:bg-green-500 rounded text-xs transition"
                          title="Grant / view one-time usage credits"
                        >
                          + Credits
                        </button>
                        <button
                          onClick={() => {
                            setSelectedUser(user);
                            setNewPlan(user.planId);
                            setShowPlanModal(true);
                          }}
                          className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs transition"
                          title="Admin override / base plan"
                        >
                          Plan / Override
                        </button>
                        <button
                          onClick={() => handleToggleBilling(user)}
                          className={`px-3 py-1 rounded text-xs transition ${
                            user.billingEnabled === false
                              ? "bg-gray-700 hover:bg-gray-600"
                              : "bg-purple-600 hover:bg-purple-500"
                          }`}
                          title={
                            user.billingEnabled === false
                              ? "Enable billing for this user (Stripe live)"
                              : "Disable billing for this user (Test Mode)"
                          }
                        >
                          {user.billingEnabled === false ? "Billing: OFF" : "Billing: ON"}
                        </button>
                        <button
                          onClick={() => handleEnablePasswordReset(user)}
                          disabled={!user.canEnablePasswordReset || resetLoadingUserId === user.userId}
                          className={`px-3 py-1 rounded text-xs transition ${
                            !user.canEnablePasswordReset
                              ? "bg-gray-800 text-gray-500 cursor-not-allowed"
                              : user.passwordReset?.active
                                ? "bg-amber-700/60 hover:bg-amber-700 text-amber-100"
                                : "bg-red-700 hover:bg-red-600"
                          }`}
                          title={
                            !user.canEnablePasswordReset
                              ? "You can only enable resets for non-admin users other than yourself."
                              : user.passwordReset?.active
                                ? "Reset enabled. Click to issue a new one-time code (voids the old one)."
                                : "Enable a one-time password reset and get a code for this user"
                          }
                        >
                          {resetLoadingUserId === user.userId
                            ? "Enabling..."
                            : user.passwordReset?.active
                              ? "New Reset Code"
                              : "Reset Password"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredData.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              No users found matching your criteria
            </div>
          )}
          {nextCursor && (
            <div className="text-center py-4">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                {loadingMore ? "Loading…" : "Load more users"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* One-time usage credits (grant / list / revoke) */}
      {showGrantModal && selectedUser && (
        <Modal
          title="One-time usage credits"
          onClose={() => {
            setShowGrantModal(false);
            fetchData();
          }}
          onConfirm={() => {
            setShowGrantModal(false);
            fetchData();
          }}
          confirmLabel="Done"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">User</label>
              <div className="text-gray-400">{selectedUser.email}</div>
            </div>
            <UsageCreditsPanel userId={selectedUser.userId} onMessage={(m) => alert(m)} />
          </div>
        </Modal>
      )}

      {/* Change Plan Modal */}
      {showPlanModal && selectedUser && (
        <Modal
          title="Plan: Admin Override / Base Plan"
          onClose={() => setShowPlanModal(false)}
          onConfirm={handleChangePlan}
          confirmLabel="Set base plan"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">User</label>
              <div className="text-gray-400">{selectedUser.email}</div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Admin Override (recommended)</label>
              <PlanOverridePanel
                userId={selectedUser.userId}
                basePlanId={selectedUser.basePlanId || selectedUser.planId}
                effectivePlanId={selectedUser.effectivePlanId}
                planOverride={selectedUser.planOverride ?? null}
                decidedBy={selectedUser.decidedBy}
                subscriptionBlockedReason={selectedUser.subscriptionBlockedReason}
                planOptions={planOptions}
                onChanged={async () => {
                  setShowPlanModal(false);
                  await fetchData();
                }}
              />
            </div>
            <div className="border-t border-gray-800 pt-4">
              <div className="text-sm text-gray-500 mb-2">
                Base plan (owned by Stripe/billing): <span className="font-semibold">{selectedUser.planId}</span>
              </div>
              <label className="block text-sm font-medium mb-2">Set base plan (no Stripe)</label>
              <select
                value={newPlan}
                onChange={(e) => setNewPlan(e.target.value)}
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded text-white"
              >
                {planOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || p.id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Reason (optional)</label>
              <textarea
                value={planChangeReason}
                onChange={(e) => setPlanChangeReason(e.target.value)}
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded text-white"
                placeholder="e.g., Customer request, promotional upgrade"
                rows={3}
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Helper Components

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: string }) {
  return (
    <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
      <div className="flex items-center justify-between mb-2">
        <span className="text-2xl">{icon}</span>
      </div>
      <div className="text-2xl font-bold mb-1">{value}</div>
      <div className="text-sm text-gray-400">{label}</div>
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
  onConfirm,
  confirmLabel = "Confirm",
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
}) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-lg max-w-2xl w-full p-6 border border-gray-800 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">{title}</h2>
        {children}
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded transition"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 rounded transition font-semibold"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function getPlanColor(planId: string): string {
  const colors: Record<string, string> = {
    free: "bg-gray-500/20 text-gray-300",
    basic: "bg-sky-500/20 text-sky-300",
    starter: "bg-blue-500/20 text-blue-300",
    pro: "bg-purple-500/20 text-purple-300",
    enterprise: "bg-orange-500/20 text-orange-300",
    internal_unlimited: "bg-emerald-500/20 text-emerald-300",
  };
  return colors[planId] || colors.free;
}

function formatResetExpiry(expiresAt?: number | null) {
  if (!expiresAt) return "soon";
  try {
    return new Date(expiresAt).toLocaleString();
  } catch {
    return "soon";
  }
}