import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

interface UsageData {
  userId: string;
  email: string;
  displayName?: string;
  planId: "free" | "starter" | "pro" | "enterprise";
  minutesUsed: number;
  bonusMinutes: number;
  planLimit: number;
  effectiveLimit: number;
  percentUsed: number;
  isBlocked: boolean;
  lastActive?: Date;
}

interface AdminStats {
  totalUsers: number;
  usersByPlan: Record<string, number>;
  activeToday: number;
  activeThisWeek: number;
  activeThisMonth: number;
  totalMinutesUsed: number;
  averageMinutesPerUser: number;
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
  
  // Modal states
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UsageData | null>(null);
  
  // Form states
  const [minutesToGrant, setMinutesToGrant] = useState("");
  const [grantReason, setGrantReason] = useState("");
  const [newPlan, setNewPlan] = useState<string>("free");
  const [planChangeReason, setPlanChangeReason] = useState("");

  // Get admin user ID (in production, extract from JWT)
  const adminUserId = localStorage.getItem("sl_userId") || "admin";

  useEffect(() => {
    fetchData();
  }, [selectedPlan]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch usage data
      const usageUrl = new URL(`${API_BASE}/api/admin/usage`);
      usageUrl.searchParams.append("adminUserId", adminUserId);
      usageUrl.searchParams.append("limit", "100");
      if (selectedPlan !== "all") {
        usageUrl.searchParams.append("plan", selectedPlan);
      }

      const usageRes = await fetch(usageUrl.toString());
      
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

      // Fetch stats
      const statsUrl = new URL(`${API_BASE}/api/admin/stats`);
      statsUrl.searchParams.append("adminUserId", adminUserId);

      const statsRes = await fetch(statsUrl.toString());
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

  const handleGrantMinutes = async () => {
    if (!selectedUser || !minutesToGrant) return;

    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${selectedUser.userId}/grant-minutes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminUserId,
          minutes: parseInt(minutesToGrant),
          reason: grantReason,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to grant minutes");
      }

      alert(`Successfully granted ${minutesToGrant} minutes to ${selectedUser.email}`);
      setShowGrantModal(false);
      setMinutesToGrant("");
      setGrantReason("");
      fetchData(); // Refresh data
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleChangePlan = async () => {
    if (!selectedUser) return;

    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${selectedUser.userId}/change-plan`, {
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

      alert(`Successfully changed ${selectedUser.email} to ${newPlan} plan`);
      setShowPlanModal(false);
      setPlanChangeReason("");
      fetchData(); // Refresh data
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleToggleBilling = async (user: UsageData) => {
    const newState = !user.isBlocked; // Simplified for this example

    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${user.userId}/toggle-billing`, {
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

  // Filter data by search query
  const filteredData = usageData.filter((user) => {
    const query = searchQuery.toLowerCase();
    return (
      user.email.toLowerCase().includes(query) ||
      user.displayName?.toLowerCase().includes(query) ||
      user.userId.toLowerCase().includes(query)
    );
  });

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
            onClick={() => nav("/dashboard")}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">Admin Usage Dashboard</h1>
            <p className="text-gray-400">Manage users, plans, and feature flags</p>
          </div>
          <button
            onClick={() => nav("/dashboard")}
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
              label="Total Minutes"
              value={Math.round(stats.totalMinutesUsed).toLocaleString()}
              icon="⏱️"
            />
            <StatCard
              label="Avg Minutes/User"
              value={Math.round(stats.averageMinutesPerUser)}
              icon="📊"
            />
          </div>
        )}

        {/* Plan Distribution */}
        {stats && (
          <div className="bg-gray-900 rounded-lg p-6 mb-8">
            <h2 className="text-xl font-semibold mb-4">Users by Plan</h2>
            <div className="grid grid-cols-4 gap-4">
              {Object.entries(stats.usersByPlan).map(([plan, count]) => (
                <div key={plan} className="text-center">
                  <div className="text-2xl font-bold text-red-500">{count}</div>
                  <div className="text-sm text-gray-400 capitalize">{plan}</div>
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
                placeholder="Search by email, name, or user ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded text-white"
              />
            </div>
            <select
              value={selectedPlan}
              onChange={(e) => setSelectedPlan(e.target.value)}
              className="px-4 py-2 bg-gray-800 border border-gray-700 rounded text-white"
            >
              <option value="all">All Plans</option>
              <option value="free">Free</option>
              <option value="starter">Starter</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
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
                  <th className="px-4 py-3 text-right text-sm font-semibold">Usage</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold">Limit</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold">Bonus</th>
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
                        {user.planId.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {user.minutesUsed} min
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {user.effectiveLimit} min
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-green-400">
                      +{user.bonusMinutes}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {user.isBlocked ? (
                        <span className="px-2 py-1 bg-red-500/20 text-red-400 rounded text-xs font-semibold">
                          BLOCKED
                        </span>
                      ) : (
                        <span className="px-2 py-1 bg-green-500/20 text-green-400 rounded text-xs font-semibold">
                          ACTIVE
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => {
                            setSelectedUser(user);
                            setShowGrantModal(true);
                          }}
                          className="px-3 py-1 bg-green-600 hover:bg-green-500 rounded text-xs transition"
                          title="Grant minutes"
                        >
                          + Minutes
                        </button>
                        <button
                          onClick={() => {
                            setSelectedUser(user);
                            setNewPlan(user.planId);
                            setShowPlanModal(true);
                          }}
                          className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs transition"
                          title="Change plan"
                        >
                          Change Plan
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
        </div>
      </div>

      {/* Grant Minutes Modal */}
      {showGrantModal && selectedUser && (
        <Modal
          title="Grant Bonus Minutes"
          onClose={() => setShowGrantModal(false)}
          onConfirm={handleGrantMinutes}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">User</label>
              <div className="text-gray-400">{selectedUser.email}</div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Minutes to Grant</label>
              <input
                type="number"
                value={minutesToGrant}
                onChange={(e) => setMinutesToGrant(e.target.value)}
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded text-white"
                placeholder="e.g., 120"
                min="1"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Reason (optional)</label>
              <textarea
                value={grantReason}
                onChange={(e) => setGrantReason(e.target.value)}
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded text-white"
                placeholder="e.g., Compensation for service issue"
                rows={3}
              />
            </div>
          </div>
        </Modal>
      )}

      {/* Change Plan Modal */}
      {showPlanModal && selectedUser && (
        <Modal
          title="Change User Plan"
          onClose={() => setShowPlanModal(false)}
          onConfirm={handleChangePlan}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">User</label>
              <div className="text-gray-400">{selectedUser.email}</div>
              <div className="text-sm text-gray-500">
                Current plan: <span className="font-semibold">{selectedUser.planId}</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">New Plan</label>
              <select
                value={newPlan}
                onChange={(e) => setNewPlan(e.target.value)}
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded text-white"
              >
                <option value="free">Free (60 min)</option>
                <option value="starter">Starter (300 min)</option>
                <option value="pro">Pro (1200 min)</option>
                <option value="enterprise">Enterprise (Unlimited)</option>
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
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-lg max-w-md w-full p-6 border border-gray-800">
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
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

function getPlanColor(planId: string): string {
  const colors: Record<string, string> = {
    free: "bg-gray-500/20 text-gray-300",
    starter: "bg-blue-500/20 text-blue-300",
    pro: "bg-purple-500/20 text-purple-300",
    enterprise: "bg-orange-500/20 text-orange-300",
  };
  return colors[planId] || colors.free;
}