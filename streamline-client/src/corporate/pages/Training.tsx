import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { fetchTraining, createTraining, updateProgress, type TrainingModule } from "../api/training";
import { useCorporateMe } from "../layout/CorporateProtectedRoute";
import { isCorporateBypassEnabled } from "../state/corporateMode";

const tabs = ["Required", "Optional", "Compliance", "Certificates", "Policy Library"] as const;
type Tab = (typeof tabs)[number];

const demoModules: TrainingModule[] = [
  { id: "t1", title: "OSHA Safety Training 2026", department: "HR & Compliance", durationMinutes: 42, progress: 0, status: "required", icon: "🛡️", assignedTo: [], createdAt: Date.now(), createdBy: "" },
  { id: "t2", title: "Data Privacy & GDPR", department: "Legal", durationMinutes: 28, progress: 60, status: "required", icon: "🔒", assignedTo: [], createdAt: Date.now(), createdBy: "" },
  { id: "t3", title: "Remote Work Policy 2026", department: "HR", durationMinutes: 15, progress: 100, status: "completed", icon: "✅", assignedTo: [], createdAt: Date.now(), createdBy: "" },
  { id: "t4", title: "Anti-Harassment Policy", department: "HR & Legal", durationMinutes: 20, progress: 0, status: "overdue", icon: "⚠️", assignedTo: [], createdAt: Date.now(), createdBy: "" },
  { id: "t5", title: "Cybersecurity Basics", department: "IT", durationMinutes: 35, progress: 45, status: "in-progress", icon: "🔐", assignedTo: [], createdAt: Date.now(), createdBy: "" },
  { id: "t6", title: "Fire Safety Protocol", department: "Facilities", durationMinutes: 18, progress: 100, status: "completed", icon: "🔥", assignedTo: [], createdAt: Date.now(), createdBy: "" },
  { id: "t7", title: "Customer Data Handling", department: "Sales", durationMinutes: 25, progress: 0, status: "optional", icon: "📊", assignedTo: [], createdAt: Date.now(), createdBy: "" },
  { id: "t8", title: "Leadership Essentials", department: "Management", durationMinutes: 60, progress: 30, status: "optional", icon: "🎯", assignedTo: [], createdAt: Date.now(), createdBy: "" },
];

function statusColor(s: string): string {
  if (s === "required" || s === "in-progress") return "amber";
  if (s === "completed") return "green";
  if (s === "overdue") return "red";
  return "muted";
}

const statusBadge: Record<string, string> = {
  amber: "bg-sl-amber-dim text-sl-amber border-sl-amber/20",
  green: "bg-sl-green-dim text-sl-green border-sl-green/20",
  red: "bg-sl-red-dim text-sl-red border-sl-red/20",
  muted: "bg-surface-3 text-muted-foreground border-border-2",
};
const pctColor: Record<string, string> = { amber: "text-sl-amber", green: "text-sl-green", red: "text-sl-red", muted: "text-muted-foreground" };
const barColor: Record<string, string> = { amber: "bg-sl-amber", green: "bg-sl-green", red: "bg-sl-red", muted: "bg-muted-foreground" };

function statusLabel(s: string): string {
  if (s === "in-progress") return "In Progress";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function Training() {
  const bypass = isCorporateBypassEnabled();
  const me = useCorporateMe();
  const isAdmin = me?.orgRole === "admin" || me?.orgRole === "manager";

  const [activeTab, setActiveTab] = useState<Tab>("Required");
  const [modules, setModules] = useState<TrainingModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDept, setNewDept] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (bypass) { setModules(demoModules); }
      else { const data = await fetchTraining({ limit: 50 }); setModules(data); }
    } catch { setModules([]); }
    finally { setLoading(false); }
  }, [bypass]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      if (!bypass) {
        const m = await createTraining({ title: newTitle.trim(), department: newDept.trim(), durationMinutes: 30 });
        setModules(prev => [m, ...prev]);
      } else {
        setModules(prev => [{ id: `demo-${Date.now()}`, title: newTitle.trim(), department: newDept.trim(), durationMinutes: 30, progress: 0, status: "required", icon: "📝", assignedTo: [], createdAt: Date.now(), createdBy: "" }, ...prev]);
      }
      setNewTitle(""); setNewDept(""); setShowNew(false);
    } finally { setCreating(false); }
  };

  const handleProgress = async (mod: TrainingModule, pct: number) => {
    if (!bypass) {
      await updateProgress(mod.id, pct);
    }
    setModules(prev => prev.map(m => m.id === mod.id ? { ...m, progress: pct, status: pct >= 100 ? "completed" : pct > 0 ? "in-progress" : m.status } : m));
  };

  const filtered = modules.filter(m => {
    if (activeTab === "Required") return m.status === "required" || m.status === "overdue" || m.status === "in-progress";
    if (activeTab === "Optional") return m.status === "optional";
    if (activeTab === "Compliance") return m.status === "required" || m.status === "overdue";
    if (activeTab === "Certificates") return m.progress >= 100;
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
            <h1 className="text-xl font-bold text-foreground tracking-tight">Training</h1>
            <p className="text-xs text-muted-foreground mt-1">Internal learning hub — video modules, compliance courses, and certifications</p>
          </div>
          {isAdmin && (
            <button onClick={() => setShowNew(true)} className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold">
              + Assign Training
            </button>
          )}
        </div>

        {showNew && (
          <div className="bg-surface border border-primary/30 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex gap-3">
              <input autoFocus value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Module title…" className="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary placeholder:text-muted-foreground/50" />
              <input value={newDept} onChange={e => setNewDept(e.target.value)} placeholder="Department" className="w-[180px] bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary placeholder:text-muted-foreground/50" />
            </div>
            <div className="flex gap-2">
              <button disabled={creating || !newTitle.trim()} onClick={handleCreate} className="px-4 h-9 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold disabled:opacity-50">{creating ? "Creating…" : "Create"}</button>
              <button onClick={() => setShowNew(false)} className="px-3 h-9 rounded-lg bg-surface-2 text-muted-foreground border border-border text-[13px] font-semibold">Cancel</button>
            </div>
          </div>
        )}

        {loading && <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>}
        {!loading && filtered.length === 0 && <div className="text-center py-12 text-sm text-muted-foreground">No training modules in this view</div>}

        {!loading && filtered.length > 0 && (
          <div className="grid grid-cols-4 gap-3">
            {filtered.map((t) => {
              const sc = statusColor(t.status);
              return (
                <div key={t.id} className="bg-surface border border-border rounded-xl p-4 hover:border-border-2 cursor-pointer transition-colors group">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-lg">{t.icon}</span>
                    <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", statusBadge[sc])}>{statusLabel(t.status)}</span>
                  </div>
                  <div className="text-[13px] font-medium text-foreground mb-1 group-hover:text-primary transition-colors">{t.title}</div>
                  <div className="text-[11px] text-muted-foreground">{t.department} · {t.durationMinutes} min</div>
                  <div className="mt-3">
                    <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                      <span>{t.progress === 0 ? "Not started" : t.progress >= 100 ? "Complete" : `${t.progress}% done`}</span>
                      <span className={pctColor[sc]}>{t.progress}%</span>
                    </div>
                    <div className="h-[3px] bg-border rounded-full overflow-hidden">
                      <div className={cn("h-full rounded-full transition-all", barColor[sc])} style={{ width: `${t.progress}%` }} />
                    </div>
                  </div>
                  {t.progress < 100 && (
                    <div className="mt-2 flex gap-1">
                      {t.progress === 0 ? (
                        <button onClick={() => handleProgress(t, 10)} className="text-[10px] text-primary hover:underline">Start</button>
                      ) : (
                        <button onClick={() => handleProgress(t, 100)} className="text-[10px] text-sl-green hover:underline">Mark Complete</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
