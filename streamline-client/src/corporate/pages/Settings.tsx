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
  Eye,
  EyeOff,
  ClipboardCopy,
} from "lucide-react";
import { useCorporateMe } from "../layout/CorporateProtectedRoute";
import { isCorporateBypassEnabled } from "../state/corporateMode";
import {
  getOrgInfo,
  getOrgMembers,
  regenerateJoinCode,
  removeMember,
  changeMemberRole,
  type OrgInfoResult,
  type OrgMember,
} from "../api/orgs";

type Tab = "company" | "members" | "personal";

export default function CorporateSettings() {
  const bypass = isCorporateBypassEnabled();
  const me = useCorporateMe();
  const isAdmin = me?.orgRole === "owner" || me?.orgRole === "admin";

  const [tab, setTab] = useState<Tab>(isAdmin ? "company" : "personal");
  const [loading, setLoading] = useState(false);
  const [org, setOrg] = useState<OrgInfoResult | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [copied, setCopied] = useState(false);
  const [copiedInstructions, setCopiedInstructions] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState("");
  const [removingUid, setRemovingUid] = useState<string | null>(null);
  const [changingRoleUid, setChangingRoleUid] = useState<string | null>(null);
  const [codeRevealed, setCodeRevealed] = useState(false);

  /* -- Fetch org info ------------------------------------------------ */
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
    if (bypass || !isAdmin) return;
    setLoading(true);
    try {
      const list = await getOrgMembers();
      setMembers(list);
    } catch (e: any) {
      setError(e.message || "Failed to load members");
    } finally {
      setLoading(false);
    }
  }, [bypass, isAdmin]);

  useEffect(() => {
    loadOrg();
  }, [loadOrg]);

  useEffect(() => {
    if (tab === "members") loadMembers();
  }, [tab, loadMembers]);

  /* -- Actions ------------------------------------------------------- */
  const copyCode = () => {
    if (!org?.joinCode) return;
    navigator.clipboard.writeText(org.joinCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyJoinInstructions = () => {
    const slug = org?.slug || "your-slug";
    const code = org?.joinCode || "XXXX-XXXX";
    const text = [
      "Join our organization on StreamLine Corporate:",
      "",
      `1. Go to ${window.location.origin}/streamline/corporate`,
      "2. Sign up or log in",
      '3. Choose "Join an Organization"',
      `4. Enter slug: ${slug}`,
      `5. Enter code: ${code}`,
    ].join("\n");
    navigator.clipboard.writeText(text);
    setCopiedInstructions(true);
    setTimeout(() => setCopiedInstructions(false), 2500);
  };

  const handleRegenerate = async () => {
    if (!window.confirm("Generate a new join code? The old code will stop working immediately.")) return;
    setRegenerating(true);
    try {
      const newCode = await regenerateJoinCode();
      setOrg((prev) => (prev ? { ...prev, joinCode: newCode } : prev));
      setCodeRevealed(true);
    } catch (e: any) {
      setError(e.message || "Regenerate failed");
    } finally {
      setRegenerating(false);
    }
  };

  const handleRemoveMember = async (uid: string, name: string) => {
    if (!window.confirm(`Remove ${name || uid} from the organization? This cannot be undone.`)) return;
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

  const handleRoleChange = async (uid: string, newRole: string) => {
    setChangingRoleUid(uid);
    try {
      await changeMemberRole(uid, newRole);
      setMembers((prev) => prev.map((m) => (m.uid === uid ? { ...m, role: newRole } : m)));
    } catch (e: any) {
      setError(e.message || "Role change failed");
    } finally {
      setChangingRoleUid(null);
    }
  };

  /* -- Tab styles helper ---------------------------------------------- */
  const tabCls = (t: Tab) =>
    `px-4 py-3.5 text-[13px] font-medium cursor-pointer border-b-2 -mb-px transition-colors ${
      tab === t
        ? "text-[hsl(197,89%,66%)] border-[hsl(197,89%,66%)]"
        : "text-[hsl(214,25%,50%)] border-transparent hover:text-white"
    }`;

  const formatDate = (ms: number | null) =>
    ms ? new Date(ms).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "\u2014";

  const roleBadge = (role: string) => {
    const styles: Record<string, { bg: string; color: string }> = {
      owner: { bg: "hsl(40 90% 50% / 0.15)", color: "hsl(40 90% 60%)" },
      admin: { bg: "hsl(197 89% 66% / 0.15)", color: "hsl(197 89% 66%)" },
      employee: { bg: "hsl(215 28% 18%)", color: "hsl(214 25% 55%)" },
    };
    const s = styles[role] || styles.employee;
    return (
      <span
        className="text-xs font-mono px-2 py-0.5 rounded-full w-fit"
        style={{ background: s.bg, color: s.color }}
      >
        {role}
      </span>
    );
  };

  const maskedCode = org?.joinCode ? org.joinCode.replace(/./g, "\u2022") : "\u2022\u2022\u2022\u2022-\u2022\u2022\u2022\u2022";

  /* -- Render --------------------------------------------------------- */
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
        {isAdmin && (
          <>
            <span className={tabCls("company")} onClick={() => setTab("company")}>
              Company
            </span>
            <span className={tabCls("members")} onClick={() => setTab("members")}>
              Members
            </span>
          </>
        )}
        <span className={tabCls("personal")} onClick={() => setTab("personal")}>
          Personal
        </span>
      </div>

      <div className="flex-1 p-6 flex flex-col gap-5 overflow-y-auto">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2" style={{ color: "#fff" }}>
            <SettingsIcon className="w-5 h-5" style={{ color: "hsl(197 89% 66%)" }} />
            Settings
          </h1>
          <p className="text-xs mt-1" style={{ color: "hsl(214 25% 50%)" }}>
            {isAdmin ? "Organization settings, membership, and your profile" : "Your profile and preferences"}
          </p>
        </div>

        {error && (
          <div
            className="rounded-lg px-4 py-3 text-sm"
            style={{ background: "hsl(0 70% 20% / 0.3)", border: "1px solid hsl(0 50% 30%)", color: "hsl(0 80% 70%)" }}
          >
            {error}
            <button className="ml-3 underline text-xs" onClick={() => setError("")}>dismiss</button>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: "hsl(197 89% 66%)" }} />
          </div>
        )}

        {/* =============== Company Settings (admin-only) =============== */}
        {tab === "company" && isAdmin && !loading && (
          <div className="flex flex-col gap-4">
            {/* Org identity card */}
            <div
              className="rounded-xl p-5 flex flex-col gap-4"
              style={{ background: "hsl(218 35% 13%)", border: "1px solid hsl(215 35% 20%)" }}
            >
              <div className="flex items-center gap-3 mb-1">
                <Building2 className="w-5 h-5" style={{ color: "hsl(197 89% 66%)" }} />
                <span className="text-sm font-semibold" style={{ color: "#fff" }}>Company Profile</span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] font-semibold tracking-[1px] uppercase mb-1" style={{ color: "hsl(214 25% 45%)" }}>
                    Company Name
                  </div>
                  <div className="text-sm" style={{ color: "#fff" }}>
                    {org?.name || me?.orgName || "\u2014"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold tracking-[1px] uppercase mb-1" style={{ color: "hsl(214 25% 45%)" }}>
                    Slug
                    <span className="text-[9px] ml-1 normal-case font-normal" style={{ color: "hsl(214 25% 40%)" }}>(read-only)</span>
                  </div>
                  <div className="text-sm font-mono" style={{ color: "hsl(197 89% 66%)" }}>
                    {org?.slug || "\u2014"}
                  </div>
                </div>
              </div>
            </div>

            {/* Join code card with reveal / copy / regenerate */}
            <div
              className="rounded-xl p-5 flex flex-col gap-4"
              style={{ background: "hsl(218 35% 13%)", border: "1px solid hsl(215 35% 20%)" }}
            >
              <div className="flex items-center gap-3 mb-1">
                <Key className="w-5 h-5" style={{ color: "hsl(142 60% 55%)" }} />
                <span className="text-sm font-semibold" style={{ color: "#fff" }}>Join Code</span>
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full font-mono"
                  style={{ background: "hsl(142 60% 55% / 0.15)", color: "hsl(142 60% 55%)" }}
                >
                  admin only
                </span>
              </div>

              <p className="text-xs" style={{ color: "hsl(214 25% 55%)" }}>
                New team members sign up, then enter your org slug and this code to join.
              </p>

              {/* Code display - masked by default */}
              <div className="flex items-center gap-3">
                <div
                  className="flex-1 px-4 py-3 rounded-lg font-mono text-lg tracking-[0.25em] text-center select-all"
                  style={{
                    background: "hsl(218 35% 8%)",
                    border: "1px solid hsl(215 35% 20%)",
                    color: "hsl(142 60% 55%)",
                  }}
                >
                  {codeRevealed ? (org?.joinCode || "\u2014\u2014\u2014") : maskedCode}
                </div>
                <button
                  onClick={() => setCodeRevealed(!codeRevealed)}
                  title={codeRevealed ? "Hide code" : "Reveal code"}
                  className="p-2.5 rounded-lg transition-colors"
                  style={{ background: "hsl(215 28% 18%)", border: "1px solid hsl(215 35% 20%)", color: "hsl(214 25% 60%)" }}
                >
                  {codeRevealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <button
                  onClick={copyCode}
                  title="Copy code"
                  className="p-2.5 rounded-lg transition-colors"
                  style={{
                    background: "hsl(215 28% 18%)",
                    border: "1px solid hsl(215 35% 20%)",
                    color: copied ? "hsl(142 60% 55%)" : "hsl(214 25% 60%)",
                  }}
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
                <button
                  onClick={handleRegenerate}
                  disabled={regenerating}
                  title="Regenerate join code"
                  className="p-2.5 rounded-lg transition-colors disabled:opacity-50"
                  style={{ background: "hsl(215 28% 18%)", border: "1px solid hsl(215 35% 20%)", color: "hsl(214 25% 60%)" }}
                >
                  <RefreshCw className={`w-4 h-4 ${regenerating ? "animate-spin" : ""}`} />
                </button>
              </div>

              {/* Copy join instructions button */}
              <button
                onClick={copyJoinInstructions}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-medium transition-colors self-start"
                style={{
                  background: "hsl(215 28% 18%)",
                  border: "1px solid hsl(215 35% 20%)",
                  color: copiedInstructions ? "hsl(142 60% 55%)" : "hsl(214 25% 65%)",
                }}
              >
                {copiedInstructions ? <Check className="w-4 h-4" /> : <ClipboardCopy className="w-4 h-4" />}
                {copiedInstructions ? "Instructions copied!" : "Copy join instructions"}
              </button>
            </div>

            {/* Danger zone */}
            <div
              className="rounded-xl p-5 flex flex-col gap-4"
              style={{ background: "hsl(0 70% 15% / 0.15)", border: "1px solid hsl(0 50% 25%)" }}
            >
              <div className="flex items-center gap-3 mb-1">
                <Trash2 className="w-5 h-5" style={{ color: "hsl(355 82% 65%)" }} />
                <span className="text-sm font-semibold" style={{ color: "hsl(355 82% 65%)" }}>Danger Zone</span>
              </div>

              {bypass && (
                <div
                  className="flex items-center justify-between rounded-lg px-4 py-3"
                  style={{ background: "hsl(218 35% 13%)", border: "1px solid hsl(215 35% 20%)" }}
                >
                  <div>
                    <div className="text-sm font-medium" style={{ color: "#fff" }}>Exit Demo Mode</div>
                    <div className="text-xs mt-0.5" style={{ color: "hsl(214 25% 50%)" }}>
                      Remove demo data and switch to real mode.
                    </div>
                  </div>
                  <button
                    onClick={() => { localStorage.removeItem("sl_corporate_bypass"); window.location.reload(); }}
                    className="px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors flex-shrink-0"
                    style={{ background: "hsl(355 82% 55% / 0.2)", border: "1px solid hsl(355 82% 55% / 0.4)", color: "hsl(355 82% 65%)" }}
                  >
                    Remove Demo Data
                  </button>
                </div>
              )}

              <div
                className="flex items-center justify-between rounded-lg px-4 py-3"
                style={{ background: "hsl(218 35% 13%)", border: "1px solid hsl(215 35% 20%)" }}
              >
                <div>
                  <div className="text-sm font-medium" style={{ color: "#fff" }}>Clear Local Cache</div>
                  <div className="text-xs mt-0.5" style={{ color: "hsl(214 25% 50%)" }}>
                    Clear all local storage. You will be logged out.
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (!window.confirm("Clear all cached data and log out?")) return;
                    localStorage.clear();
                    window.location.href = "/streamline/corporate/login";
                  }}
                  className="px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors flex-shrink-0"
                  style={{ background: "hsl(355 82% 55% / 0.2)", border: "1px solid hsl(355 82% 55% / 0.4)", color: "hsl(355 82% 65%)" }}
                >
                  Clear & Log Out
                </button>
              </div>
            </div>
          </div>
        )}

        {/* =============== Members (admin-only) ======================== */}
        {tab === "members" && isAdmin && !loading && (
          <div className="flex flex-col gap-4">
            <div
              className="rounded-xl overflow-hidden"
              style={{ background: "hsl(218 35% 13%)", border: "1px solid hsl(215 35% 20%)" }}
            >
              <div className="flex items-center gap-3 px-5 py-4">
                <Users className="w-5 h-5" style={{ color: "hsl(197 89% 66%)" }} />
                <span className="text-sm font-semibold" style={{ color: "#fff" }}>Organization Members</span>
                <span
                  className="text-xs font-mono px-2 py-0.5 rounded-full"
                  style={{ background: "hsl(197 89% 66% / 0.15)", color: "hsl(197 89% 66%)" }}
                >
                  {members.length}
                </span>
              </div>

              {/* Header */}
              <div
                className="grid grid-cols-[1fr_180px_110px_90px_100px_60px] gap-3 px-5 py-2.5 text-[10px] font-semibold tracking-[1px] uppercase"
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
                <span>Status</span>
                <span>Joined</span>
                <span />
              </div>

              {members.length === 0 && (
                <div className="px-5 py-8 text-center text-sm" style={{ color: "hsl(214 25% 50%)" }}>
                  No members yet &mdash; share your join code to invite people
                </div>
              )}

              {members.map((m) => (
                <div
                  key={m.uid}
                  className="grid grid-cols-[1fr_180px_110px_90px_100px_60px] gap-3 items-center px-5 py-3 transition-colors hover:bg-[hsl(215_28%_18%_/_0.4)]"
                  style={{ borderBottom: "1px solid hsl(215 35% 20% / 0.5)", color: "#fff" }}
                >
                  {/* Name + avatar */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold flex-shrink-0"
                      style={{ background: "linear-gradient(135deg, hsl(215 35% 22%), hsl(215 28% 28%))", color: "#fff" }}
                    >
                      {(m.displayName || m.email || "?").split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?"}
                    </div>
                    <span className="truncate text-sm font-medium">{m.displayName || "\u2014"}</span>
                  </div>

                  {/* Email */}
                  <span className="truncate text-xs" style={{ color: "hsl(214 25% 60%)" }}>{m.email}</span>

                  {/* Role dropdown */}
                  <div>
                    {m.uid !== me?.uid && me?.orgRole === "owner" ? (
                      <select
                        value={m.role}
                        onChange={(e) => handleRoleChange(m.uid, e.target.value)}
                        disabled={changingRoleUid === m.uid}
                        className="text-xs font-mono px-2 py-1 rounded-lg outline-none cursor-pointer disabled:opacity-50"
                        style={{ background: "hsl(218 35% 10%)", border: "1px solid hsl(215 35% 20%)", color: "hsl(214 25% 65%)" }}
                      >
                        <option value="owner">owner</option>
                        <option value="admin">admin</option>
                        <option value="employee">employee</option>
                      </select>
                    ) : m.uid !== me?.uid && me?.orgRole === "admin" && m.role !== "owner" ? (
                      <select
                        value={m.role}
                        onChange={(e) => handleRoleChange(m.uid, e.target.value)}
                        disabled={changingRoleUid === m.uid}
                        className="text-xs font-mono px-2 py-1 rounded-lg outline-none cursor-pointer disabled:opacity-50"
                        style={{ background: "hsl(218 35% 10%)", border: "1px solid hsl(215 35% 20%)", color: "hsl(214 25% 65%)" }}
                      >
                        <option value="admin">admin</option>
                        <option value="employee">employee</option>
                      </select>
                    ) : (
                      roleBadge(m.role)
                    )}
                  </div>

                  {/* Status */}
                  <span
                    className="text-xs font-mono px-2 py-0.5 rounded-full w-fit"
                    style={{
                      background: m.status === "active" ? "hsl(142 60% 55% / 0.12)" : "hsl(215 28% 18%)",
                      color: m.status === "active" ? "hsl(142 60% 55%)" : "hsl(214 25% 55%)",
                    }}
                  >
                    {m.status || "active"}
                  </span>

                  {/* Joined */}
                  <span className="text-xs" style={{ color: "hsl(214 25% 55%)" }}>{formatDate(m.joinedAt)}</span>

                  {/* Remove */}
                  <div>
                    {m.uid !== me?.uid && m.role !== "owner" && (
                      <button
                        onClick={() => handleRemoveMember(m.uid, m.displayName || m.email)}
                        disabled={removingUid === m.uid}
                        title="Remove member"
                        className="p-1.5 rounded-lg transition-colors disabled:opacity-50 hover:bg-[hsl(355_82%_65%_/_0.1)]"
                        style={{ color: "hsl(355 82% 65%)" }}
                      >
                        {removingUid === m.uid ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserMinus className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* =============== Personal Settings (everyone) ================ */}
        {tab === "personal" && !loading && (
          <div className="flex flex-col gap-4">
            {/* Your account card */}
            <div
              className="rounded-xl p-5 flex flex-col gap-3"
              style={{ background: "hsl(218 35% 13%)", border: "1px solid hsl(215 35% 20%)" }}
            >
              <div className="flex items-center gap-3 mb-1">
                <Shield className="w-5 h-5" style={{ color: "hsl(197 89% 66%)" }} />
                <span className="text-sm font-semibold" style={{ color: "#fff" }}>Your Account</span>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-[10px] font-semibold tracking-[1px] uppercase mb-1" style={{ color: "hsl(214 25% 45%)" }}>
                    Display Name
                  </div>
                  <div className="text-sm" style={{ color: "#fff" }}>{me?.displayName || "\u2014"}</div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold tracking-[1px] uppercase mb-1" style={{ color: "hsl(214 25% 45%)" }}>
                    Email
                  </div>
                  <div className="text-sm" style={{ color: "#fff" }}>{me?.email || "\u2014"}</div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold tracking-[1px] uppercase mb-1" style={{ color: "hsl(214 25% 45%)" }}>
                    Role
                  </div>
                  {roleBadge(me?.orgRole || "employee")}
                </div>
              </div>
            </div>

            {/* Organization info (read-only for everyone) */}
            <div
              className="rounded-xl p-5 flex flex-col gap-3"
              style={{ background: "hsl(218 35% 13%)", border: "1px solid hsl(215 35% 20%)" }}
            >
              <div className="flex items-center gap-3 mb-1">
                <Building2 className="w-5 h-5" style={{ color: "hsl(197 89% 66%)" }} />
                <span className="text-sm font-semibold" style={{ color: "#fff" }}>Organization</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] font-semibold tracking-[1px] uppercase mb-1" style={{ color: "hsl(214 25% 45%)" }}>Name</div>
                  <div className="text-sm" style={{ color: "#fff" }}>{org?.name || me?.orgName || "\u2014"}</div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold tracking-[1px] uppercase mb-1" style={{ color: "hsl(214 25% 45%)" }}>Slug</div>
                  <div className="text-sm font-mono" style={{ color: "hsl(197 89% 66%)" }}>{org?.slug || "\u2014"}</div>
                </div>
              </div>
            </div>

            {/* Clear cache */}
            <div
              className="rounded-xl p-5 flex flex-col gap-4"
              style={{ background: "hsl(0 70% 15% / 0.15)", border: "1px solid hsl(0 50% 25%)" }}
            >
              <div className="flex items-center gap-3 mb-1">
                <Trash2 className="w-5 h-5" style={{ color: "hsl(355 82% 65%)" }} />
                <span className="text-sm font-semibold" style={{ color: "hsl(355 82% 65%)" }}>Session</span>
              </div>
              <div
                className="flex items-center justify-between rounded-lg px-4 py-3"
                style={{ background: "hsl(218 35% 13%)", border: "1px solid hsl(215 35% 20%)" }}
              >
                <div>
                  <div className="text-sm font-medium" style={{ color: "#fff" }}>Clear Local Cache</div>
                  <div className="text-xs mt-0.5" style={{ color: "hsl(214 25% 50%)" }}>
                    Clear cache and log out. You'll need to sign in again.
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (!window.confirm("Clear all cached data and log out?")) return;
                    localStorage.clear();
                    window.location.href = "/streamline/corporate/login";
                  }}
                  className="px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors flex-shrink-0"
                  style={{ background: "hsl(355 82% 55% / 0.2)", border: "1px solid hsl(355 82% 55% / 0.4)", color: "hsl(355 82% 65%)" }}
                >
                  Clear & Log Out
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}