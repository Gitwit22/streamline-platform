import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts";
import { Loader2 } from "lucide-react";
import { fetchAnalytics, type AnalyticsOverview } from "../api/admin";
import { isCorporateBypassEnabled } from "../state/corporateMode";

const tabs = ["Overview", "Meetings", "Broadcasts", "Training", "Engagement"] as const;
type Tab = (typeof tabs)[number];

const demoAnalytics: AnalyticsOverview = {
  totalUsers: 1247,
  totalBroadcasts: 156,
  totalCalls: 527,
  totalTraining: 8,
  complianceRate: 87,
  departments: [
    { name: "Engineering", meetings: 142, compliance: 98, chatActivity: 2450 },
    { name: "Human Resources", meetings: 89, compliance: 96, chatActivity: 1820 },
    { name: "Sales & Marketing", meetings: 167, compliance: 88, chatActivity: 3100 },
    { name: "Operations", meetings: 73, compliance: 74, chatActivity: 980 },
    { name: "Customer Support", meetings: 56, compliance: 61, chatActivity: 1540 },
  ],
};

const demoMeetingData = [
  { name: "Mon", calls: 24, broadcasts: 2 },
  { name: "Tue", calls: 31, broadcasts: 1 },
  { name: "Wed", calls: 28, broadcasts: 3 },
  { name: "Thu", calls: 35, broadcasts: 2 },
  { name: "Fri", calls: 22, broadcasts: 1 },
];

const demoEngagementData = [
  { name: "Week 1", score: 72 },
  { name: "Week 2", score: 78 },
  { name: "Week 3", score: 81 },
  { name: "Week 4", score: 87 },
];

export default function Analytics() {
  const bypass = isCorporateBypassEnabled();
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (bypass) { setAnalytics(demoAnalytics); }
      else { const data = await fetchAnalytics(); setAnalytics(data); }
    } catch { setAnalytics(null); }
    finally { setLoading(false); }
  }, [bypass]);

  useEffect(() => { load(); }, [load]);

  const a = analytics;
  const meetingData = demoMeetingData;
  const engagementData = demoEngagementData;

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
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">Analytics</h1>
            <p className="text-xs text-muted-foreground mt-1">Executive dashboard — meeting frequency, compliance, engagement metrics</p>
          </div>
          <button onClick={load} className="px-3 h-8 rounded-lg bg-surface-2 border border-border text-[12px] font-medium text-muted-foreground hover:text-foreground">Refresh</button>
        </div>

        {loading && <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>}

        {!loading && a && (
          <>
            {/* Top Stats */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "TOTAL MEETINGS", value: a.totalCalls.toLocaleString(), sub: "this month", color: "text-primary" },
                { label: "AVG. ATTENDANCE", value: "94%", sub: "broadcast avg", color: "text-sl-green" },
                { label: "TRAINING COMPLIANCE", value: `${a.complianceRate}%`, sub: "company-wide", color: a.complianceRate >= 90 ? "text-sl-green" : a.complianceRate >= 75 ? "text-sl-amber" : "text-sl-red" },
                { label: "CHAT MESSAGES", value: "12.4K", sub: "this week", color: "text-primary" },
              ].map(s => (
                <div key={s.label} className="bg-surface border border-border rounded-xl p-4">
                  <div className="text-[10px] font-semibold text-muted-foreground tracking-[1.2px] uppercase mb-2">{s.label}</div>
                  <div className={cn("font-mono text-[28px] font-medium leading-none", s.color)}>{s.value}</div>
                  <div className="text-[11px] text-muted-foreground mt-1.5">{s.sub}</div>
                </div>
              ))}
            </div>

            {/* Charts */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-surface border border-border rounded-xl p-5">
                <h3 className="text-[13px] font-semibold text-foreground mb-4">Meeting Activity</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={meetingData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 35% 20%)" />
                    <XAxis dataKey="name" tick={{ fill: "hsl(214 25% 55%)", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "hsl(214 25% 55%)", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: "hsl(218 35% 11%)", border: "1px solid hsl(215 35% 20%)", borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="calls" fill="hsl(197 89% 66%)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="broadcasts" fill="hsl(155 75% 58%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-surface border border-border rounded-xl p-5">
                <h3 className="text-[13px] font-semibold text-foreground mb-4">Engagement Score</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={engagementData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 35% 20%)" />
                    <XAxis dataKey="name" tick={{ fill: "hsl(214 25% 55%)", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "hsl(214 25% 55%)", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: "hsl(218 35% 11%)", border: "1px solid hsl(215 35% 20%)", borderRadius: 8, fontSize: 12 }} />
                    <Area type="monotone" dataKey="score" stroke="hsl(197 89% 66%)" fill="hsl(197 89% 66% / 0.15)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Department Table */}
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
              <div className="px-[18px] py-3.5 border-b border-border">
                <span className="text-[13px] font-semibold text-foreground">Department Metrics</span>
              </div>
              <div className="grid grid-cols-[1fr_100px_100px_100px] gap-4 px-[18px] py-2.5 border-b border-border text-[10px] font-semibold text-muted-foreground tracking-[1px] uppercase">
                <span>Department</span>
                <span>Meetings</span>
                <span>Compliance</span>
                <span>Chat Activity</span>
              </div>
              {(a.departments || []).map((d, i) => (
                <div key={i} className="grid grid-cols-[1fr_100px_100px_100px] gap-4 items-center px-[18px] py-3 border-b border-border last:border-b-0 hover:bg-surface-2 transition-colors">
                  <span className="text-[13px] font-medium text-foreground">{d.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{d.meetings}</span>
                  <span className={cn("font-mono text-xs", d.compliance >= 90 ? "text-sl-green" : d.compliance >= 75 ? "text-sl-amber" : "text-sl-red")}>{d.compliance}%</span>
                  <span className="font-mono text-xs text-muted-foreground">{(d.chatActivity || 0).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
