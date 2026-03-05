import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  Users,
  Loader2,
  MapPin,
  Briefcase,
  Building2,
  ChevronDown,
  Phone,
} from "lucide-react";
import { useCorporateMe } from "../layout/CorporateProtectedRoute";
import { fetchDirectory, type DirectoryMember } from "../api/directory";
import { getCallTokenDM } from "../api/callToken";
import ProfileDrawer from "../components/ProfileDrawer";
import CallModal from "../components/CallModal";

export default function Directory() {
  const me = useCorporateMe();

  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<DirectoryMember[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [error, setError] = useState("");

  const [query, setQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [drawerMember, setDrawerMember] = useState<DirectoryMember | null>(null);
  const [callTarget, setCallTarget] = useState<DirectoryMember | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchDirectory();
      setMembers(res.members);
      setDepartments(res.departments);
    } catch (e: any) {
      setError(e.message || "Failed to load directory");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let list = members;
    if (deptFilter) list = list.filter((m) => m.department === deptFilter);
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(
        (m) =>
          (m.displayName || "").toLowerCase().includes(q) ||
          (m.email || "").toLowerCase().includes(q) ||
          (m.jobTitle || "").toLowerCase().includes(q) ||
          (m.department || "").toLowerCase().includes(q) ||
          (m.location || "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [members, query, deptFilter]);

  const handleProfileUpdated = (updated: Partial<DirectoryMember> & { uid: string }) => {
    setMembers((prev) =>
      prev.map((m) => (m.uid === updated.uid ? { ...m, ...updated } : m)),
    );
    setDrawerMember((prev) => (prev && prev.uid === updated.uid ? { ...prev, ...updated } : prev));
  };

  const initials = (name: string) =>
    (name || "?")
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?";

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="flex-1 p-6 flex flex-col gap-5 overflow-y-auto">
        {/* Header */}
        <div>
          <h1
            className="text-xl font-bold tracking-tight flex items-center gap-2"
            style={{ color: "#fff" }}
          >
            <Users className="w-5 h-5" style={{ color: "hsl(197 89% 66%)" }} />
            Staff Directory
          </h1>
          <p className="text-xs mt-1" style={{ color: "hsl(214 25% 50%)" }}>
            Browse and connect with everyone in your organization
          </p>
        </div>

        {/* Search + filter bar */}
        <div className="flex flex-wrap gap-3">
          {/* Search */}
          <div
            className="flex items-center gap-2 px-3 rounded-lg flex-1 min-w-[200px]"
            style={{
              background: "hsl(218 35% 10%)",
              border: "1px solid hsl(215 35% 20%)",
            }}
          >
            <Search className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(214 25% 45%)" }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, email, title, location…"
              className="flex-1 bg-transparent py-2.5 text-sm outline-none"
              style={{ color: "#fff" }}
            />
          </div>

          {/* Department filter */}
          <div className="relative">
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="appearance-none pr-8 pl-3 py-2.5 rounded-lg text-sm outline-none cursor-pointer"
              style={{
                background: "hsl(218 35% 10%)",
                border: "1px solid hsl(215 35% 20%)",
                color: deptFilter ? "#fff" : "hsl(214 25% 50%)",
              }}
            >
              <option value="">All Departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <ChevronDown
              className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
              style={{ color: "hsl(214 25% 50%)" }}
            />
          </div>
        </div>

        {/* Error */}
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
            <button className="ml-3 underline text-xs" onClick={() => setError("")}>dismiss</button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: "hsl(197 89% 66%)" }} />
          </div>
        )}

        {/* Empty */}
        {!loading && filtered.length === 0 && (
          <div className="text-center py-16 text-sm" style={{ color: "hsl(214 25% 50%)" }}>
            {query || deptFilter ? "No members match your filters" : "No members found"}
          </div>
        )}

        {/* Cards grid */}
        {!loading && filtered.length > 0 && (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((m) => (
              <button
                key={m.uid}
                onClick={() => setDrawerMember(m)}
                className="flex flex-col items-center gap-3 rounded-xl p-5 text-center transition-colors"
                style={{
                  background: "hsl(218 35% 13%)",
                  border: "1px solid hsl(215 35% 20%)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "hsl(197 89% 66% / 0.4)";
                  e.currentTarget.style.background = "hsl(218 35% 15%)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "hsl(215 35% 20%)";
                  e.currentTarget.style.background = "hsl(218 35% 13%)";
                }}
              >
                {/* Avatar */}
                {m.photoURL ? (
                  <img
                    src={m.photoURL}
                    alt={m.displayName}
                    className="w-16 h-16 rounded-full object-cover"
                    style={{ border: "2px solid hsl(215 35% 20%)" }}
                  />
                ) : (
                  <div
                    className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold"
                    style={{
                      background: "linear-gradient(135deg, hsl(215 35% 22%), hsl(215 28% 28%))",
                      color: "#fff",
                    }}
                  >
                    {initials(m.displayName || m.email)}
                  </div>
                )}

                {/* Name */}
                <div className="min-w-0 w-full">
                  <div className="text-sm font-semibold truncate" style={{ color: "#fff" }}>
                    {m.displayName || "\u2014"}
                  </div>
                  {m.jobTitle && (
                    <div className="text-xs mt-0.5 truncate flex items-center justify-center gap-1" style={{ color: "hsl(214 25% 60%)" }}>
                      <Briefcase className="w-3 h-3 flex-shrink-0" /> {m.jobTitle}
                    </div>
                  )}
                </div>

                {/* Department + Location pills */}
                <div className="flex flex-wrap justify-center gap-1.5">
                  {m.department && (
                    <span
                      className="text-[11px] px-2 py-0.5 rounded-full flex items-center gap-1"
                      style={{ background: "hsl(197 89% 66% / 0.1)", color: "hsl(197 89% 66%)" }}
                    >
                      <Building2 className="w-3 h-3" /> {m.department}
                    </span>
                  )}
                  {m.location && (
                    <span
                      className="text-[11px] px-2 py-0.5 rounded-full flex items-center gap-1"
                      style={{ background: "hsl(215 28% 18%)", color: "hsl(214 25% 55%)" }}
                    >
                      <MapPin className="w-3 h-3" /> {m.location}
                    </span>
                  )}
                </div>

                {/* Call button (not shown for self) */}
                {m.uid !== me?.uid && (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); setCallTarget(m); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setCallTarget(m); } }}
                    className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-[11px] font-medium transition-colors mt-1"
                    style={{ background: "hsl(142 60% 55% / 0.1)", color: "hsl(142 60% 55%)", border: "1px solid hsl(142 60% 55% / 0.2)" }}
                  >
                    <Phone className="w-3 h-3" /> Call
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Profile drawer */}
      {drawerMember && (
        <ProfileDrawer
          member={drawerMember}
          onClose={() => setDrawerMember(null)}
          onUpdated={handleProfileUpdated}
        />
      )}

      {/* Call modal */}
      {callTarget && (
        <CallModal
          label={callTarget.displayName || callTarget.email}
          getToken={() => getCallTokenDM(callTarget.uid)}
          onClose={() => setCallTarget(null)}
        />
      )}
    </div>
  );
}
