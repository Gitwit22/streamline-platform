import { useCallback, useEffect, useMemo, useState } from "react";
import { useEduMe } from "../layout/EduProtectedRoute";
import { listEduPeopleFromApi, type EduPerson } from "../api/people";
import { getTeacherPermissions, updateTeacherPermissions } from "../api/permissions";
import {
  type TeacherPermissions,
  DEFAULT_TEACHER_PERMISSIONS,
} from "../types/teacherPermissions";
import PermissionsModal from "../components/PermissionsModal";

/* ── Helpers ────────────────────────────────────────────────────── */

function statusBadge(status: EduPerson["status"]) {
  if (status === "active")
    return { label: "Active", cls: "border-emerald-500/20 bg-emerald-500/15 text-emerald-300" };
  if (status === "invited")
    return { label: "Invited", cls: "border-amber-500/20 bg-amber-500/15 text-amber-300" };
  return { label: "Disabled", cls: "border-slate-700/30 bg-slate-800/40 text-slate-400" };
}

function roleBadge(role: string) {
  if (role === "faculty_admin")
    return { label: "Admin", cls: "border-orange-500/30 bg-orange-500/15 text-orange-300" };
  return { label: "Teacher", cls: "border-blue-500/30 bg-blue-500/15 text-blue-300" };
}

function isTeacher(p: EduPerson): boolean {
  return p.role === ("faculty_teacher" as any);
}

function isAdminOrTeacher(p: EduPerson): boolean {
  return p.role === "faculty_admin" || p.role === ("faculty_teacher" as any);
}

/* ─── Component ────────────────────────────────────────────────── */

export default function RolesPermissions() {
  const me = useEduMe();
  const isFacultyAdmin = String(me?.orgRole || me?.role || "") === "faculty_admin";

  const [people, setPeople] = useState<EduPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  /* Permissions modal state */
  const [modalTarget, setModalTarget] = useState<EduPerson | null>(null);
  const [modalPerms, setModalPerms] = useState<TeacherPermissions | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalSaving, setModalSaving] = useState(false);

  /* Toast */
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  /* ── Load people ────────────────────────────────────────────── */
  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const list = await listEduPeopleFromApi({ limit: 200 });
      setPeople(list);
    } catch (e: any) {
      setError(e?.message || "Failed to load people");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* ── Filter to teachers only (for the permissions table) ──── */
  const teachers = useMemo(() => {
    const q = query.trim().toLowerCase();
    let items = people.filter((p) => isTeacher(p));
    if (q) {
      items = items.filter(
        (p) =>
          (p.name || "").toLowerCase().includes(q) ||
          (p.email || "").toLowerCase().includes(q),
      );
    }
    return items;
  }, [people, query]);

  /* Also compute admin count for context */
  const adminCount = useMemo(() => people.filter((p) => p.role === "faculty_admin").length, [people]);
  const teacherCount = teachers.length;

  /* ── Open permissions modal ─────────────────────────────────── */
  async function openPermissions(person: EduPerson) {
    setModalTarget(person);
    setModalPerms(null);
    setModalLoading(true);
    try {
      const perms = await getTeacherPermissions(person.id);
      setModalPerms(perms);
    } catch {
      setModalPerms({ ...DEFAULT_TEACHER_PERMISSIONS });
    } finally {
      setModalLoading(false);
    }
  }

  async function savePermissions(perms: TeacherPermissions) {
    if (!modalTarget) return;
    setModalSaving(true);
    try {
      const res = await updateTeacherPermissions(modalTarget.id, perms);
      if (res.ok) {
        setToast(`Permissions updated for ${modalTarget.name || "teacher"}`);
        setModalTarget(null);
        setModalPerms(null);
      }
    } catch {
      setToast("Failed to save permissions");
    } finally {
      setModalSaving(false);
    }
  }

  function closeModal() {
    if (modalSaving) return;
    setModalTarget(null);
    setModalPerms(null);
  }

  /* ── Guard ──────────────────────────────────────────────────── */
  if (!isFacultyAdmin) {
    return <div className="p-6 text-slate-300">Only admins can manage roles and permissions.</div>;
  }

  return (
    <div className="space-y-5">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-[100] rounded-xl border border-emerald-600/30 bg-emerald-900/80 px-4 py-2.5 text-sm font-medium text-emerald-200 shadow-lg backdrop-blur-sm">
          {toast}
        </div>
      )}

      {/* Context header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-lg font-semibold text-white">Teacher Permissions</div>
          <div className="mt-1 text-sm text-slate-400">
            {teacherCount} teacher{teacherCount !== 1 ? "s" : ""} &middot; {adminCount} admin{adminCount !== 1 ? "s" : ""}
          </div>
        </div>
        <div className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search teachers…"
            className="w-full min-w-[240px] rounded-xl border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-orange-500/40"
          />
        </div>
      </div>

      {/* Info panel */}
      <div className="rounded-xl border border-slate-700/40 bg-slate-800/20 px-4 py-3 text-sm text-slate-400">
        <span className="font-medium text-slate-200">Admins</span> always have full permissions and are not listed here. Only <span className="font-medium text-slate-200">teachers</span> appear below with editable granular permissions.
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="border-b border-slate-700/60 text-xs uppercase tracking-wider text-slate-500">
                <th className="px-5 py-4">Name</th>
                <th className="px-5 py-4">Email</th>
                <th className="px-5 py-4">Role</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4 text-right">Permissions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-sm text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-sm text-red-300">
                    {error}
                  </td>
                </tr>
              ) : teachers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">
                    {query.trim()
                      ? "No teachers match your search."
                      : "No teachers found. Teachers created with the \"Teacher\" role will appear here."}
                  </td>
                </tr>
              ) : (
                teachers.map((p) => {
                  const st = statusBadge(p.status);
                  const rb = roleBadge(p.role);
                  return (
                    <tr key={p.id} className="border-b border-slate-700/30 last:border-b-0">
                      <td className="px-5 py-4">
                        <div className="font-medium text-white">{p.name || "—"}</div>
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-200">{p.email || "—"}</td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${rb.cls}`}
                        >
                          {rb.label}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${st.cls}`}
                        >
                          {st.label}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => openPermissions(p)}
                          className="rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-orange-300 hover:bg-slate-700 hover:text-orange-200 transition-colors"
                        >
                          Edit Permissions
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Permissions Modal */}
      {modalTarget && (
        modalLoading ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <button type="button" onClick={closeModal} className="absolute inset-0 bg-black/60" aria-label="Close" />
            <div className="relative rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center">
              <div className="text-sm text-slate-300">Loading permissions…</div>
            </div>
          </div>
        ) : modalPerms ? (
          <PermissionsModal
            teacherName={modalTarget.name || modalTarget.email || "Teacher"}
            initial={modalPerms}
            busy={modalSaving}
            onSave={savePermissions}
            onCancel={closeModal}
          />
        ) : null
      )}
    </div>
  );
}
