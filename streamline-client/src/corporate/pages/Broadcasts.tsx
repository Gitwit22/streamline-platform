import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Radio, Users, Loader2, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchBroadcasts, createBroadcast, deleteBroadcast, type Broadcast } from "../api/broadcasts";
import { useCorporateMe } from "../layout/CorporateProtectedRoute";
import { isCorporateBypassEnabled } from "../state/corporateMode";

const tabs = ["Live & Upcoming", "Archive", "On-Demand", "Analytics"] as const;
type Tab = (typeof tabs)[number];

const demoBroadcasts: Broadcast[] = [
  { id: "b1", title: "Q1 All-Hands Town Hall", description: "", team: "Executive Team", scope: "Company-wide", status: "live", required: false, scheduledAt: Date.now() - 18 * 60_000, startedAt: Date.now() - 18 * 60_000, endedAt: null, viewers: 847, createdAt: Date.now(), createdBy: "" },
  { id: "b2", title: "Annual Safety Briefing 2026", description: "", team: "HR & Compliance", scope: "company-wide", status: "scheduled", required: true, scheduledAt: Date.now() + 3600_000, startedAt: null, endedAt: null, viewers: 0, createdAt: Date.now(), createdBy: "" },
  { id: "b3", title: "Engineering Quarterly Review", description: "", team: "Engineering", scope: "department", status: "scheduled", required: false, scheduledAt: Date.now() + 86400_000, startedAt: null, endedAt: null, viewers: 0, createdAt: Date.now(), createdBy: "" },
  { id: "b4", title: "Data Privacy Policy Update", description: "", team: "Legal & Compliance", scope: "company-wide", status: "scheduled", required: true, scheduledAt: Date.now() + 3 * 86400_000, startedAt: null, endedAt: null, viewers: 0, createdAt: Date.now(), createdBy: "" },
  { id: "b5", title: "CEO Monthly Update", description: "", team: "Executive", scope: "company-wide", status: "scheduled", required: false, scheduledAt: Date.now() + 10 * 86400_000, startedAt: null, endedAt: null, viewers: 0, createdAt: Date.now(), createdBy: "" },
];

function formatScheduled(ms: number | null) {
  if (!ms) return "";
  const d = new Date(ms);
  const diff = ms - Date.now();
  if (diff < 0 && diff > -3600_000) return `Started ${Math.abs(Math.floor(diff / 60_000))}m ago`;
  if (diff > 0 && diff < 86400_000) return `Today · ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  if (diff > 86400_000 && diff < 2 * 86400_000) return `Tomorrow · ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function Broadcasts() {
  const bypass = isCorporateBypassEnabled();
  const me = useCorporateMe();
  const isAdmin = me?.orgRole === "admin" || me?.orgRole === "manager";
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<Tab>("Live & Upcoming");
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newTeam, setNewTeam] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (bypass) { setBroadcasts(demoBroadcasts); }
      else { const data = await fetchBroadcasts({ limit: 50 }); setBroadcasts(data); }
    } catch { setBroadcasts([]); }
    finally { setLoading(false); }
  }, [bypass]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      let newId: string;
      if (!bypass) {
        const b = await createBroadcast({ title: newTitle.trim(), team: newTeam.trim(), scope: "company-wide" });
        setBroadcasts(prev => [b, ...prev]);
        newId = b.id;
      } else {
        newId = `demo-${Date.now()}`;
        setBroadcasts(prev => [{ id: newId, title: newTitle.trim(), description: "", team: newTeam.trim(), scope: "company-wide", status: "scheduled" as const, required: false, scheduledAt: Date.now() + 86400_000, startedAt: null, endedAt: null, viewers: 0, createdAt: Date.now(), createdBy: "" }, ...prev]);
      }
      setNewTitle(""); setNewTeam(""); setShowNew(false);
      // Navigate to studio to go live immediately
      navigate(`/streamline/corporate/broadcasts/${newId}/studio`);
    } finally { setCreating(false); }
  };

  const handleDelete = async (id: string) => {
    if (!bypass) await deleteBroadcast(id);
    setBroadcasts(prev => prev.filter(b => b.id !== id));
  };

  const liveCount = broadcasts.filter(b => b.status === "live").length;
  const scheduledCount = broadcasts.filter(b => b.status === "scheduled").length;
  const completedCount = broadcasts.filter(b => b.status === "completed").length;
  const totalViewers = broadcasts.filter(b => b.status === "live").reduce((s, b) => s + b.viewers, 0);

  const filtered = broadcasts.filter(b => {
    if (activeTab === "Live & Upcoming") return b.status === "live" || b.status === "scheduled";
    if (activeTab === "Archive") return b.status === "completed";
    return true;
  });

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="flex items-center gap-0.5 px-7 border-b border-border bg-surface sticky top-0 z-10">
        {tabs.map((tab) => (
          <span key={tab} onClick={() => setActiveTab(tab)} className={cn("px-4 py-3.5 text-[13px] font-medium cursor-pointer border-b-2 -mb-px transition-colors", activeTab === tab ? "text-primary border-primary" : "text-muted-foreground border-transparent hover:text-foreground")}>
            {tab}
          </span>
        ))}
      </div>

      <div className="flex-1 p-6 flex flex-col gap-5">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">Live Broadcasts</h1>
            <p className="text-xs text-muted-foreground mt-1">Town halls, company announcements, and structured one-to-many broadcasting</p>
          </div>
          {isAdmin && (
            <button onClick={() => setShowNew(true)} className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold">
              <Radio className="w-3.5 h-3.5" /> Start Broadcast
            </button>
          )}
        </div>

        {showNew && (
          <div className="bg-surface border border-primary/30 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex gap-3">
              <input autoFocus value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Broadcast title…" className="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary placeholder:text-muted-foreground/50" />
              <input value={newTeam} onChange={e => setNewTeam(e.target.value)} placeholder="Team / department" className="w-[200px] bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary placeholder:text-muted-foreground/50" />
            </div>
            <div className="flex gap-2">
              <button disabled={creating || !newTitle.trim()} onClick={handleCreate} className="px-4 h-9 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold disabled:opacity-50">{creating ? "Creating…" : "Create"}</button>
              <button onClick={() => setShowNew(false)} className="px-3 h-9 rounded-lg bg-surface-2 text-muted-foreground border border-border text-[13px] font-semibold">Cancel</button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "LIVE NOW", value: String(liveCount), sub: `${totalViewers.toLocaleString()} watching`, color: "text-sl-red" },
            { label: "SCHEDULED", value: String(scheduledCount), sub: "upcoming", color: "text-primary" },
            { label: "ARCHIVED", value: String(completedCount), sub: "total recordings", color: "text-sl-green" },
          ].map(s => (
            <div key={s.label} className="bg-surface border border-border rounded-xl p-4">
              <div className="text-[10px] font-semibold text-muted-foreground tracking-[1.2px] uppercase mb-2">{s.label}</div>
              <div className={cn("font-mono text-2xl font-medium", s.color)}>{s.value}</div>
              <div className="text-[11px] text-muted-foreground mt-1">{s.sub}</div>
            </div>
          ))}
        </div>

        {loading && <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>}
        {!loading && filtered.length === 0 && <div className="text-center py-12 text-sm text-muted-foreground">No broadcasts in this view</div>}

        {!loading && filtered.length > 0 && (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="px-[18px] py-3.5 border-b border-border">
              <span className="text-[13px] font-semibold text-foreground">All Broadcasts</span>
            </div>
            {filtered.map((b) => (
              <div key={b.id} className="flex items-start gap-3.5 px-[18px] py-3.5 border-b border-border last:border-b-0 hover:bg-surface-2 cursor-pointer transition-colors">
                <div className="w-[72px] h-[44px] rounded-lg bg-surface-3 flex items-center justify-center border border-border relative">
                  <Radio className="w-5 h-5 text-primary/40" />
                  {b.status === "live" && <span className="absolute top-1 left-1 text-[8px] font-bold tracking-wider bg-sl-red text-foreground px-1.5 py-px rounded">LIVE</span>}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-foreground">{b.title}</span>
                    {b.status === "live" && <span className="text-[10px] font-semibold bg-sl-red-dim text-sl-red border border-sl-red/20 px-2 py-0.5 rounded-full flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-sl-red animate-pulse-live" />LIVE</span>}
                    {b.required && <span className="text-[10px] font-semibold bg-sl-amber-dim text-sl-amber border border-sl-amber/20 px-2 py-0.5 rounded-full">Required</span>}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1 flex gap-2 items-center">
                    <span>{b.team}</span><span>·</span><span>{b.scope}</span><span>·</span><span>{formatScheduled(b.scheduledAt)}</span>
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    {b.status === "live" ? (
                      <button onClick={(e) => { e.stopPropagation(); navigate(`/streamline/corporate/broadcasts/${b.id}/watch`); }} className="inline-flex items-center gap-1 px-3 h-7 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold">▶ Watch Live</button>
                    ) : b.status === "scheduled" && isAdmin ? (
                      <button onClick={(e) => { e.stopPropagation(); navigate(`/streamline/corporate/broadcasts/${b.id}/studio`); }} className="inline-flex items-center gap-1 px-3 h-7 rounded-md bg-sl-red text-white text-[11px] font-semibold"><Play className="w-3 h-3 fill-current" /> Go Live</button>
                    ) : (
                      <button className="inline-flex items-center gap-1 px-3 h-7 rounded-md bg-surface-3 text-muted-foreground border border-border-2 text-[11px] font-semibold hover:text-foreground">+ Calendar</button>
                    )}
                    {b.status === "live" && isAdmin && (
                      <button onClick={(e) => { e.stopPropagation(); navigate(`/streamline/corporate/broadcasts/${b.id}/studio`); }} className="inline-flex items-center gap-1 px-3 h-7 rounded-md bg-surface-2 border border-border text-foreground text-[11px] font-semibold hover:bg-surface-3">Manage</button>
                    )}
                    {b.viewers > 0 && <span className="font-mono text-[11px] text-muted-foreground flex items-center gap-1"><Users className="w-3 h-3" />{b.viewers.toLocaleString()}</span>}
                    {isAdmin && b.status !== "live" && (
                      <button onClick={(e) => { e.stopPropagation(); handleDelete(b.id); }} className="text-[11px] text-sl-red hover:underline ml-auto">Delete</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
