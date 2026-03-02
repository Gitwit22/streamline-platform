import { useEffect, useState, useCallback } from "react";
import { Phone, Video, MonitorUp, Mic, Camera, Circle, Hand, PhoneOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchCalls, createCall, updateCall, type Call } from "../api/calls";
import { isCorporateBypassEnabled } from "../state/corporateMode";

const tabs = ["Active Calls", "Scheduled", "Recordings", "Transcripts"] as const;
type Tab = (typeof tabs)[number];

const demoCalls: Call[] = [
  { id: "c1", title: "Engineering Standup", status: "active", scheduledAt: Date.now() - 720_000, startedAt: Date.now() - 720_000, endedAt: null, duration: null, participants: ["JD", "SK", "MR", "AL"], department: "Engineering", hasRecording: true, hasTranscript: false, recordingUrl: "", createdAt: Date.now(), createdBy: "" },
  { id: "c2", title: "Product Sync", status: "scheduled", scheduledAt: Date.now() + 3_600_000, startedAt: null, endedAt: null, duration: null, participants: ["JD", "LK", "TP", "MN", "SR", "BW"], department: "Product", hasRecording: false, hasTranscript: false, recordingUrl: "", createdAt: Date.now(), createdBy: "" },
  { id: "c3", title: "Client Review", status: "scheduled", scheduledAt: Date.now() + 7_200_000, startedAt: null, endedAt: null, duration: null, participants: ["JD", "SK", "MR", "AL"], department: "Sales", hasRecording: false, hasTranscript: false, recordingUrl: "", createdAt: Date.now(), createdBy: "" },
  { id: "c4", title: "Security Briefing", status: "scheduled", scheduledAt: Date.now() + 10_800_000, startedAt: null, endedAt: null, duration: null, participants: Array.from({ length: 12 }, (_, i) => `U${i}`), department: "IT", hasRecording: false, hasTranscript: false, recordingUrl: "", createdAt: Date.now(), createdBy: "" },
  { id: "c5", title: "All-Hands Q4 Wrap-up", status: "completed", scheduledAt: Date.now() - 86400_000, startedAt: Date.now() - 86400_000, endedAt: Date.now() - 86400_000 + 2700_000, duration: 2700_000, participants: [], department: "Company", hasRecording: true, hasTranscript: true, recordingUrl: "", createdAt: Date.now() - 86400_000, createdBy: "" },
];

function formatTime(ms: number | null) {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function Calls() {
  const bypass = isCorporateBypassEnabled();
  const [activeTab, setActiveTab] = useState<Tab>("Active Calls");
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (bypass) { setCalls(demoCalls); }
      else { const data = await fetchCalls({ limit: 50 }); setCalls(data); }
    } catch { setCalls([]); }
    finally { setLoading(false); }
  }, [bypass]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      if (!bypass) {
        const c = await createCall({ title: newTitle.trim() });
        setCalls(prev => [c, ...prev]);
      } else {
        setCalls(prev => [{ id: `demo-${Date.now()}`, title: newTitle.trim(), status: "scheduled", scheduledAt: Date.now() + 3600_000, startedAt: null, endedAt: null, duration: null, participants: [], department: "", hasRecording: false, hasTranscript: false, recordingUrl: "", createdAt: Date.now(), createdBy: "" }, ...prev]);
      }
      setNewTitle(""); setShowNew(false);
    } finally { setCreating(false); }
  };

  const handleEndCall = async (c: Call) => {
    if (!bypass) {
      const updated = await updateCall(c.id, { status: "completed" });
      setCalls(prev => prev.map(x => x.id === c.id ? updated : x));
    } else {
      setCalls(prev => prev.map(x => x.id === c.id ? { ...x, status: "completed" as const, endedAt: Date.now() } : x));
    }
  };

  const filtered = calls.filter(c => {
    if (activeTab === "Active Calls") return c.status === "active";
    if (activeTab === "Scheduled") return c.status === "scheduled";
    if (activeTab === "Recordings") return c.hasRecording;
    if (activeTab === "Transcripts") return c.hasTranscript;
    return true;
  });

  const activeCall = calls.find(c => c.status === "active");

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="flex items-center gap-0.5 px-7 border-b border-border bg-surface sticky top-0 z-10">
        {tabs.map((tab) => (
          <span
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn("px-4 py-3.5 text-[13px] font-medium cursor-pointer border-b-2 -mb-px transition-colors",
              activeTab === tab ? "text-primary border-primary" : "text-muted-foreground border-transparent hover:text-foreground"
            )}
          >
            {tab}
          </span>
        ))}
      </div>

      <div className="flex-1 p-6 flex flex-col gap-5">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">Calls</h1>
            <p className="text-xs text-muted-foreground mt-1">Voice & video meetings with screen sharing, recording, and transcription</p>
          </div>
          <button onClick={() => setShowNew(true)} className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold">
            <Phone className="w-3.5 h-3.5" /> New Call
          </button>
        </div>

        {showNew && (
          <div className="bg-surface border border-primary/30 rounded-xl p-4 flex items-center gap-3">
            <input autoFocus value={newTitle} onChange={e => setNewTitle(e.target.value)} onKeyDown={e => e.key === "Enter" && handleCreate()} placeholder="Call title…" className="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary placeholder:text-muted-foreground/50" />
            <button disabled={creating || !newTitle.trim()} onClick={handleCreate} className="px-4 h-9 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold disabled:opacity-50">{creating ? "Creating…" : "Create"}</button>
            <button onClick={() => setShowNew(false)} className="px-3 h-9 rounded-lg bg-surface-2 text-muted-foreground border border-border text-[13px] font-semibold">Cancel</button>
          </div>
        )}

        {activeCall && activeTab === "Active Calls" && (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="aspect-video bg-background flex items-center justify-center relative max-h-[300px]">
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-sl-navy to-primary mx-auto flex items-center justify-center text-2xl font-bold text-primary-foreground mb-3">{activeCall.title.charAt(0)}</div>
                <p className="text-foreground font-semibold">{activeCall.title}</p>
                <p className="text-muted-foreground text-sm mt-1">{activeCall.participants.length} participants · {activeCall.startedAt ? formatTime(activeCall.startedAt) : ""}</p>
              </div>
              <div className="absolute top-4 right-4 flex flex-col gap-2">
                {activeCall.participants.slice(0, 3).map((p, i) => (
                  <div key={i} className="w-12 h-12 rounded-lg bg-surface-3 border border-border flex items-center justify-center text-xs font-bold text-muted-foreground">{typeof p === "string" ? p.slice(0, 2).toUpperCase() : "?"}</div>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-center gap-3 py-4 bg-surface border-t border-border">
              {[
                { icon: Mic, label: "Mic" },
                { icon: Camera, label: "Camera" },
                { icon: MonitorUp, label: "Share" },
                { icon: Circle, label: "Record" },
                { icon: Hand, label: "Raise Hand" },
              ].map(c => (
                <button key={c.label} className="w-10 h-10 rounded-lg bg-surface-2 border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-border-2 transition-colors" title={c.label}>
                  <c.icon className="w-4 h-4" />
                </button>
              ))}
              <button onClick={() => handleEndCall(activeCall)} className="w-10 h-10 rounded-lg bg-sl-red text-foreground flex items-center justify-center hover:bg-sl-red/80 transition-colors" title="End Call">
                <PhoneOff className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {loading && <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>}
        {!loading && filtered.length === 0 && <div className="text-center py-12 text-sm text-muted-foreground">No {activeTab.toLowerCase()} found</div>}

        {!loading && filtered.length > 0 && (activeTab !== "Active Calls" || !activeCall) && (
          <div className="bg-surface border border-border rounded-xl">
            <div className="px-[18px] py-3.5 border-b border-border flex items-center justify-between">
              <span className="text-[13px] font-semibold text-foreground">{activeTab}</span>
              <span className="text-xs text-muted-foreground font-mono">{filtered.length} items</span>
            </div>
            {filtered.map((c) => (
              <div key={c.id} className="flex items-center gap-3.5 px-[18px] py-3 border-b border-border last:border-b-0 hover:bg-surface-2 cursor-pointer transition-colors">
                <div className="w-10 h-10 rounded-lg bg-accent-soft border border-primary/20 flex items-center justify-center">
                  <Video className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="text-[13px] font-medium text-foreground">{c.title}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{c.department}{c.department ? " · " : ""}{c.participants.length} participant{c.participants.length !== 1 ? "s" : ""}{c.duration ? ` · ${Math.round(c.duration / 60_000)}m` : ""}</div>
                </div>
                <span className="text-xs text-muted-foreground font-mono">{formatTime(c.scheduledAt)}</span>
                {c.status === "scheduled" && (
                  <button onClick={() => !bypass && updateCall(c.id, { status: "active" }).then(u => setCalls(prev => prev.map(x => x.id === c.id ? u : x)))} className="px-3 h-7 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold">Join</button>
                )}
                {c.hasRecording && <span className="text-[10px] bg-accent-soft text-primary border border-primary/20 px-2 py-0.5 rounded-full">Recording</span>}
                {c.hasTranscript && <span className="text-[10px] bg-sl-green-dim text-sl-green border border-sl-green/20 px-2 py-0.5 rounded-full">Transcript</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
