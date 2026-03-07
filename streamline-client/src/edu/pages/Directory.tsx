import { useEffect, useMemo, useState } from "react";
import { Phone, Search, Users } from "lucide-react";
import { useEduMe } from "../layout/EduProtectedRoute";
import { apiFetchAuth } from "@/lib/api";
import { getEduCallTokenDM } from "../api/callToken";
import EduCallModal from "../components/CallModal";

/* ── Types ────────────────────────────────────────────────────── */

type DirectoryEntry = {
  id: string;
  name: string;
  role: string;
  department: string | null;
  avatar: string | null;
};

type EduOrgRole = "faculty_admin" | "faculty_teacher" | "student_producer" | "student_producer_assigned" | "talent";

/* ── Helpers ──────────────────────────────────────────────────── */

function roleLabel(role: string): string {
  if (role === "faculty_admin") return "Admin";
  if (role === "faculty_teacher") return "Teacher";
  if (role === "student_producer" || role === "student_producer_assigned") return "Producer";
  if (role === "talent") return "Talent";
  return "Viewer";
}

function roleBadgeClass(role: string): string {
  if (role === "faculty_admin") return "border-orange-500/30 bg-orange-500/15 text-orange-300";
  if (role === "faculty_teacher") return "border-blue-500/30 bg-blue-500/15 text-blue-300";
  if (role === "student_producer" || role === "student_producer_assigned") return "border-blue-500/30 bg-blue-500/15 text-blue-300";
  if (role === "talent") return "border-purple-500/30 bg-purple-500/15 text-purple-300";
  return "border-slate-700/30 bg-slate-800/40 text-slate-300";
}

function initials(name: string): string {
  return (name || "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

const CALL_CAPABLE_ROLES: EduOrgRole[] = [
  "faculty_admin",
  "faculty_teacher",
  "student_producer",
  "student_producer_assigned",
];


/* ── Component ────────────────────────────────────────────────── */

export default function Directory() {
  const me = useEduMe();
  const myRole = String(me?.orgRole || me?.role || "faculty_admin") as EduOrgRole;
  const myUid = me?.uid || "";
  const myOrgId = String(me?.orgId || "");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [callTarget, setCallTarget] = useState<DirectoryEntry | null>(null);

  // Fetch directory
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const res = await apiFetchAuth("/api/edu/directory?limit=200");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (mounted) setEntries(data.entries || []);
      } catch (e: any) {
        if (mounted) setError(e?.message || "Failed to load directory");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, []);

  // Filtered + searchable
  const filtered = useMemo(() => {
    let items = entries;
    if (roleFilter !== "all") {
      items = items.filter((e) => {
        if (roleFilter === "producer") return e.role === "student_producer" || e.role === "student_producer_assigned";
        return e.role === roleFilter;
      });
    }
    const q = query.trim().toLowerCase();
    if (q) {
      items = items.filter((e) => {
        const name = (e.name || "").toLowerCase();
        const dept = (e.department || "").toLowerCase();
        return name.includes(q) || dept.includes(q);
      });
    }
    // Sort: admin first, then teachers, then producers, then talent
    const order: Record<string, number> = { faculty_admin: 0, faculty_teacher: 0, student_producer: 1, student_producer_assigned: 1, talent: 2 };
    items.sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9));
    return items;
  }, [entries, query, roleFilter]);

  /** Extract uid from member doc id */
  function extractUid(entryId: string): string {
    if (myOrgId && entryId.startsWith(myOrgId + "_")) {
      return entryId.slice(myOrgId.length + 1);
    }
    const idx = entryId.indexOf("_");
    return idx >= 0 ? entryId.slice(idx + 1) : entryId;
  }

  /** Can this user place a call to the target? */
  function canCall(e: DirectoryEntry): boolean {
    if (extractUid(e.id) === myUid) return false;
    if (!CALL_CAPABLE_ROLES.includes(myRole)) return false;
    // Faculty/teachers can call anyone; producers can call faculty + teachers + other producers
    if (myRole === "faculty_admin" || myRole === "faculty_teacher") return true;
    return e.role === "faculty_admin" || e.role === "faculty_teacher" || e.role === "student_producer" || e.role === "student_producer_assigned";
  }

  const roleOptions = [
    { value: "all", label: "All" },
    { value: "faculty_admin", label: "Admin" },
    { value: "faculty_teacher", label: "Teacher" },
    { value: "producer", label: "Producers" },
    { value: "talent", label: "Talent" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="text-2xl font-bold text-white">School Directory</div>
        <div className="mt-1 text-sm text-slate-400">Browse faculty, producers, and students in your school.</div>
      </div>

      {/* Search + filter bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or department…"
            className="w-full rounded-xl border border-slate-700/60 bg-slate-950/40 pl-10 pr-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-orange-500/40"
          />
        </div>
        <div className="flex items-center gap-2">
          {roleOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setRoleFilter(opt.value)}
              className={`rounded-xl border border-transparent px-3 py-2 text-xs font-semibold transition-colors ${
                roleFilter === opt.value
                  ? "border-slate-700 bg-slate-900/70 text-white"
                  : "text-slate-400 hover:border-slate-700/60 hover:bg-slate-900/40 hover:text-slate-200"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Users className="h-3.5 w-3.5" />
        {filtered.length} {filtered.length === 1 ? "member" : "members"}
      </div>

      {/* Content */}
      {loading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
      ) : error ? (
        <div className="py-16 text-center text-sm text-red-400">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-sm text-slate-400">No members found.</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((e) => (
            <div
              key={e.id}
              className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-5 flex items-start gap-4"
            >
              {/* Avatar */}
              {e.avatar ? (
                <img
                  src={e.avatar}
                  alt={e.name}
                  className="h-12 w-12 rounded-full object-cover border border-slate-700"
                />
              ) : (
                <div className="h-12 w-12 rounded-full flex items-center justify-center bg-gradient-to-br from-slate-700 to-slate-600 text-white text-sm font-bold border border-slate-600">
                  {initials(e.name)}
                </div>
              )}

              <div className="flex-1 min-w-0">
                <div className="font-semibold text-white truncate">{e.name || "—"}</div>
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs mt-1 ${roleBadgeClass(e.role)}`}>
                  {roleLabel(e.role)}
                </span>
                {e.department && (
                  <div className="mt-1 text-xs text-slate-400 truncate">{e.department}</div>
                )}
              </div>

              {/* Call button */}
              {canCall(e) && (
                <button
                  type="button"
                  onClick={() => setCallTarget(e)}
                  title={`Call ${e.name}`}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-700 hover:text-green-400 transition-colors flex-shrink-0"
                >
                  <Phone className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Call modal */}
      {callTarget && (
        <EduCallModal
          label={callTarget.name || "Call"}
          getToken={() => getEduCallTokenDM(extractUid(callTarget.id))}
          onClose={() => setCallTarget(null)}
        />
      )}
    </div>
  );
}
