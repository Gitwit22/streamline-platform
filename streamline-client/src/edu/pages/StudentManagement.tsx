import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useEduMe } from "../layout/EduProtectedRoute";
import {
  fetchStudents,
  createStudent,
  resetStudentPassword,
  updateStudentStatus,
  type StudentRecord,
} from "../api/schoolPortal";

/* ── Helpers ────────────────────────────────────────────────────── */

function initials(name: string): string {
  return (name || "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

const badgeCls: Record<string, string> = {
  active: "border-green-500/30 bg-green-500/10 text-green-300",
  inactive: "border-slate-600/30 bg-slate-700/20 text-slate-400",
};

const inputCls =
  "mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/10";
const labelCls = "block text-sm font-medium text-slate-300";

/** Auto-suggest a username from full name: "Jordan Lee" → "jordan.lee" */
function suggestUsername(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, "")
    .replace(/\s+/g, ".")
    .slice(0, 30);
}

/* ================================================================
   StudentManagement — create & manage student accounts
   Rendered inside PeopleHub "Students" tab
   ================================================================ */

export default function StudentManagement() {
  const me = useEduMe();
  const isFacultyAdmin = String(me?.orgRole || me?.role || "") === "faculty_admin";

  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{ id: string; password: string } | null>(null);

  /* ── Fetch ─────────────────────────────────────────────────── */
  const loadStudents = useCallback(async () => {
    try {
      setLoading(true);
      const list = await fetchStudents();
      setStudents(list);
    } catch (e: any) {
      setError(e?.message || "Failed to load students");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStudents(); }, [loadStudents]);

  /* ── Actions ───────────────────────────────────────────────── */
  const handleResetPassword = useCallback(async (id: string) => {
    setActionBusy(id);
    try {
      const result = await resetStudentPassword(id);
      setResetResult({ id, password: result.tempPassword });
    } catch {}
    setActionBusy(null);
  }, []);

  const handleStatusToggle = useCallback(async (id: string, current: string) => {
    const next = current === "inactive" ? "active" : "inactive";
    setActionBusy(id);
    try {
      await updateStudentStatus(id, next);
      setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, status: next as any } : s)));
    } catch {}
    setActionBusy(null);
  }, []);

  /* ── Filter ────────────────────────────────────────────────── */
  const filtered = useMemo(() => {
    if (!search.trim()) return students;
    const q = search.toLowerCase();
    return students.filter(
      (s) =>
        s.fullName.toLowerCase().includes(q) ||
        s.username.toLowerCase().includes(q) ||
        s.grade.includes(q) ||
        (s.classHomeroom || "").toLowerCase().includes(q),
    );
  }, [students, search]);

  /* ── Loading ───────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-slate-800" />
        {[1, 2, 3].map((i) => (
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
          <p className="text-sm text-slate-400">
            {students.length} student{students.length !== 1 ? "s" : ""}
          </p>
        </div>

        <div className="flex items-center gap-3">
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

          {isFacultyAdmin && (
            <button
              onClick={() => setShowAdd(true)}
              className="rounded-xl bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
            >
              + Create Student
            </button>
          )}
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

      {/* Password-reset result callout */}
      {resetResult && (
        <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/5 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-white">
              Temporary Password for {students.find((s) => s.id === resetResult.id)?.fullName || "Student"}
            </div>
            <button onClick={() => setResetResult(null)} className="text-slate-400 hover:text-white text-xs">Dismiss</button>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3">
            <code className="font-mono text-lg tracking-wider text-orange-300 font-bold">{resetResult.password}</code>
            <button
              onClick={() => navigator.clipboard.writeText(resetResult.password).catch(() => {})}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
            >
              Copy
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Share this with the student. They will be prompted to change it on first login.
          </p>
        </div>
      )}

      {/* Add Student form */}
      {showAdd && isFacultyAdmin && (
        <CreateStudentForm
          onCreated={(rec, tempPw) => {
            setStudents((prev) => [rec, ...prev]);
            setResetResult({ id: rec.id, password: tempPw });
            setShowAdd(false);
          }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-700">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-800/50 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
              <th className="px-5 py-3">Student</th>
              <th className="px-5 py-3">Username</th>
              <th className="px-5 py-3">Grade</th>
              <th className="px-5 py-3">Status</th>
              {isFacultyAdmin && <th className="px-5 py-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {filtered.map((s) => (
              <tr key={s.id} className="bg-slate-800/20 transition hover:bg-slate-800/40">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-700/60 text-sm font-semibold text-white">
                      {initials(s.fullName)}
                    </div>
                    <div>
                      <div className="font-medium text-white">{s.fullName}</div>
                      {s.classHomeroom && <div className="text-xs text-slate-400">{s.classHomeroom}</div>}
                    </div>
                  </div>
                </td>
                <td className="px-5 py-4 font-mono text-sm text-orange-300">{s.username}</td>
                <td className="px-5 py-4 text-sm text-slate-300">{s.grade || "—"}</td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-0.5 text-xs ${badgeCls[s.status] || badgeCls["active"]}`}>
                      {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                    </span>
                    {s.mustChangePassword && (
                      <span className="rounded border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-300">
                        Needs PW change
                      </span>
                    )}
                  </div>
                </td>
                {isFacultyAdmin && (
                  <td className="px-5 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleResetPassword(s.id)}
                        disabled={actionBusy === s.id}
                        className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-50"
                        title="Reset password"
                      >
                        Reset PW
                      </button>
                      <button
                        onClick={() => handleStatusToggle(s.id, s.status)}
                        disabled={actionBusy === s.id}
                        className={`rounded-lg border px-3 py-1.5 text-xs transition disabled:opacity-50 ${
                          s.status === "inactive"
                            ? "border-green-500/30 text-green-300 hover:bg-green-500/10"
                            : "border-red-500/30 text-red-300 hover:bg-red-500/10"
                        }`}
                      >
                        {s.status === "inactive" ? "Reactivate" : "Deactivate"}
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={isFacultyAdmin ? 5 : 4} className="px-5 py-12 text-center text-slate-400">
                  {search ? "No students match your search." : "No students yet. Click '+ Create Student' to add one."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ================================================================
   CreateStudentForm — inline form to create a student account
   ================================================================ */

function CreateStudentForm({
  onCreated,
  onCancel,
}: {
  onCreated: (rec: StudentRecord, tempPassword: string) => void;
  onCancel: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [grade, setGrade] = useState("");
  const [homeroom, setHomeroom] = useState("");
  const [mediaClub, setMediaClub] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [usernameManuallyEdited, setUsernameManuallyEdited] = useState(false);

  /* Auto-suggest username from name */
  const handleNameChange = useCallback(
    (val: string) => {
      setFullName(val);
      if (!usernameManuallyEdited) {
        setUsername(suggestUsername(val));
      }
    },
    [usernameManuallyEdited],
  );

  const handleUsernameChange = useCallback((val: string) => {
    setUsername(val);
    setUsernameManuallyEdited(true);
  }, []);

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError("");
      if (!fullName.trim()) { setError("Full name is required."); return; }
      if (!username.trim()) { setError("Username is required."); return; }

      setBusy(true);
      try {
        const result = await createStudent({
          fullName: fullName.trim(),
          username: username.trim(),
          grade: grade.trim(),
          classHomeroom: homeroom.trim(),
          role: "student_producer",
          mediaClubMember: mediaClub,
        });
        onCreated(result.student, result.tempPassword);
      } catch (err: any) {
        setError(err?.message || "Failed to create student.");
      } finally {
        setBusy(false);
      }
    },
    [fullName, username, grade, homeroom, mediaClub, onCreated],
  );

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-slate-700 bg-slate-800/30 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Create Student Account</h3>
        <button type="button" onClick={onCancel} className="text-slate-400 hover:text-white text-sm">Cancel</button>
      </div>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Full Name *</label>
          <input value={fullName} onChange={(e) => handleNameChange(e.target.value)} className={inputCls} placeholder="Maya Chen" />
        </div>
        <div>
          <label className={labelCls}>Username *</label>
          <input
            value={username}
            onChange={(e) => handleUsernameChange(e.target.value)}
            className={inputCls + " font-mono"}
            placeholder="maya.chen"
          />
          <p className="mt-1 text-xs text-slate-500">Auto-generated from name. Students use this to sign in.</p>
        </div>
        <div>
          <label className={labelCls}>Grade</label>
          <input value={grade} onChange={(e) => setGrade(e.target.value)} className={inputCls} placeholder="10" />
        </div>
        <div>
          <label className={labelCls}>Class / Homeroom</label>
          <input value={homeroom} onChange={(e) => setHomeroom(e.target.value)} className={inputCls} placeholder="Room 304" />
        </div>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={mediaClub}
          onChange={(e) => setMediaClub(e.target.checked)}
          className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-orange-500 focus:ring-orange-500"
        />
        <span className="text-sm text-slate-300">Media Club member</span>
      </label>

      <div className="flex items-center gap-3 pt-2">
        <button type="submit" disabled={busy} className="rounded-xl bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {busy ? "Creating…" : "Create Student"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl border border-slate-700 px-5 py-2.5 text-sm text-slate-300 hover:bg-slate-700">
          Cancel
        </button>
      </div>

      <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 px-4 py-3 text-xs text-slate-400">
        A temporary password will be auto-generated. You'll see it after creation — share it with the student.
        They'll be prompted to change it on first login.
      </div>
    </form>
  );
}
