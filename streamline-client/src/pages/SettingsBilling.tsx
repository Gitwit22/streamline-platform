


import React, { useEffect, useState } from "react";
import { getCanonicalPlanId } from "../lib/planUtils";
import { useNavigate } from "react-router-dom";
import "./SettingsBilling.css";
import { S } from "./SettingsBilling.styles";

const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

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
  };
  editing?: {
    access: boolean;
    maxProjects: number;
    maxStorageGB: number;
  };
}

interface UsageData {
  streamingMinutes: { used: number; limit: number };
  rtmpDestinations: { used: number; limit: number };
  storage: { used: number; limit: number };
  projects: { used: number; limit: number };
}

// ============================================================================
// DEFAULT PLAN DEFINITIONS (fallback if API fails)
// ============================================================================

const DEFAULT_PLANS: PlanDefinition[] = [
  {
    id: "free",
    name: "Free",
    price: 0,
    description: "Get started with the StreamLine room and invite a few guests",
    limits: {
      monthlyMinutesIncluded: 60,
      maxGuests: 1,
      rtmpDestinationsMax: 1,
      maxSessionMinutes: 30,
      maxHoursPerMonth: 1,
    },
    features: { recording: false, rtmp: false },
    editing: { access: false, maxProjects: 0, maxStorageGB: 0 },
  },
  {
    id: "starter", // ✅ canonical id (NOT starter_paid)
    name: "Starter",
    price: 15,
    description: "For starting creators, just getting started",
    limits: {
      monthlyMinutesIncluded: 300,
      maxGuests: 2,
      rtmpDestinationsMax: 2,
      maxSessionMinutes: 60,
      maxHoursPerMonth: 5,
    },
    features: { recording: true, rtmp: true, multistream: true },
    editing: { access: true, maxProjects: 5, maxStorageGB: 10 },
  },
  {
    id: "pro",
    name: "Pro",
    price: 49,
    description: "For professional streamers who want reach",
    limits: {
      monthlyMinutesIncluded: 1200,
      maxGuests: 10,
      rtmpDestinationsMax: 5,
      maxSessionMinutes: 180,
      maxHoursPerMonth: 20,
    },
    features: { recording: true, rtmp: true, multistream: true },
    editing: { access: true, maxProjects: 50, maxStorageGB: 100 },
  },
];


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
  targetPlan: "free" | "starter" | "pro",
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
type CheckoutPlanVariant = "starter_paid" | "starter_trial" | "pro";

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

  
  const DEFAULT_USAGE: UsageData = {
  streamingMinutes: { used: 0, limit: 60 },
  rtmpDestinations: { used: 0, limit: 1 },
  storage: { used: 0, limit: 5 },
  projects: { used: 0, limit: 1 },
};

const [user, setUser] = useState<UserData | null>(null);
  const [plans, setPlans] = useState<PlanDefinition[]>(DEFAULT_PLANS);
  const [usage, setUsage] = useState<UsageData>(DEFAULT_USAGE);

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<ActionLoading>(null);
  const [error, setError] = useState<string | null>(null);
  const [showManagePicker, setShowManagePicker] = useState(false);
  useEffect(() => {
    loadAllData();
  }, []);

  // Safe pending cleanup: only clear under safe conditions
  useEffect(() => {
    (async () => {
      if (!user?.pendingPlan) return;
      try {
        const res = await fetch(`${API_BASE}/api/billing/pending-change`, { credentials: "include" });
        if (!res.ok) return;
        const info = await res.json();
        const isFreeNoSub = user.planId === "free" && !info?.hasSubscription && !info?.billingActive;
        const noScheduled = info?.scheduledChange === false;
        const completed = user.billingStatus === "active" || user.billingStatus === "trialing";
        if (isFreeNoSub || noScheduled || completed) {
          try {
            await fetch(`${API_BASE}/api/billing/clear-pending`, { method: "POST", credentials: "include" });
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
      await Promise.all([loadUser(), loadPlans(), loadUsage()]);
    } catch (err: any) {
      setError(err?.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  const loadUser = async () => {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      credentials: "include",
    });
    if (!res.ok) throw new Error("Failed to load user");
    const data = await res.json();
    setUser(data);
  };

  const loadPlans = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/plans`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        if (data.plans?.length) {
          const first = data.plans[0];
          if (typeof first === "string") {
            const ids = new Set<string>(data.plans as string[]);
            const resolved = DEFAULT_PLANS.filter((p) => ids.has(p.id));
            if (resolved.length) {
              setPlans(resolved);
            } else {
              // If API returns unknown ids, keep defaults
              setPlans(DEFAULT_PLANS);
            }
          } else {
            // Assume server returned full plan objects
            setPlans(data.plans as PlanDefinition[]);
          }
        }
      }
    } catch {
      // Use defaults
    }
  };

 
  const loadUsage = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/usage/me`, { credentials: "include" });
      if (!res.ok) throw new Error("usage endpoint failed");

      const data = await res.json();
      const limits = data?.plan?.limits || {};

      setUsage({
        streamingMinutes: {
          used: Number(data?.usage?.participantMinutes ?? 0),
          limit: Number(limits.participantMinutes ?? 0) || (data?.plan?.id === "pro" ? 1200 : data?.plan?.id === "starter" ? 300 : 60),
        },
        rtmpDestinations: {
          used: 0,
          limit: Number(limits.maxDestinations ?? 0) || (data?.plan?.id === "pro" ? 5 : data?.plan?.id === "starter" ? 2 : 1),
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



const startCheckout = async (plan: CheckoutPlanVariant) => {
  setActionLoading(plan);
  try {
    const res = await fetch(`${API_BASE}/api/billing/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ plan }),
    });

    const data = await res.json();
    if (!data.success || !data.url) {
      throw new Error(data.error || "Checkout failed");
    }

    window.location.href = data.url;
  } catch (err: any) {
    setError(err.message || "Failed to start checkout. Please try again.");
    setActionLoading(null);
    setUser((prev) => (prev ? { ...prev, pendingPlan: null } : prev));
  }
};



  const openPortal = async () => {
    setActionLoading("portal");
    try {
      // If no Stripe customer, guide user into Checkout to create one
      if (!hasStripeCustomer) {
        setShowManagePicker(true);
        setActionLoading(null);
        return;
      }
      const res = await fetch(`${API_BASE}/api/billing/portal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Portal failed");
      window.location.href = data.url;
    } catch (err: any) {
      setError(err.message);
      setActionLoading(null);
    }
  };


// Canonicalize planId for display logic
function canonicalPlanId(planId: string | undefined): string {
  if (!planId) return "free";
  if (planId === "starter_paid" || planId === "starter_trial") return "starter";
  return planId;
}

const userPlanId = canonicalPlanId(user?.planId);
const currentPlan = plans.find((p) => p.id === userPlanId) || plans[0];
const status = user?.billingStatus;
const hasStripeCustomer = !!(user?.billing?.customerId || (user as any)?.stripeCustomerId);

const isPaidPlan = userPlanId === "starter" || userPlanId === "pro";
const isBlocked = isPaidPlan && (status === "past_due" || status === "unpaid");
const isPaidValid = status === "active" || status === "trialing";

// Only treat pendingPlan as processing for paid plans; always consider active action loads
const isProcessing = !!actionLoading || (userPlanId !== "free" && !!user?.pendingPlan);

const statusBadge = getStatusBadge(status, user?.billing?.cancelAtPeriodEnd);
const daysLeft = getDaysUntil(user?.billing?.currentPeriodEnd);


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

        {/* ================================================================ */}
        {/* SECTION 1: PAYMENT WARNING (if blocked) */}
        {/* ================================================================ */}
        {isBlocked && (
          <div style={S.warningCard}>
            <div style={S.warningIcon}>⚠️</div>
            <div style={S.warningContent}>
              <h3 style={S.warningTitle}>Payment Issue — Features Blocked</h3>
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

          {/* Primary Actions */}
          <div style={S.actionButtons}>
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
      onClick={() => startCheckout("starter_paid")}
      style={S.secondaryBtn}
      disabled={!!actionLoading}
    >
      {actionLoading === "starter_paid" ? "⏳ Loading..." : "Choose Plan"}
    </button>

    <button
      onClick={() => startCheckout("pro")}
      style={S.secondaryBtn}
      disabled={!!actionLoading}
    >
      {actionLoading === "pro" ? "⏳ Loading..." : "Choose Plan"}
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
                    {actionLoading === "pro" ? "⏳ Loading..." : "⚡ Upgrade to Pro"}
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
                    {actionLoading === "pro" ? "⏳ Loading..." : "⚡ Upgrade to Pro"}
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
                  {actionLoading ? "⏳ Loading..." : "🔄 Resubscribe"}
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
          </div>
        </div>

        {/* ================================================================ */}
        {/* SECTION 3: USAGE THIS MONTH */}
        {/* ================================================================ */}
        {usage && (
          <div style={{ ...S.card, opacity: isBlocked ? 0.6 : 1 }}>
            <div style={S.cardHeader}>
              <h2 style={S.cardTitle}>📊 Usage This Month</h2>
              {user?.billing?.currentPeriodEnd && (
                <span style={S.resetDate}>
                  Resets {formatDate(user.billing.currentPeriodEnd)}
                </span>
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
          </div>
        )}

       {/* ================================================================ */}
{/* SECTION 4: PLAN COMPARISON */}
{/* ================================================================ */}
<div style={S.card}>
  <h2 style={S.cardTitle}>📋 Compare Plans</h2>

  <div style={S.plansGrid}>
    {plans.map((plan) => {
      const userPlan = userPlanId;

      const color =
        plan.id === "free"
          ? "#6b7280"
          : plan.id === "starter"
          ? "#3b82f6"
          : "#8b5cf6";

      // Treat starter_paid and starter_trial as "starter" for current overlay
      const isCurrent = plan.id === userPlan;

      // Adjust upgrade/downgrade logic to use canonical plan id
      const isUpgrade =
        (userPlan === "free" && (plan.id === "starter" || plan.id === "pro")) ||
        (userPlan === "starter" && plan.id === "pro");

      const isDowngrade =
        (userPlan === "pro" && (plan.id === "starter" || plan.id === "free")) ||
        (userPlan === "starter" && plan.id === "free");

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
          </div>

          <ul style={S.featureList}>
            <FeatureRow label="Monthly minutes" value={plan.limits.monthlyMinutesIncluded} />
            <FeatureRow label="Max guests" value={plan.limits.maxGuests} />
            <FeatureRow label="RTMP destinations" value={plan.limits.rtmpDestinationsMax} />
            <FeatureRow label="Recording" value={plan.features.recording} />
            <FeatureRow label="Multistream" value={plan.features.multistream} />
            <FeatureRow label="Editing suite" value={plan.editing?.access} />
            {plan.editing?.access && (
              <>
                <FeatureRow label="Projects" value={plan.editing.maxProjects} />
                <FeatureRow label="Storage" value={`${plan.editing.maxStorageGB}GB`} />
              </>
            )}
          </ul>

          <div style={S.planCardAction}>
  {isCurrent ? (
    <span style={S.currentLabel}>✓ Current Plan</span>
  ) : plan.id === "starter" && userPlan === "free" ? (
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
  ) : plan.id === "starter" && userPlan === "pro" ? (
    <button
      onClick={openPortal}
      style={{
        ...S.planUpgradeBtn,
        background: `linear-gradient(135deg, ${color}, ${color}dd)`,
        opacity: 0.85,
      }}
      disabled={!!actionLoading || isBlocked}
    >
      {getPlanActionLabel(userPlan, "starter", isProcessing)}
    </button>
  ) : plan.id === "pro" && (userPlan === "free" || userPlan === "starter") ? (
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
  ) : plan.id === "free" && (userPlan === "starter" || userPlan === "pro") ? (
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
      {getPlanActionLabel(userPlan, plan.id as "starter" | "pro", isProcessing)}
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
                  icon="🎬"
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
                  icon="✂️"
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
      </div>

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
              const starterPlan = plans.find((p) => p.id === "starter");
              const proPlan = plans.find((p) => p.id === "pro");
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

function FeatureRow({ label, value }: { label: string; value: boolean | number | string | undefined }) {
  const displayValue = typeof value === "boolean" 
    ? (value ? "✓" : "—") 
    : value?.toString() || "—";
  const isEnabled = value === true || (typeof value === "number" && value > 0) || (typeof value === "string" && value !== "—");

  return (
    <li style={{ ...S.featureItem, opacity: isEnabled ? 1 : 0.5 }}>
      <span style={S.featureLabel}>{label}</span>
      <span style={{ ...S.featureValue, color: isEnabled ? "#22c55e" : "#6b7280" }}>
        {displayValue}
      </span>
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
}

// ============================================================================
// STYLES
// ============================================================================


// Styles moved to external files: SettingsBilling.styles.ts and SettingsBilling.css
