import { useEffect, useState, useCallback } from "react";
import { FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchDocuments, createDocument, deleteDocument, acknowledgeDocument, type Document } from "../api/documents";
import { useCorporateMe } from "../layout/CorporateProtectedRoute";
import { isCorporateBypassEnabled } from "../state/corporateMode";

const categories = ["All", "HR Policies", "Legal", "SOPs", "IT Guides", "Safety"] as const;
type Category = (typeof categories)[number];

const demoDocs: Document[] = [
  { id: "d1", title: "Employee Handbook 2026", category: "HR Policies", version: "v3.2", requiresAck: true, ackCount: 972, totalEmployees: 1247, url: "", createdAt: Date.now() - 3 * 86400_000, createdBy: "" },
  { id: "d2", title: "Data Processing Agreement", category: "Legal", version: "v2.1", requiresAck: true, ackCount: 1147, totalEmployees: 1247, url: "", createdAt: Date.now() - 8 * 86400_000, createdBy: "" },
  { id: "d3", title: "Remote Work Policy", category: "HR Policies", version: "v1.4", requiresAck: true, ackCount: 1185, totalEmployees: 1247, url: "", createdAt: Date.now() - 10 * 86400_000, createdBy: "" },
  { id: "d4", title: "Incident Response Plan", category: "IT Guides", version: "v4.0", requiresAck: false, ackCount: 0, totalEmployees: 0, url: "", createdAt: Date.now() - 13 * 86400_000, createdBy: "" },
  { id: "d5", title: "Fire Safety SOP", category: "Safety", version: "v2.0", requiresAck: true, ackCount: 1247, totalEmployees: 1247, url: "", createdAt: Date.now() - 29 * 86400_000, createdBy: "" },
  { id: "d6", title: "Vendor Onboarding Guide", category: "SOPs", version: "v1.1", requiresAck: false, ackCount: 0, totalEmployees: 0, url: "", createdAt: Date.now() - 37 * 86400_000, createdBy: "" },
];

function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export default function Documents() {
  const bypass = isCorporateBypassEnabled();
  const me = useCorporateMe();
  const isAdmin = me?.orgRole === "admin" || me?.orgRole === "manager";

  const [activeCat, setActiveCat] = useState<Category>("All");
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCat, setNewCat] = useState("HR Policies");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (bypass) { setDocs(demoDocs); }
      else { const data = await fetchDocuments({ limit: 50 }); setDocs(data); }
    } catch { setDocs([]); }
    finally { setLoading(false); }
  }, [bypass]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      if (!bypass) {
        const d = await createDocument({ title: newTitle.trim(), category: newCat });
        setDocs(prev => [d, ...prev]);
      } else {
        setDocs(prev => [{ id: `demo-${Date.now()}`, title: newTitle.trim(), category: newCat, version: "v1.0", requiresAck: false, ackCount: 0, totalEmployees: 0, url: "", createdAt: Date.now(), createdBy: "" }, ...prev]);
      }
      setNewTitle(""); setShowNew(false);
    } finally { setCreating(false); }
  };

  const handleAck = async (doc: Document) => {
    if (!bypass) await acknowledgeDocument(doc.id);
    setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, ackCount: d.ackCount + 1 } : d));
  };

  const handleDelete = async (id: string) => {
    if (!bypass) await deleteDocument(id);
    setDocs(prev => prev.filter(d => d.id !== id));
  };

  const filtered = activeCat === "All" ? docs : docs.filter(d => d.category === activeCat);

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="flex items-center gap-0.5 px-7 border-b border-border bg-surface sticky top-0 z-10">
        {categories.map((tab) => (
          <span key={tab} onClick={() => setActiveCat(tab)} className={cn("px-4 py-3.5 text-[13px] font-medium cursor-pointer border-b-2 -mb-px transition-colors", activeCat === tab ? "text-primary border-primary" : "text-muted-foreground border-transparent hover:text-foreground")}>
            {tab}
          </span>
        ))}
      </div>

      <div className="flex-1 p-6 flex flex-col gap-5">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">Documents</h1>
            <p className="text-xs text-muted-foreground mt-1">Centralized internal repository with version control and acknowledgment tracking</p>
          </div>
          {isAdmin && (
            <button onClick={() => setShowNew(true)} className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold">
              + Upload Document
            </button>
          )}
        </div>

        {showNew && (
          <div className="bg-surface border border-primary/30 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex gap-3">
              <input autoFocus value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Document title…" className="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary placeholder:text-muted-foreground/50" />
              <select value={newCat} onChange={e => setNewCat(e.target.value)} className="bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none">
                {categories.filter(c => c !== "All").map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <button disabled={creating || !newTitle.trim()} onClick={handleCreate} className="px-4 h-9 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold disabled:opacity-50">{creating ? "Uploading…" : "Upload"}</button>
              <button onClick={() => setShowNew(false)} className="px-3 h-9 rounded-lg bg-surface-2 text-muted-foreground border border-border text-[13px] font-semibold">Cancel</button>
            </div>
          </div>
        )}

        {loading && <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>}
        {!loading && filtered.length === 0 && <div className="text-center py-12 text-sm text-muted-foreground">No documents in this category</div>}

        {!loading && filtered.length > 0 && (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="grid grid-cols-[1fr_140px_100px_100px_120px] gap-4 px-[18px] py-3 border-b border-border text-[10px] font-semibold text-muted-foreground tracking-[1px] uppercase">
              <span>Document</span>
              <span>Category</span>
              <span>Version</span>
              <span>Updated</span>
              <span>Acknowledgment</span>
            </div>
            {filtered.map((doc) => {
              const ackPct = doc.totalEmployees > 0 ? Math.round((doc.ackCount / doc.totalEmployees) * 100) : 0;
              return (
                <div key={doc.id} className="grid grid-cols-[1fr_140px_100px_100px_120px] gap-4 items-center px-[18px] py-3.5 border-b border-border last:border-b-0 hover:bg-surface-2 cursor-pointer transition-colors group">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-accent-soft flex items-center justify-center flex-shrink-0">
                      <FileText className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1">
                      <div className="text-[13px] font-medium text-foreground">{doc.title}</div>
                      {doc.requiresAck && ackPct < 100 && (
                        <button onClick={() => handleAck(doc)} className="text-[10px] text-primary hover:underline mt-0.5">Acknowledge</button>
                      )}
                    </div>
                    {isAdmin && (
                      <button onClick={() => handleDelete(doc.id)} className="text-[10px] text-sl-red opacity-0 group-hover:opacity-100 hover:underline transition-opacity">Delete</button>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">{doc.category}</span>
                  <span className="font-mono text-xs text-muted-foreground">{doc.version}</span>
                  <span className="text-[11px] text-muted-foreground">{formatDate(doc.createdAt)}</span>
                  {doc.requiresAck ? (
                    <div>
                      <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                        <span className={cn(ackPct === 100 ? "text-sl-green" : ackPct >= 90 ? "text-primary" : "text-sl-amber")}>{ackPct}%</span>
                      </div>
                      <div className="h-[3px] bg-border rounded-full overflow-hidden">
                        <div className={cn("h-full rounded-full", ackPct === 100 ? "bg-sl-green" : ackPct >= 90 ? "bg-primary" : "bg-sl-amber")} style={{ width: `${ackPct}%` }} />
                      </div>
                    </div>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">—</span>
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
