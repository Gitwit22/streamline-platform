import { useEffect, useState, useCallback } from "react";
import { Shield, Users, Settings, Key, FileText, Loader2, Plus, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { demoSeedId } from "@/lib/demoPaths";
import { fetchUsers, updateUserRole, inviteUser, fetchAuditLog, fetchSettings, updateSettings, type OrgUser, type AuditEntry, type OrgSettings } from "../api/admin";
import { useCorporateMe } from "../layout/CorporateProtectedRoute";
import { isCorporateBypassEnabled } from "../state/corporateMode";

const tabs = ["Overview", "Users", "Roles", "Security", "Audit Logs", "Settings"] as const;
type Tab = (typeof tabs)[number];

const demoUsers: OrgUser[] = [
  { uid: demoSeedId("corporate", "usr", 1), email: "sarah.kim@corp.io", displayName: "Sarah Kim", role: "owner", department: "Engineering", joinedAt: Date.now() - 365 * 86400_000 },
  { uid: demoSeedId("corporate", "usr", 2), email: "dev.patel@corp.io", displayName: "Dev Patel", role: "employee", department: "Engineering", joinedAt: Date.now() - 200 * 86400_000 },
  { uid: demoSeedId("corporate", "usr", 3), email: "marcus.j@corp.io", displayName: "Marcus Johnson", role: "employee", department: "Sales", joinedAt: Date.now() - 150 * 86400_000 },
  { uid: demoSeedId("corporate", "usr", 4), email: "lisa.chen@corp.io", displayName: "Lisa Chen", role: "employee", department: "Marketing", joinedAt: Date.now() - 90 * 86400_000 },
  { uid: demoSeedId("corporate", "usr", 5), email: "tom.w@corp.io", displayName: "Tom Wilson", role: "employee", department: "Operations", joinedAt: Date.now() - 30 * 86400_000 },
];

const demoAudit: AuditEntry[] = [
  { id: demoSeedId("corporate", "audit", 1), action: "user.role.update", actor: "sarah.kim@corp.io", target: "dev.patel@corp.io", detail: "Role changed to manager", timestamp: Date.now() - 3600_000 },
  { id: demoSeedId("corporate", "audit", 2), action: "broadcast.create", actor: "dev.patel@corp.io", target: "Q1 Town Hall", detail: "Broadcast created", timestamp: Date.now() - 7200_000 },
  { id: demoSeedId("corporate", "audit", 3), action: "document.upload", actor: "marcus.j@corp.io", target: "Employee Handbook v3.2", detail: "New version uploaded", timestamp: Date.now() - 86400_000 },
  { id: demoSeedId("corporate", "audit", 4), action: "settings.update", actor: "sarah.kim@corp.io", target: "org.settings", detail: "SSO enabled", timestamp: Date.now() - 2 * 86400_000 },
  { id: demoSeedId("corporate", "audit", 5), action: "user.invite", actor: "sarah.kim@corp.io", target: "newuser@corp.io", detail: "Invitation sent", timestamp: Date.now() - 3 * 86400_000 },
];

const demoSettings: OrgSettings = { orgName: "Acme Corp", ssoEnabled: true, defaultRole: "employee", allowGuestAccess: false, retentionDays: 90 };

const adminSections = [
  { icon: Users, title: "User Management", desc: "Manage employees, roles, and department assignments", tab: "Users" as Tab },
  { icon: Shield, title: "Security & SSO", desc: "Single sign-on, audit logs, and encryption settings", tab: "Security" as Tab },
  { icon: Key, title: "Permissions", desc: "Role-based access control and department segmentation", tab: "Roles" as Tab },
  { icon: FileText, title: "Audit Logs", desc: "Complete activity tracking and compliance reporting", tab: "Audit Logs" as Tab },
  { icon: Settings, title: "Platform Settings", desc: "Branding, integrations, and broadcast configuration", tab: "Settings" as Tab },
];

function formatDate(ms: number) { return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }); }
function formatTime(ms: number) { return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }

export default function Admin() {
  const bypass = isCorporateBypassEnabled();
  const me = useCorporateMe();
  const isAdmin = me?.orgRole === "owner" || me?.orgRole === "admin";

  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [loading, setLoading] = useState(false);

  // Invite state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);

  const loadTab = useCallback(async (tab: Tab) => {
    setLoading(true);
    try {
      if (tab === "Users" || tab === "Roles") {
        if (bypass) setUsers(demoUsers);
        else { const res = await fetchUsers(); setUsers(res.users); }
      }
      if (tab === "Audit Logs") {
        if (bypass) setAudit(demoAudit);
        else { const res = await fetchAuditLog({ limit: 50 }); setAudit(res.entries); }
      }
      if (tab === "Settings" || tab === "Security") {
        if (bypass) setSettings(demoSettings);
        else setSettings(await fetchSettings());
      }
    } catch { /* noop */ }
    finally { setLoading(false); }
  }, [bypass]);

  useEffect(() => { if (activeTab !== "Overview") loadTab(activeTab); }, [activeTab, loadTab]);

  const handleRoleChange = async (uid: string, role: string) => {
    if (!bypass) await updateUserRole(uid, role);
    setUsers(prev => prev.map(u => u.uid === uid ? { ...u, role } : u));
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      if (!bypass) await inviteUser({ email: inviteEmail.trim() });
      setInviteEmail("");
    } finally { setInviting(false); }
  };

  const handleSettingsUpdate = async (patch: Partial<OrgSettings>) => {
    const merged = { ...settings, ...patch } as OrgSettings;
    setSettings(merged);
    if (!bypass) await updateSettings(patch);
  };

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="flex items-center gap-0.5 px-7 border-b border-border bg-surface sticky top-0 z-10">
        {tabs.map((tab) => (
          <span key={tab} onClick={() => setActiveTab(tab)} className={cn("px-4 py-3.5 text-[13px] font-medium cursor-pointer border-b-2 -mb-px transition-colors", activeTab === tab ? "text-primary border-primary" : "text-muted-foreground border-transparent hover:text-foreground")}>
            {tab}
          </span>
        ))}
      </div>

      <div className="flex-1 p-6 flex flex-col gap-5 overflow-y-auto">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Admin</h1>
          <p className="text-xs text-muted-foreground mt-1">Platform administration, user management, and security settings</p>
        </div>

        {loading && <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>}

        {/* Overview */}
        {activeTab === "Overview" && !loading && (
          <div className="grid grid-cols-2 gap-3">
            {adminSections.map((s, i) => (
              <div key={i} onClick={() => setActiveTab(s.tab)} className="bg-surface border border-border rounded-xl p-5 hover:border-border-2 cursor-pointer transition-colors group">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-accent-soft flex items-center justify-center flex-shrink-0">
                    <s.icon className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="text-[14px] font-semibold text-foreground group-hover:text-primary transition-colors">{s.title}</div>
                    <div className="text-xs text-muted-foreground mt-1">{s.desc}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Users */}
        {activeTab === "Users" && !loading && (
          <>
            {isAdmin && (
              <div className="flex gap-3">
                <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleInvite()} placeholder="Invite by email…" className="flex-1 max-w-sm bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary placeholder:text-muted-foreground/50" />
                <button disabled={inviting || !inviteEmail.trim()} onClick={handleInvite} className="px-4 h-9 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold disabled:opacity-50 inline-flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" /> {inviting ? "Sending…" : "Invite"}
                </button>
              </div>
            )}
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
              <div className="grid grid-cols-[1fr_160px_120px_120px_100px] gap-4 px-[18px] py-3 border-b border-border text-[10px] font-semibold text-muted-foreground tracking-[1px] uppercase">
                <span>User</span><span>Email</span><span>Role</span><span>Department</span><span>Joined</span>
              </div>
              {users.map(u => (
                <div key={u.uid} className="grid grid-cols-[1fr_160px_120px_120px_100px] gap-4 items-center px-[18px] py-3 border-b border-border last:border-b-0 hover:bg-surface-2 transition-colors">
                  <span className="text-[13px] font-medium text-foreground">{u.displayName}</span>
                  <span className="text-xs text-muted-foreground truncate">{u.email}</span>
                  <div>
                    {isAdmin ? (
                      <select value={u.role} onChange={e => handleRoleChange(u.uid, e.target.value)} className="bg-surface-2 border border-border rounded px-2 py-1 text-xs text-foreground outline-none">
                        {["owner", "admin", "employee"].map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    ) : (
                      <span className={cn("text-xs font-mono px-2 py-0.5 rounded-full border", u.role === "owner" ? "bg-amber-500/10 text-amber-400 border-amber-400/20" : u.role === "admin" ? "bg-sl-red-dim text-sl-red border-sl-red/20" : "bg-surface-3 text-muted-foreground border-border-2")}>{u.role}</span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">{u.department}</span>
                  <span className="text-[11px] text-muted-foreground font-mono">{formatDate(u.joinedAt)}</span>
                </div>
              ))}
              {users.length === 0 && <div className="text-center py-8 text-sm text-muted-foreground">No users found</div>}
            </div>
          </>
        )}

        {/* Roles */}
        {activeTab === "Roles" && !loading && (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="px-[18px] py-3.5 border-b border-border"><span className="text-[13px] font-semibold text-foreground">Role Definitions</span></div>
            {[
              { role: "owner", desc: "Top authority — full platform access, can promote admins, manage all settings", count: users.filter(u => u.role === "owner").length },
              { role: "admin", desc: "Management access — company setup, user management, analytics, settings", count: users.filter(u => u.role === "admin").length },
              { role: "employee", desc: "Day-to-day access — chat, calls, broadcasts, training, documents", count: users.filter(u => u.role === "employee").length },
            ].map(r => (
              <div key={r.role} className="flex items-center gap-4 px-[18px] py-3.5 border-b border-border last:border-b-0">
                <span className={cn("text-xs font-mono font-semibold px-2.5 py-1 rounded-full border min-w-[70px] text-center", r.role === "owner" ? "bg-amber-500/10 text-amber-400 border-amber-400/20" : r.role === "admin" ? "bg-sl-red-dim text-sl-red border-sl-red/20" : "bg-surface-3 text-muted-foreground border-border-2")}>{r.role}</span>
                <div className="flex-1">
                  <div className="text-[13px] text-foreground">{r.desc}</div>
                </div>
                <span className="font-mono text-xs text-muted-foreground">{r.count} users</span>
              </div>
            ))}
          </div>
        )}

        {/* Audit Logs */}
        {activeTab === "Audit Logs" && !loading && (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="grid grid-cols-[120px_160px_1fr_1fr_100px] gap-4 px-[18px] py-3 border-b border-border text-[10px] font-semibold text-muted-foreground tracking-[1px] uppercase">
              <span>Action</span><span>Actor</span><span>Target</span><span>Detail</span><span>Time</span>
            </div>
            {audit.map(a => (
              <div key={a.id} className="grid grid-cols-[120px_160px_1fr_1fr_100px] gap-4 items-center px-[18px] py-3 border-b border-border last:border-b-0 hover:bg-surface-2 transition-colors">
                <span className="text-[11px] font-mono text-primary">{a.action}</span>
                <span className="text-xs text-muted-foreground truncate">{a.actor}</span>
                <span className="text-xs text-foreground truncate">{a.target}</span>
                <span className="text-xs text-muted-foreground truncate">{a.detail}</span>
                <span className="text-[10px] text-muted-foreground font-mono">{formatTime(a.timestamp)}</span>
              </div>
            ))}
            {audit.length === 0 && <div className="text-center py-8 text-sm text-muted-foreground">No audit events</div>}
          </div>
        )}

        {/* Security */}
        {activeTab === "Security" && !loading && settings && (
          <div className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-4">
            <h3 className="text-[14px] font-semibold text-foreground">Security Settings</h3>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <div><div className="text-[13px] text-foreground">Single Sign-On (SSO)</div><div className="text-[11px] text-muted-foreground">Enable SAML/OIDC enterprise SSO</div></div>
              <button onClick={() => handleSettingsUpdate({ ssoEnabled: !settings.ssoEnabled })} className={cn("px-3 py-1 rounded-full text-xs font-semibold border", settings.ssoEnabled ? "bg-sl-green-dim text-sl-green border-sl-green/20" : "bg-surface-3 text-muted-foreground border-border-2")}>{settings.ssoEnabled ? "Enabled" : "Disabled"}</button>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <div><div className="text-[13px] text-foreground">Guest Access</div><div className="text-[11px] text-muted-foreground">Allow external guests to join broadcasts</div></div>
              <button onClick={() => handleSettingsUpdate({ allowGuestAccess: !settings.allowGuestAccess })} className={cn("px-3 py-1 rounded-full text-xs font-semibold border", settings.allowGuestAccess ? "bg-sl-green-dim text-sl-green border-sl-green/20" : "bg-surface-3 text-muted-foreground border-border-2")}>{settings.allowGuestAccess ? "Enabled" : "Disabled"}</button>
            </div>
            <div className="flex items-center justify-between py-2">
              <div><div className="text-[13px] text-foreground">Data Retention</div><div className="text-[11px] text-muted-foreground">Auto-delete messages and recordings after period</div></div>
              <span className="font-mono text-xs text-primary">{settings.retentionDays} days</span>
            </div>
          </div>
        )}

        {/* Settings */}
        {activeTab === "Settings" && !loading && settings && (
          <div className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-4">
            <h3 className="text-[14px] font-semibold text-foreground">Organization Settings</h3>
            <div className="flex items-center gap-3 py-2 border-b border-border">
              <span className="text-[13px] text-muted-foreground w-[140px]">Organization Name</span>
              <input value={settings.orgName} onChange={e => handleSettingsUpdate({ orgName: e.target.value })} className="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
            </div>
            <div className="flex items-center gap-3 py-2 border-b border-border">
              <span className="text-[13px] text-muted-foreground w-[140px]">Default Role</span>
              <select value={settings.defaultRole} onChange={e => handleSettingsUpdate({ defaultRole: e.target.value })} className="bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none">
                {["owner", "admin", "employee"].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-3 py-2">
              <span className="text-[13px] text-muted-foreground w-[140px]">Retention (days)</span>
              <input type="number" value={settings.retentionDays} onChange={e => handleSettingsUpdate({ retentionDays: Number(e.target.value) || 90 })} className="w-24 bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
