import { useEffect, useMemo, useState } from "react";
import { useEduMe } from "../layout/EduProtectedRoute";
import { isEduBypassEnabled } from "../state/eduMode";
import { DEMO_STUDENTS, type DemoStudent } from "../state/demoData";
import { apiFetchAuth } from "../../lib/api";

/* ── Types ─────────────────────────────────────────────────────── */

type Student = {
  id: string;
  name: string;
  email: string;
  grade: string;
  role: "student" | "student_media";
  mediaClub: boolean;
};

/* ── Helpers ────────────────────────────────────────────────────── */

function roleLabel(role: string): string {
  if (role === "student_media") return "Media Club";
  return "Student";
}

function roleBadgeClass(role: string): string {
  if (role === "student_media")
    return "border-blue-500/30 bg-blue-500/15 text-blue-300";
  return "border-slate-700/30 bg-slate-800/40 text-slate-300";
}

function initials(name: string): string {
  return (name || "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

/* ── Component ─────────────────────────────────────────────────── */

export default function Students() {
  const me = useEduMe();
  const isDemo = isEduBypassEnabled();
  const isFacultyAdmin = String(me?.orgRole || me?.role || "") === "faculty_admin";

  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterMediaClub, setFilterMediaClub] = useState(false);

  useEffect(() => {
    if (isDemo) {
      setStudents(DEMO_STUDENTS as Student[]);
      setLoading(false);
      return;
    }

    let mounted = true;
    (async () => {
      try {
        const res = await apiFetchAuth("/api/edu/students?limit=200");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (mounted) setStudents(data.students || []);
      } catch (e: any) {
        if (mounted) setError(e?.message || "Failed to load students");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [isDemo]);

  const filtered = useMemo(() => {
    let list = students;
    if (filterMediaClub) {
      list = list.filter((s) => s.mediaClub);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.email.toLowerCase().includes(q) ||
          s.grade.includes(q),
      );
    }
    return list;
  }, [students, search, filterMediaClub]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-slate-800" />
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-800/50" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Students</h1>
          <p className="mt-1 text-sm text-slate-400">
            {students.length} student{students.length !== 1 ? "s" : ""} enrolled
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setFilterMediaClub(!filterMediaClub)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              filterMediaClub
                ? "border border-blue-500/30 bg-blue-500/15 text-blue-300"
                : "border border-slate-700 text-slate-400 hover:text-white"
            }`}
          >
            Media Club Only
          </button>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search students..."
              className="rounded-xl border border-slate-700 bg-slate-800/50 py-2.5 pl-10 pr-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-orange-500"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-700">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-800/50 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
              <th className="px-5 py-3">Student Name</th>
              <th className="px-5 py-3">Grade</th>
              <th className="px-5 py-3">Role</th>
              <th className="px-5 py-3">Media Club</th>
              <th className="px-5 py-3">Email</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {filtered.map((stu) => (
              <tr key={stu.id} className="bg-slate-800/20 transition hover:bg-slate-800/40">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-700/60 text-sm font-semibold text-white">
                      {initials(stu.name)}
                    </div>
                    <span className="font-medium text-white">{stu.name}</span>
                  </div>
                </td>
                <td className="px-5 py-4 text-sm text-slate-300">{stu.grade}</td>
                <td className="px-5 py-4">
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs ${roleBadgeClass(stu.role)}`}>
                    {roleLabel(stu.role)}
                  </span>
                </td>
                <td className="px-5 py-4 text-sm">
                  {stu.mediaClub ? (
                    <span className="text-blue-300">✓ Member</span>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </td>
                <td className="px-5 py-4 font-mono text-xs text-slate-400">{stu.email}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-slate-400">
                  {search || filterMediaClub
                    ? "No students match your filters."
                    : "No students enrolled yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
