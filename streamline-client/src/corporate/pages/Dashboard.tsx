import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { StatCard, Panel } from "@/components/dashboard/DashboardCards";
import {
  Radio, Phone, Upload, Mail, Pencil,
  AlertTriangle, Activity, FileText, CheckCircle, AlertCircle,
  Lock, Loader2, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCorporateMe } from "../layout/CorporateProtectedRoute";
import { fetchBroadcasts, type Broadcast } from "../api/broadcasts";
import { fetchCalls, type Call } from "../api/calls";
import { fetchTraining, type TrainingModule } from "../api/training";
import { fetchChatRooms, type ChatRoom } from "../api/chat";
import { fetchAnalytics, type AnalyticsOverview } from "../api/admin";
import { isCorporateBypassEnabled } from "../state/corporateMode";

/* ── Demo fallback data (bypass mode) ─── */
const demoBroadcasts: Broadcast[] = [
  { id: "demo-1", title: "Q1 All-Hands Town Hall", description: "", team: "Executive Team", scope: "Company-wide", status: "live", required: false, scheduledAt: Date.now() - 18 * 60_000, startedAt: Date.now() - 18 * 60_000, endedAt: null, viewers: 847, createdAt: Date.now(), createdBy: "" },
  { id: "demo-2", title: "Annual Safety Briefing 2026", description: "", team: "HR & Compliance", scope: "company-wide", status: "scheduled", required: true, scheduledAt: Date.now() + 3600_000, startedAt: null, endedAt: null, viewers: 0, createdAt: Date.now(), createdBy: "" },
  { id: "demo-3", title: "Engineering Quarterly Review", description: "", team: "Engineering", scope: "department", status: "scheduled", required: false, scheduledAt: Date.now() + 86400_000, startedAt: null, endedAt: null, viewers: 0, createdAt: Date.now(), createdBy: "" },
  { id: "demo-4", title: "Data Privacy Policy Update", description: "", team: "Legal & Compliance", scope: "company-wide", status: "scheduled", required: true, scheduledAt: Date.now() + 3 * 86400_000, startedAt: null, endedAt: null, viewers: 0, createdAt: Date.now(), createdBy: "" },
];

const demoTraining: TrainingModule[] = [
  { id: "t1", title: "OSHA Safety Training 2026", description: "", department: "HR & Compliance", type: "required", status: "active", durationMinutes: 42, deadline: Date.now() + 15 * 86400_000, assignedTo: "all", completionRate: 0, totalAssigned: 0, totalCompleted: 0, icon: "shield", createdAt: Date.now(), createdBy: "", userProgress: 0, userStatus: "not_started", userCompletedAt: null },
  { id: "t2", title: "Data Privacy & GDPR", description: "", department: "Legal", type: "required", status: "active", durationMinutes: 28, deadline: null, assignedTo: "all", completionRate: 60, totalAssigned: 0, totalCompleted: 0, icon: "lock", createdAt: Date.now(), createdBy: "", userProgress: 60, userStatus: "in_progress", userCompletedAt: null },
  { id: "t3", title: "Remote Work Policy 2026", description: "", department: "HR", type: "required", status: "active", durationMinutes: 15, deadline: null, assignedTo: "all", completionRate: 100, totalAssigned: 0, totalCompleted: 0, icon: "check", createdAt: Date.now(), createdBy: "", userProgress: 100, userStatus: "completed", userCompletedAt: Date.now() },
  { id: "t4", title: "Anti-Harassment Policy", description: "", department: "HR & Legal", type: "required", status: "active", durationMinutes: 20, deadline: Date.now() - 86400_000, assignedTo: "all", completionRate: 0, totalAssigned: 0, totalCompleted: 0, icon: "alert", createdAt: Date.now(), createdBy: "", userProgress: 0, userStatus: "not_started", userCompletedAt: null },
];

const demoChatRooms: ChatRoom[] = [
  { id: "r1", name: "general", section: "department", isPrivate: false, unreadCount: 12, lastMessage: "Sarah K: Did everyone get the policy update?", lastMessageAt: Date.now(), memberCount: 120, createdAt: Date.now() },
  { id: "r2", name: "engineering", section: "department", isPrivate: false, unreadCount: 4, lastMessage: "Dev: Sprint review notes are posted", lastMessageAt: Date.now(), memberCount: 45, createdAt: Date.now() },
  { id: "r3", name: "project-alpha", section: "project", isPrivate: true, unreadCount: 0, lastMessage: "Marcus: Deployment window confirmed for Friday", lastMessageAt: Date.now(), memberCount: 8, createdAt: Date.now() },
];

const demoAnalytics: AnalyticsOverview = {
  overview: { totalBroadcasts: 4, liveBroadcasts: 1, scheduledBroadcasts: 3, completedBroadcasts: 0, totalCalls: 12, activeCalls: 12, totalTrainingModules: 8, avgCompletionRate: 87, totalMembers: 1204, activeMembers: 1180, totalMessages: 14500 },
  departments: [
    { name: "Engineering", complianceRate: 98, totalModules: 6 },
    { name: "Human Resources", complianceRate: 96, totalModules: 8 },
    { name: "Sales & Marketing", complianceRate: 88, totalModules: 5 },
    { name: "Operations", complianceRate: 74, totalModules: 4 },
    { name: "Customer Support", complianceRate: 61, totalModules: 5 },
  ],
};

/* ── Helpers ─── */
function formatRelativeTime(ms: number | null): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return new Date(ms).toLocaleDateString();
}

function formatScheduledDate(ms: number | null): string {
  if (!ms) return "";
  const d = new Date(ms);
  const diff = ms - Date.now();
  if (diff < 0 && diff > -3600_000) return `Started ${formatRelativeTime(ms)}`;
  if (diff > 0 && diff < 86400_000) return `Today · ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  if (diff > 86400_000 && diff < 2 * 86400_000) return `Tomorrow · ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const quickActions = [
  { icon: Radio, label: "Start Live Broadcast", accent: true, path: "/streamline/corporate/broadcasts" },
  { icon: Phone, label: "Start Call", accent: false, path: "/streamline/corporate/calls" },
  { icon: Upload, label: "Upload Recording", accent: false, path: "/streamline/corporate/calls" },
  { icon: Mail, label: "Post Announcement", accent: false, path: "/streamline/corporate/broadcasts" },
];

const dotColor = { red: "bg-sl-red", primary: "bg-primary", amber: "bg-sl-amber", green: "bg-sl-green" };

function complianceColor(pct: number) {
  if (pct >= 90) return { bar: "bg-sl-green", text: "text-sl-green" };
  if (pct >= 75) return { bar: "bg-primary", text: "text-primary" };
  if (pct >= 60) return { bar: "bg-sl-amber", text: "text-sl-amber" };
  return { bar: "bg-sl-red", text: "text-sl-red" };
}

function trainingStatusBadge(m: TrainingModule) {
  if (m.userProgress >= 100) return { label: "Completed", color: "green" };
  if (m.deadline && m.deadline < Date.now() && m.userProgress < 100) return { label: "Overdue", color: "red" };
  if (m.type === "required") return { label: "Required", color: "amber" };
  return { label: "Optional", color: "primary" };
}

function trainingProgressColor(m: TrainingModule) {
  if (m.userProgress >= 100) return { bar: "bg-sl-green", text: "text-sl-green" };
  if (m.deadline && m.deadline < Date.now()) return { bar: "bg-sl-red", text: "text-sl-red" };
  if (m.type === "required") return { bar: "bg-sl-amber", text: "text-sl-amber" };
  return { bar: "bg-primary", text: "text-primary" };
}

function trainingIcon(m: TrainingModule) {
  if (m.userProgress >= 100) return "✅";
  if (m.deadline && m.deadline < Date.now()) return "⚠️";
  if (m.icon === "shield" || m.type === "required") return "🛡️";
  return "🔒";
}

export default function Dashboard() {
  const me = useCorporateMe();
  const navigate = useNavigate();
  const bypass = isCorporateBypassEnabled();

  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [training, setTraining] = useState<TrainingModule[]>([]);
  const [chatRooms, setChatRooms] = useState<ChatRoom[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (bypass) {
        setBroadcasts(demoBroadcasts);
        setTraining(demoTraining);
        setChatRooms(demoChatRooms);
        setAnalytics(demoAnalytics);
      } else {
        const [bc, tr, cr, an] = await Promise.all([
          fetchBroadcasts({ limit: 10 }).catch(() => []),
          fetchTraining({ filter: "required", limit: 8 }).catch(() => []),
          fetchChatRooms().catch(() => []),
          fetchAnalytics().catch(() => null),
        ]);
        setBroadcasts(bc);
        setTraining(tr);
        setChatRooms(cr);
        setAnalytics(an);
      }
    } finally {
      setLoading(false);
    }
  }, [bypass]);

  useEffect(() => { load(); }, [load]);

  const liveBroadcast = broadcasts.find(b => b.status === "live");
  const o = analytics?.overview;

  const stats = [
    { label: "Active Calls", value: String(o?.activeCalls ?? 0), sub: `of ${o?.totalCalls ?? 0} total`, trend: { value: `${o?.activeCalls ?? 0} live`, up: true }, color: "primary" as const, progress: o?.totalCalls ? Math.round((o.activeCalls / o.totalCalls) * 100) : 0 },
    { label: "Broadcasts Today", value: String((o?.liveBroadcasts ?? 0) + (o?.scheduledBroadcasts ?? 0)), sub: `${o?.liveBroadcasts ?? 0} live · ${o?.scheduledBroadcasts ?? 0} scheduled`, trend: { value: `${o?.liveBroadcasts ?? 0} live`, up: true }, color: "green" as const, progress: 45 },
    { label: "Required Training", value: String(o?.totalTrainingModules ?? 0), sub: `avg ${o?.avgCompletionRate ?? 0}% complete`, trend: { value: `${o?.avgCompletionRate ?? 0}%`, up: (o?.avgCompletionRate ?? 0) >= 80 }, color: "amber" as const, progress: o?.avgCompletionRate ?? 0 },
    { label: "Compliance Rate", value: `${o?.avgCompletionRate ?? 0}%`, sub: "company average", trend: { value: `${o?.activeMembers ?? 0} active members`, up: (o?.avgCompletionRate ?? 0) >= 80 }, color: (o?.avgCompletionRate ?? 0) >= 80 ? "green" as const : "red" as const, progress: o?.avgCompletionRate ?? 0 },
  ];

  const departments = analytics?.departments ?? [];

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="p-6 flex flex-col gap-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Command Center</h1>
          <p className="text-xs text-muted-foreground mt-1">{dateStr} · {me?.orgName || "Corporate"}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg bg-surface-2 text-muted-foreground border border-border text-[13px] font-semibold hover:border-border-2 hover:text-foreground transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <button
            onClick={() => navigate("/streamline/corporate/calls")}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold hover:shadow-[0_0_20px_hsl(var(--accent-glow))] transition-all"
          >
            <Phone className="w-3.5 h-3.5" /> Start Call
          </button>
        </div>
      </div>

      {/* Live Banner */}
      {liveBroadcast && (
        <div className="bg-gradient-to-r from-accent-soft to-sl-navy/20 border border-primary/20 rounded-xl p-4 flex items-center gap-4 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-[120px] h-[120px] rounded-full bg-primary/[0.06] blur-sm" />
          <div className="flex items-center gap-1.5 bg-sl-red-dim border border-sl-red/30 rounded-full px-2.5 py-1 flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-sl-red animate-pulse-live" />
            <span className="text-[10px] font-bold text-sl-red tracking-[1px]">LIVE</span>
          </div>
          <div className="flex-1">
            <div className="text-[15px] font-semibold text-foreground">{liveBroadcast.title}</div>
            <div className="text-xs text-muted-foreground mt-1">{liveBroadcast.team} · {liveBroadcast.scope} · {formatScheduledDate(liveBroadcast.startedAt || liveBroadcast.scheduledAt)}</div>
            <div className="font-mono text-[11px] text-primary mt-1">{liveBroadcast.viewers.toLocaleString()} employees watching</div>
          </div>
          <button
            onClick={() => navigate("/streamline/corporate/broadcasts")}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold hover:shadow-[0_0_20px_hsl(var(--accent-glow))] transition-all"
          >
            ▶ Join Live
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {stats.map((s) => <StatCard key={s.label} {...s} />)}
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-[1fr_360px] gap-4">
        {/* Left: Broadcasts + Chat */}
        <div className="flex flex-col gap-4">
          <Panel title="Upcoming & Live" action={<span className="cursor-pointer" onClick={() => navigate("/streamline/corporate/broadcasts")}>View All →</span>}>
            {broadcasts.length === 0 && (
              <div className="px-[18px] py-6 text-center text-xs text-muted-foreground">No broadcasts scheduled</div>
            )}
            {broadcasts.map((b) => (
              <div key={b.id} className="flex items-start gap-3.5 px-[18px] py-3 border-b border-border last:border-b-0 hover:bg-surface-2 transition-colors cursor-pointer">
                <div className={cn("w-[72px] h-[44px] rounded-lg bg-surface-3 flex items-center justify-center border border-border relative flex-shrink-0")}>
                  <Radio className="w-5 h-5 text-primary/40" />
                  {b.status === "live" && <span className="absolute top-1 left-1 text-[8px] font-bold tracking-wider bg-sl-red text-foreground px-1.5 py-px rounded text-center">LIVE</span>}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-foreground">{b.title}</span>
                    {b.status === "live" && <span className="text-[10px] font-semibold bg-sl-red-dim text-sl-red border border-sl-red/20 px-2 py-0.5 rounded-full flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-sl-red animate-pulse-live" />LIVE</span>}
                    {b.required && <span className="text-[10px] font-semibold bg-sl-amber-dim text-sl-amber border border-sl-amber/20 px-2 py-0.5 rounded-full">Required</span>}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1 flex gap-2">
                    <span>{b.team}</span><span>·</span><span>{b.scope}</span><span>·</span><span>{formatScheduledDate(b.scheduledAt)}</span>
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    {b.status === "live" ? (
                      <button onClick={() => navigate("/streamline/corporate/broadcasts")} className="inline-flex items-center gap-1 px-3 h-7 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold hover:bg-primary/90">▶ Join Live</button>
                    ) : (
                      <button className="inline-flex items-center gap-1 px-3 h-7 rounded-md bg-surface-3 text-muted-foreground border border-border-2 text-[11px] font-semibold hover:text-foreground">Set Reminder</button>
                    )}
                    {b.viewers > 0 && <span className="font-mono text-[11px] text-muted-foreground flex items-center gap-1 ml-1">{b.viewers.toLocaleString()} watching</span>}
                  </div>
                </div>
              </div>
            ))}

            {/* Chat Rooms Preview */}
            <div className="px-[18px] py-3 border-t border-border">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-semibold text-muted-foreground">Active Chat Rooms</span>
                <span className="text-[11px] text-primary cursor-pointer font-medium" onClick={() => navigate("/streamline/corporate/chat")}>Open Chat →</span>
              </div>
            </div>
            {chatRooms.slice(0, 3).map((room) => (
              <div key={room.id} onClick={() => navigate("/streamline/corporate/chat")} className="flex items-center gap-2.5 px-[18px] py-2 border-b border-border last:border-b-0 hover:bg-surface-2 cursor-pointer transition-colors">
                <span className={cn("font-mono text-base flex-shrink-0 w-[18px] text-center", room.isPrivate ? "text-sl-amber" : "text-muted-foreground")}>#</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-foreground">{room.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate max-w-[180px]">{room.lastMessage}</div>
                </div>
                {room.unreadCount > 0 && <span className="bg-primary text-primary-foreground text-[10px] font-bold font-mono px-[7px] py-0.5 rounded-full">{room.unreadCount}</span>}
                {room.isPrivate && <Lock className="w-3 h-3 text-muted-foreground" />}
              </div>
            ))}
          </Panel>
        </div>

        {/* Right Column */}
        <div className="flex flex-col gap-3.5">
          {/* Quick Actions */}
          <Panel title="Quick Actions">
            <div className="grid grid-cols-2 gap-2 p-3.5">
              {quickActions.map((a, i) => (
                <div
                  key={i}
                  onClick={() => navigate(a.path)}
                  className={cn(
                    "flex flex-col items-start gap-1.5 p-3 rounded-lg border cursor-pointer transition-all",
                    a.accent
                      ? "bg-accent-soft border-primary/20 hover:border-primary/40"
                      : "bg-surface-2 border-border hover:border-border-2 hover:bg-surface-3"
                  )}
                >
                  <a.icon className={cn("w-4 h-4", a.accent ? "text-primary" : "text-muted-foreground")} />
                  <span className={cn("text-xs font-medium", a.accent ? "text-primary" : "text-muted-foreground")}>{a.label}</span>
                </div>
              ))}
              <div onClick={() => navigate("/streamline/corporate/training")} className="col-span-2 flex items-start gap-1.5 p-3 rounded-lg bg-surface-2 border border-border hover:border-border-2 hover:bg-surface-3 cursor-pointer transition-all">
                <Pencil className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Assign Required Training Module</span>
              </div>
            </div>
          </Panel>

          {/* Department Compliance */}
          <Panel title="Dept. Compliance" action={<span className="cursor-pointer" onClick={() => navigate("/streamline/corporate/analytics")}>Full Report →</span>}>
            {departments.length === 0 && (
              <div className="px-[18px] py-4 text-center text-xs text-muted-foreground">No department data yet</div>
            )}
            {departments.map((c) => {
              const cc = complianceColor(c.complianceRate);
              return (
                <div key={c.name} className="px-[18px] py-3 border-b border-border last:border-b-0">
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-xs font-medium text-foreground">{c.name}</span>
                    <span className={cn("font-mono text-xs", cc.text)}>{c.complianceRate}%</span>
                  </div>
                  <div className="h-1 bg-border rounded-full overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all duration-700", cc.bar)} style={{ width: `${c.complianceRate}%` }} />
                  </div>
                </div>
              );
            })}
          </Panel>
        </div>
      </div>

      {/* Bottom Row: Training + Activity */}
      <div className="grid grid-cols-[1fr_360px] gap-4">
        <Panel title="Training Queue — Required" action={<span className="cursor-pointer" onClick={() => navigate("/streamline/corporate/training")}>Open Library →</span>}>
          {training.length === 0 && (
            <div className="p-6 text-center text-xs text-muted-foreground">No training modules assigned</div>
          )}
          <div className="grid grid-cols-2 gap-2.5 p-3.5">
            {training.slice(0, 4).map((t) => {
              const badge = trainingStatusBadge(t);
              const pc = trainingProgressColor(t);
              return (
                <div key={t.id} onClick={() => navigate("/streamline/corporate/training")} className="bg-surface-2 border border-border rounded-lg p-3.5 hover:border-border-2 cursor-pointer transition-colors">
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-sm">{trainingIcon(t)}</span>
                    <span className={cn(
                      "text-[10px] font-semibold px-2 py-0.5 rounded-full border",
                      badge.color === "amber" ? "bg-sl-amber-dim text-sl-amber border-sl-amber/20"
                        : badge.color === "green" ? "bg-sl-green-dim text-sl-green border-sl-green/20"
                        : badge.color === "red" ? "bg-sl-red-dim text-sl-red border-sl-red/20"
                        : "bg-accent-soft text-primary border-primary/20"
                    )}>
                      {badge.label}
                    </span>
                  </div>
                  <div className="text-[13px] font-medium text-foreground mb-1">{t.title}</div>
                  <div className="text-[11px] text-muted-foreground">{t.department} · {t.durationMinutes} min</div>
                  <div className="mt-2.5">
                    <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                      <span>{t.userProgress === 0 ? "Not started" : t.userProgress >= 100 ? "Complete" : "In progress"}</span>
                      <span className={pc.text}>{t.userProgress}%</span>
                    </div>
                    <div className="h-[3px] bg-border rounded-full overflow-hidden">
                      <div className={cn("h-full rounded-full", pc.bar)} style={{ width: `${t.userProgress}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="Company Activity" action={<span className="cursor-pointer" onClick={() => navigate("/streamline/corporate/analytics")}>All →</span>}>
          {/* Summary items from analytics */}
          {o && (
            <>
              {o.liveBroadcasts > 0 && (
                <div className="flex items-start gap-3 px-[18px] py-3 border-b border-border">
                  <div className="w-[30px] h-[30px] rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 bg-sl-red-dim text-sl-red"><AlertTriangle className="w-[13px] h-[13px]" /></div>
                  <div className="flex-1">
                    <div className="text-[13px] text-muted-foreground leading-relaxed"><strong className="text-foreground font-medium">{o.liveBroadcasts} live broadcast{o.liveBroadcasts > 1 ? "s" : ""}</strong> in progress</div>
                    <div className="font-mono text-[10px] text-muted-foreground mt-1">now</div>
                  </div>
                </div>
              )}
              <div className="flex items-start gap-3 px-[18px] py-3 border-b border-border">
                <div className="w-[30px] h-[30px] rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 bg-accent-soft text-primary"><Activity className="w-[13px] h-[13px]" /></div>
                <div className="flex-1">
                  <div className="text-[13px] text-muted-foreground leading-relaxed"><strong className="text-foreground font-medium">{o.activeMembers}</strong> active members across {departments.length} departments</div>
                  <div className="font-mono text-[10px] text-muted-foreground mt-1">company-wide</div>
                </div>
              </div>
              <div className="flex items-start gap-3 px-[18px] py-3 border-b border-border">
                <div className="w-[30px] h-[30px] rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 bg-accent-soft text-primary"><FileText className="w-[13px] h-[13px]" /></div>
                <div className="flex-1">
                  <div className="text-[13px] text-muted-foreground leading-relaxed"><strong className="text-foreground font-medium">{o.totalTrainingModules} training modules</strong> — {o.avgCompletionRate}% avg completion</div>
                  <div className="font-mono text-[10px] text-muted-foreground mt-1">company average</div>
                </div>
              </div>
              <div className="flex items-start gap-3 px-[18px] py-3 border-b border-border last:border-b-0">
                <div className="w-[30px] h-[30px] rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 bg-sl-green-dim text-sl-green"><CheckCircle className="w-[13px] h-[13px]" /></div>
                <div className="flex-1">
                  <div className="text-[13px] text-muted-foreground leading-relaxed"><strong className="text-foreground font-medium">{o.totalMessages.toLocaleString()}</strong> chat messages · {o.totalCalls} calls logged</div>
                  <div className="font-mono text-[10px] text-muted-foreground mt-1">all time</div>
                </div>
              </div>
            </>
          )}
          {!o && <div className="px-[18px] py-6 text-center text-xs text-muted-foreground">No activity data yet</div>}
        </Panel>
      </div>
    </div>
  );
}
