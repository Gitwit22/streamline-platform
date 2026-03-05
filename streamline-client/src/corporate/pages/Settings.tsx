import { useCallback, useEffect, useState } from "react";
import {
  Settings as SettingsIcon,
  Copy,
  Check,
  RefreshCw,
  Users,
  Building2,
  Key,
  Trash2,
  Loader2,
  UserMinus,
  Shield,
} from "lucide-react";
import { useCorporateMe } from "../layout/CorporateProtectedRoute";
import { isCorporateBypassEnabled } from "../state/corporateMode";
import {
  getOrgInfo,
  getOrgMembers,
  regenerateJoinCode,
  removeMember,
  type OrgInfoResult,
  type OrgMember,
} from "../api/orgs";

type Tab = "general" | "members" | "danger";

export default function CorporateSettings() {
  const bypass = isCorporateBypassEnabled();
  const me = useCorporateMe();
  const isLeader = me?.orgRole === "leader";

  const [tab, setTab] = useState<Tab>("general");
  const [loading, setLoading] = useState(false);
  const [org, setOrg] = useState<OrgInfoResult | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState("");
  const [removingUid, setRemovingUid] = useState<string | null>(null);

  /* ── Fetch org info ─────────────────────────────────────────────── */
  const loadOrg = useCallback(async () => {
    if (bypass) return;
    setLoading(true);
    try {
      const info = await getOrgInfo();
      setOrg(info);
    } catch (e: any) {
      setError(e.message || "Failed to load org info");
    } finally {
      setLoading(false);
    }
  }, [bypass]);

  const loadMembers = useCallback(async () => {
    if (bypass || !isLeader) return;
    setLoading(true);
    try {
      const list = await getOrgMembers();
      setMembers(list);
    } catch (e: any) {
      setError(e.message || "Failed to load members");
    } finally {
      setLoading(false);
    }
  }, [bypass, isLeader]);

  useEffect(() => {
    loadOrg();
  }, [loadOrg]);

  useEffect(() => {
    if (tab === "members") loadMembers();
  }, [tab, loadMembers]);

  /* ── Actions ────────────────────────────────────────────────────── */
  const copyCode = () => {
    if (!org?.joinCode) return;
    navigator.clipboard.writeText(org.joinCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRegenerate = async () => {
    if (!window.confirm("Generate a new join code? The old code will stop working.")) return;
    setRegenerating(true);
    try {
      const newCode = await regenerateJoinCode();
      setOrg((prev) => (prev ? { ...prev, joinCode: newCode } : prev));
    } catch (e: any) {
      setError(e.message || "Regenerate failed");
    } finally {
      setRegenerating(false);
    }
  };

  const handleRemoveMember = async (uid: string, name: string) => {
    if (!window.confirm(`Remove ${name || uid} from the organization?`)) return;
    setRemovingUid(uid);
    try {
      await removeMember(uid);
      setMembers((prev) => prev.filter((m) => m.uid !== uid));
    } catch (e: any) {
      setError(e.message || "Remove failed");
    } finally {
      setRemovingUid(null);
    }
  };

  const handleClearBypass = () => {
    localStorage.removeItem("sl_corporate_bypass");
    window.location.reload();
  };

  /* ── Tab styles helper ──────────────────────────────────────────── */
  const tabCls = (t: Tab) =>
    `px-4 py-3.5 text-[13px] font-medium cursor-pointer border-b-2 -mb-px transition-colors ${
      tab === t
        ? "text-[hsl(197,89%,66%)] border-[hsl(197,89%,66%)]"
        : "text-[hsl(214,25%,50%)] border-transparent hover:text-white"
    }`;

  const formatDate = (ms: number | null) =>
    ms ? new Date(ms).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "—";

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Tab bar */}
      <div
        className="flex items-center gap-0.5 px-7 sticky top-0 z-10"
        style={{
          borderBottom: "1px solid hsl(215 35% 20%)",
          background: "hsl(218 35% 11%)",
        }}
      >
        <span className={tabCls("general")} onClick={() => setTab("general")}>
          General
        </span>
        {isLeader && (
          <span className={tabCls("members")} onClick={() => setTab("members")}>
            Members
          </span>
        )}
        <span className={tabCls("danger")} onClick={() => setTab("danger")}>
          Danger Zone
        </span>
      </div>

      <div className="flex-1 p-6 flex flex-col gap-5 overflow-y-auto">
        <div>
          <h1
            className="text-xl font-bold tracking-tight flex items-center gap-2"
            style={{ color: "#fff" }}
          >
            <SettingsIcon className="w-5 h-5" style={{ color: "hsl(197 89% 66%)" }} />
            Settings
          </h1>
          <p className="text-xs mt-1" style={{ color: "hsl(214 25% 50%)" }}>
            Organization settings, membership, and administration
          </p>
        </div>

        {error && (
          <div
            className="rounded-lg px-4 py-3 text-sm"
            style={{
              background: "hsl(0 70% 20% / 0.3)",
              border: "1px solid hsl(0 50% 30%)",
              color: "hsl(0 80% 70%)",
            }}
          >
            {error}
            <button
              className="ml-3 underline text-xs"
              onClick={() => setError("")}
            >
              dismiss
            </button>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2
              className="w-5 h-5 animate-spin"
              style={{ color: "hsl(197 89% 66%)" }}
            />
          </div>
        )}

        {/* ──── General tab ──────────────────────────────────────────── */}
        {tab === "general" && !loading && (
          <div className="flex flex-col gap-4">
            {/* Org info card */}
            <div
              className="rounded-xl p-5 flex flex-col gap-4"
              style={{
                background: "hsl(218 35% 13%)",
                border: "1px solid hsl(215 35% 20%)",
              }}
            >
              <div className="flex items-center gap-3 mb-1">
                <Building2
                  className="w-5 h-5"
                  style={{ color: "hsl(197 89% 66%)" }}
                />
                <span
                  className="text-sm font-semibold"
                  style={{ color: "#fff" }}
                >
                  Organization
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div
                    className="text-[10px] font-semibold tracking-[1px] uppercase mb-1"
                    style={{ color: "hsl(214 25% 45%)" }}
                  >
                    Name
                  </div>
                  <div className="text-sm" style={{ color: "#fff" }}>
                    {org?.name || me?.orgName || "—"}
                  </div>
                </div>
                <div>
                  <div
                    className="text-[10px] font-semibold tracking-[1px] uppercase mb-1"
                    style={{ color: "hsl(214 25% 45%)" }}
                  >
                    Slug
                  </div>
                  <div
                    className="text-sm font-mono"
                    style={{ color: "hsl(197 89% 66%)" }}
                  >
                    {org?.slug || "—"}
                  </div>
                </div>
              </div>
            </div>

            {/* Join code card */}
            {isLeader && (
              <div
                className="rounded-xl p-5 flex flex-col gap-4"
                style={{
                  background: "hsl(218 35% 13%)",
                  border: "1px solid hsl(215 35% 20%)",
                }}
              >
                <div className="flex items-center gap-3 mb-1">
                  <Key
                    className="w-5 h-5"
                    style={{ color: "hsl(142 60% 55%)" }}
                  />
                  <span
                    className="text-sm font-semibold"
                    style={{ color: "#fff" }}
                  >
                    Join Code
                  </span>
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full font-mono"
                    style={{
                      background: "hsl(142 60% 55% / 0.15)",
                      color: "hsl(142 60% 55%)",
                    }}
                  >
                    Share with your team
                  </span>
                </div>

                <p className="text-xs" style={{ color: "hsl(214 25% 55%)" }}>
                  Team members sign up, then enter your org slug and this code to
                  join.
                </p>

                <div className="flex items-center gap-3">
                  <div
                    className="flex-1 px-4 py-3 rounded-lg font-mono text-lg tracking-[0.25em] text-center select-all"
                    style={{
                      background: "hsl(218 35% 8%)",
                      border: "1px solid hsl(215 35% 20%)",
                      color: "hsl(142 60% 55%)",
                    }}
                  >
                    {org?.joinCode || "———"}
                  </div>
                  <button
                    onClick={copyCode}
                    title="Copy to clipboard"
                    className="p-2.5 rounded-lg transition-colors"
                    style={{
                      background: "hsl(215 28% 18%)",
                      border: "1px solid hsl(215 35% 20%)",
                      color: copied ? "hsl(142 60% 55%)" : "hsl(214 25% 60%)",
                    }}
                  >
                    {copied ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={handleRegenerate}
                    disabled={regenerating}
                    title="Regenerate join code"
                    className="p-2.5 rounded-lg transition-colors disabled:opacity-50"
                    style={{
                      background: "hsl(215 28% 18%)",
                      border: "1px solid hsl(215 35% 20%)",
                      color: "hsl(214 25% 60%)",
                    }}
                  >
                    <RefreshCw
                      className={`w-4 h-4 ${regenerating ? "animate-spin" : ""}`}
                    />
                  </button>
                </div>
              </div>
            )}

            {/* Your info */}
            <div
              className="rounded-xl p-5 flex flex-col gap-3"
              style={{
                background: "hsl(218 35% 13%)",
                border: "1px solid hsl(215 35% 20%)",
              }}
            >
              <div className="flex items-center gap-3 mb-1">
                <Shield
                  className="w-5 h-5"
                  style={{ color: "hsl(197 89% 66%)" }}
                />
                <span
                  className="text-sm font-semibold"
                  style={{ color: "#fff" }}
                >
                  Your Account
                </span>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div
                    className="text-[10px] font-semibold tracking-[1px] uppercase mb-1"
                    style={{ color: "hsl(214 25% 45%)" }}
                  >
                    Name
                  </div>
                  <div className="text-sm" style={{ color: "#fff" }}>
                    {me?.displayName || "—"}
                  </div>
                </div>
                <div>
                  <div
                    className="text-[10px] font-semibold tracking-[1px] uppercase mb-1"
                    style={{ color: "hsl(214 25% 45%)" }}
                  >
                    Email
                  </div>
                  <div className="text-sm" style={{ color: "#fff" }}>
                    {me?.email || "—"}
                  </div>
                </div>
                <div>
                  <div
                    className="text-[10px] font-semibold tracking-[1px] uppercase mb-1"
                    style={{ color: "hsl(214 25% 45%)" }}
                  >
                    Role
                  </div>
                  <div
                    className="text-sm font-mono"
                    style={{ color: "hsl(142 60% 55%)" }}
                  >
                    {me?.orgRole || "—"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ──── Members tab ──────────────────────────────────────────── */}
        {tab === "members" && !loading && isLeader && (
          <div className="flex flex-col gap-4">
            <div
              className="rounded-xl overflow-hidden"
              style={{
                background: "hsl(218 35% 13%)",
                border: "1px solid hsl(215 35% 20%)",
              }}
            >
              <div className="flex items-center gap-3 px-5 py-4">
                <Users
                  className="w-5 h-5"
                  style={{ color: "hsl(197 89% 66%)" }}
                />
                <span
                  className="text-sm font-semibold"
                  style={{ color: "#fff" }}
                >
                  Organization Members
                </span>
                <span
                  className="text-xs font-mono px-2 py-0.5 rounded-full"
                  style={{
                    background: "hsl(197 89% 66% / 0.15)",
                    color: "hsl(197 89% 66%)",
                  }}
                >
                  {members.length}
                </span>
              </div>

              {/* Header */}
              <div
                className="grid grid-cols-[1fr_180px_90px_100px_60px] gap-3 px-5 py-2.5 text-[10px] font-semibold tracking-[1px] uppercase"
                style={{
                  borderTop: "1px solid hsl(215 35% 20%)",
                  borderBottom: "1px solid hsl(215 35% 20%)",
                  color: "hsl(214 25% 45%)",
                  background: "hsl(218 35% 10%)",
                }}
              >
                <span>Name</span>
                <span>Email</span>
                <span>Role</span>
                <span>Joined</span>
                <span />
              </div>

              {members.length === 0 && (
                <div
                  className="px-5 py-8 text-center text-sm"
                  style={{ color: "hsl(214 25% 50%)" }}
                >
                  No members yet
                </div>
              )}

              {members.map((m) => (
                <div
                  key={m.uid}
                  className="grid grid-cols-[1fr_180px_90px_100px_60px] gap-3 items-center px-5 py-3 transition-colors"
                  style={{
                    borderBottom: "1px solid hsl(215 35% 20% / 0.5)",
                    color: "#fff",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "hsl(215 28% 18% / 0.4)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold flex-shrink-0"
                      style={{
                        background:
                          "linear-gradient(135deg, hsl(215 35% 22%), hsl(215 28% 28%))",
                        color: "#fff",
                      }}
                    >
                      {(m.displayName || m.email || "?")
                        .split(" ")
                        .slice(0, 2)
                        .map((w) => w[0]?.toUpperCase())
                        .join("") || "?"}
                    </div>
                    <span className="truncate text-sm font-medium">
                      {m.displayName || "—"}
                    </span>
                  </div>
                  <span
                    className="truncate text-xs"
                    style={{ color: "hsl(214 25% 60%)" }}
                  >
                    {m.email}
                  </span>
                  <span
                    className="text-xs font-mono px-2 py-0.5 rounded-full w-fit"
                    style={{
                      background:
                        m.role === "admin"
                          ? "hsl(197 89% 66% / 0.15)"
                          : "hsl(215 28% 18%)",
                      color:
                        m.role === "admin"
                          ? "hsl(197 89% 66%)"
                          : "hsl(214 25% 55%)",
                    }}
                  >
                    {m.role}
                  </span>
                  <span
                    className="text-xs"
                    style={{ color: "hsl(214 25% 55%)" }}
                  >
                    {formatDate(m.joinedAt)}
                  </span>
                  <div>
                    {m.uid !== me?.uid && (
                      <button
                        onClick={() =>
                          handleRemoveMember(
                            m.uid,
                            m.displayName || m.email,
                          )
                        }
                        disabled={removingUid === m.uid}
                        title="Remove member"
                        className="p-1.5 rounded-lg transition-colors disabled:opacity-50"
                        style={{ color: "hsl(355 82% 65%)" }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background =
                            "hsl(355 82% 65% / 0.1)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                      >
                        {removingUid === m.uid ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <UserMinus className="w-4 h-4" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ──── Danger zone tab ──────────────────────────────────────── */}
        {tab === "danger" && !loading && (
          <div className="flex flex-col gap-4">
            <div
              className="rounded-xl p-5 flex flex-col gap-4"
              style={{
                background: "hsl(0 70% 15% / 0.15)",
                border: "1px solid hsl(0 50% 25%)",
              }}
            >
              <div className="flex items-center gap-3 mb-1">
                <Trash2 className="w-5 h-5" style={{ color: "hsl(355 82% 65%)" }} />
                <span
                  className="text-sm font-semibold"
                  style={{ color: "hsl(355 82% 65%)" }}
                >
                  Danger Zone
                </span>
              </div>

              {/* Remove Demo Data */}
              {bypass && (
                <div
                  className="flex items-center justify-between rounded-lg px-4 py-3"
                  style={{
                    background: "hsl(218 35% 13%)",
                    border: "1px solid hsl(215 35% 20%)",
                  }}
                >
                  <div>
                    <div className="text-sm font-medium" style={{ color: "#fff" }}>
                      Exit Demo Mode
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: "hsl(214 25% 50%)" }}>
                      Remove all demo/mock data and switch to real mode. You will
                      need to log in again.
                    </div>
                  </div>
                  <button
                    onClick={handleClearBypass}
                    className="px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors flex-shrink-0"
                    style={{
                      background: "hsl(355 82% 55% / 0.2)",
                      border: "1px solid hsl(355 82% 55% / 0.4)",
                      color: "hsl(355 82% 65%)",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "hsl(355 82% 55% / 0.35)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "hsl(355 82% 55% / 0.2)";
                    }}
                  >
                    Remove Demo Data
                  </button>
                </div>
              )}

              {/* Clear local storage */}
              <div
                className="flex items-center justify-between rounded-lg px-4 py-3"
                style={{
                  background: "hsl(218 35% 13%)",
                  border: "1px solid hsl(215 35% 20%)",
                }}
              >
                <div>
                  <div className="text-sm font-medium" style={{ color: "#fff" }}>
                    Clear Local Cache
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: "hsl(214 25% 50%)" }}>
                    Clear all local storage and cached data. You will be logged out
                    and need to sign in again.
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (!window.confirm("Clear all cached data and log out?")) return;
                    localStorage.clear();
                    window.location.href = "/streamline/corporate/login";
                  }}
                  className="px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors flex-shrink-0"
                  style={{
                    background: "hsl(355 82% 55% / 0.2)",
                    border: "1px solid hsl(355 82% 55% / 0.4)",
                    color: "hsl(355 82% 65%)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "hsl(355 82% 55% / 0.35)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "hsl(355 82% 55% / 0.2)";
                  }}
                >
                  Clear Cache & Log Out
                </button>
              </div>

              {!bypass && (
                <div
                  className="rounded-lg px-4 py-3 text-xs"
                  style={{
                    background: "hsl(218 35% 13%)",
                    border: "1px solid hsl(215 35% 20%)",
                    color: "hsl(214 25% 55%)",
                  }}
                >
                  <strong style={{ color: "#fff" }}>No demo data present.</strong>{" "}
                  You signed up via real authentication — all data shown is live
                  from your organization's database. There is no mock data to remove.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
