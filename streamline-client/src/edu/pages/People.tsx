import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useEduMe } from "../layout/EduProtectedRoute";
import { listEduEvents, computeEduEventStatus } from "../state/eduEvents";
import {
  disableEduPerson,
  listEduPeopleFromApi,
  resendEduInvite,
  setEduPersonRole,
  inviteEduPerson,
  type EduPerson,
  type EduPersonRole,
} from "../api/people";

type TabId = "students" | "staff";

function roleLabel(role: EduPersonRole): string {
  if (role === "faculty_admin") return "Faculty Admin";
  if (role === "student_producer" || role === "student_producer_assigned") return "Student Producer";
  if (role === "talent") return "Talent";
  return "Viewer";
}

function roleBadgeClass(role: EduPersonRole): string {
  if (role === "faculty_admin") return "border-orange-500/30 bg-orange-500/15 text-orange-300";
  if (role === "student_producer" || role === "student_producer_assigned") return "border-blue-500/30 bg-blue-500/15 text-blue-300";
  if (role === "talent") return "border-purple-500/30 bg-purple-500/15 text-purple-300";
  return "border-slate-700/30 bg-slate-800/40 text-slate-300";
}

function statusBadge(status: EduPerson["status"]) {
  if (status === "active") return { label: "Active", cls: "border-emerald-500/20 bg-emerald-500/15 text-emerald-300" };
  if (status === "invited") return { label: "Invited", cls: "border-amber-500/20 bg-amber-500/15 text-amber-300" };
  return { label: "Disabled", cls: "border-slate-700/30 bg-slate-800/40 text-slate-400" };
}

function formatLastActive(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function isStaffRole(role: EduPersonRole): boolean {
  return role === "faculty_admin";
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" onClick={onClose} className="absolute inset-0 bg-black/60" aria-label="Close" />
      <div className="relative w-full max-w-xl rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-900 to-slate-900/40 p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="text-lg font-semibold text-white">{title}</div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-900 hover:text-white">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DrawerShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" onClick={onClose} className="absolute inset-0 bg-black/60" aria-label="Close" />
      <div className="absolute right-0 top-0 h-full w-full max-w-xl overflow-y-auto border-l border-slate-700/60 bg-slate-900">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-700/60 bg-slate-900/80 p-5 backdrop-blur-xl">
          <div className="min-w-0 truncate text-lg font-semibold text-white">{title}</div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-900 hover:text-white">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function DotsMenu({
  disabled,
  items,
}: {
  disabled?: boolean;
  items: Array<{ id: string; label: string; danger?: boolean; disabled?: boolean; onClick: () => void }>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!ref.current) return;
      if (ref.current.contains(t)) return;
      setOpen(false);
    }
    if (!open) return;
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={!!disabled}
        onClick={() => setOpen((v) => !v)}
        className={`rounded-lg p-2 ${disabled ? "cursor-not-allowed text-slate-700" : "text-slate-400 hover:bg-slate-800 hover:text-white"}`}
        aria-label="More"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 7a2 2 0 110-4 2 2 0 010 4zm0 7a2 2 0 110-4 2 2 0 010 4zm0 7a2 2 0 110-4 2 2 0 010 4z" />
        </svg>
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900 shadow-lg">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              disabled={!!it.disabled}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              className={`w-full px-4 py-2 text-left text-sm hover:bg-slate-800/60 ${
                it.disabled
                  ? "cursor-not-allowed text-slate-600"
                  : it.danger
                    ? "text-red-300"
                    : "text-slate-200"
              }`}
            >
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RoleSelect({
  value,
  onChange,
  allowFacultyAdmin,
  includeAssigned,
}: {
  value: EduPersonRole;
  onChange: (v: EduPersonRole) => void;
  allowFacultyAdmin?: boolean;
  includeAssigned?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as EduPersonRole)}
      className="w-full rounded-xl border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-sm text-white outline-none focus:border-orange-500/40"
    >
      {allowFacultyAdmin ? <option value="faculty_admin">Faculty Admin</option> : null}
      <option value="student_producer">Student Producer</option>
      {includeAssigned ? <option value="student_producer_assigned">Student Producer (Assigned)</option> : null}
      <option value="talent">Talent</option>
      <option value="viewer">Viewer</option>
    </select>
  );
}

export default function People() {
  const me = useEduMe();

  const roleRaw = String(me?.orgRole || me?.role || "viewer");
  const isFacultyAdmin = roleRaw === "faculty_admin";
  const isStudentProducer = roleRaw === "student_producer" || roleRaw === "student_producer_assigned";

  const [tab, setTab] = useState<TabId>("students");
  const [query, setQuery] = useState<string>("");

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<EduPerson[]>([]);
  const [refreshToken, setRefreshToken] = useState<number>(0);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState<string>("");
  const [inviteRole, setInviteRole] = useState<Exclude<EduPersonRole, "faculty_admin">>("student_producer");
  const [inviteAssignEventId, setInviteAssignEventId] = useState<string>("");
  const [inviteBusy, setInviteBusy] = useState<boolean>(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EduPerson | null>(null);
  const [editRole, setEditRole] = useState<EduPersonRole>("viewer");
  const [editBusy, setEditBusy] = useState(false);

  const [drawerTarget, setDrawerTarget] = useState<EduPerson | null>(null);
  const allEvents = listEduEvents();

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    listEduPeopleFromApi({ limit: 200 })
      .then((items) => {
        if (!mounted) return;
        setPeople(items);
        setLoading(false);
      })
      .catch((e: any) => {
        if (!mounted) return;
        setPeople([]);
        setLoading(false);
        setError(typeof e?.message === "string" ? e.message : "Failed to load people");
      });
    return () => {
      mounted = false;
    };
  }, [refreshToken]);

  const upcomingEvents = allEvents
    .filter((e) => {
      const status = computeEduEventStatus(e);
      if (status === "ended" || status === "canceled") return false;
      if (status === "live") return true;
      const start = new Date(e.startsAt).getTime();
      if (!Number.isFinite(start)) return true;
      return start >= Date.now() - 2 * 60 * 60_000;
    })
    .slice(0, 25)
    .map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt }));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let items = people;
    items = items.filter((p) => (tab === "staff" ? isStaffRole(p.role) : !isStaffRole(p.role)));
    if (q) {
      items = items.filter((p) => {
        const name = (p.name || "").toLowerCase();
        const email = (p.email || "").toLowerCase();
        return name.includes(q) || email.includes(q) || p.id.toLowerCase().includes(q);
      });
    }
    return items;
  }, [people, tab, query]);

  const staffCount = useMemo(() => people.filter((p) => isStaffRole(p.role)).length, [people]);
  const studentCount = useMemo(() => people.filter((p) => !isStaffRole(p.role)).length, [people]);

  async function onInviteSend() {
    if (!isFacultyAdmin) return;
    const email = inviteEmail.trim();
    if (!email) return;

    setInviteBusy(true);
    try {
      const res = await inviteEduPerson({
        email,
        role: inviteRole,
        assignEventId: inviteAssignEventId ? inviteAssignEventId : null,
      });
      if (res.ok) {
        setInviteOpen(false);
        setInviteEmail("");
        setInviteAssignEventId("");
        setRefreshToken((v) => v + 1);
      }
    } finally {
      setInviteBusy(false);
    }
  }

  async function onDisable(p: EduPerson) {
    if (!isFacultyAdmin) return;
    if (p.status === "disabled") return;
    await disableEduPerson(p.id).catch(() => null);
    setRefreshToken((v) => v + 1);
  }

  async function onResend(p: EduPerson) {
    if (!isFacultyAdmin) return;
    if (p.status !== "invited") return;
    await resendEduInvite(p.id).catch(() => null);
    setRefreshToken((v) => v + 1);
  }

  async function onSaveRole() {
    if (!isFacultyAdmin) return;
    if (!editTarget) return;
    setEditBusy(true);
    try {
      await setEduPersonRole(editTarget.id, editRole).catch(() => null);
      setEditOpen(false);
      setEditTarget(null);
      setRefreshToken((v) => v + 1);
    } finally {
      setEditBusy(false);
    }
  }

  const canSee = isFacultyAdmin || isStudentProducer;
  if (!canSee) {
    return <div className="p-6 text-slate-300">You don’t have access to this page.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-2xl font-bold text-white">People</div>
          <div className="mt-1 text-sm text-slate-400">Manage school access and roles.</div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <div className="relative">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="w-full min-w-[240px] rounded-xl border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-orange-500/40"
            />
          </div>
          {isFacultyAdmin ? (
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="rounded-xl bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:from-orange-400 hover:via-red-500 hover:to-violet-500"
            >
              Invite
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setTab("students")}
          className={`rounded-xl border border-transparent px-4 py-2 text-sm font-semibold transition-colors ${
            tab === "students"
              ? "border-slate-700 bg-slate-900/70 text-white"
              : "text-slate-400 hover:border-slate-700/60 hover:bg-slate-900/40 hover:text-slate-200"
          }`}
        >
          Students <span className="ml-2 text-xs text-slate-500">{studentCount}</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("staff")}
          className={`rounded-xl border border-transparent px-4 py-2 text-sm font-semibold transition-colors ${
            tab === "staff"
              ? "border-slate-700 bg-slate-900/70 text-white"
              : "text-slate-400 hover:border-slate-700/60 hover:bg-slate-900/40 hover:text-slate-200"
          }`}
        >
          Staff <span className="ml-2 text-xs text-slate-500">{staffCount}</span>
        </button>
      </div>

      <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left">
            <thead>
              <tr className="border-b border-slate-700/60 text-xs uppercase tracking-wider text-slate-500">
                <th className="px-5 py-4">Name</th>
                <th className="px-5 py-4">Email (or school ID)</th>
                <th className="px-5 py-4">Role</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4">Last active</th>
                <th className="px-5 py-4">Assigned events</th>
                <th className="px-5 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-5 py-6 text-sm text-slate-400" colSpan={7}>
                    Loading…
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td className="px-5 py-6 text-sm text-slate-400" colSpan={7}>
                    {error}
                  </td>
                </tr>
              ) : filtered.length ? (
                filtered.map((p) => {
                  const st = statusBadge(p.status);
                  return (
                    <tr key={p.id} className="border-b border-slate-700/30 last:border-b-0">
                      <td className="px-5 py-4">
                        <div className="font-medium text-white">{p.name || "—"}</div>
                        <div className="mt-1 text-xs text-slate-500">{p.id}</div>
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-200">{p.email || "—"}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${roleBadgeClass(p.role)}`}>
                          {roleLabel(p.role)}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${st.cls}`}>{st.label}</span>
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-300">{formatLastActive(p.lastActiveAt)}</td>
                      <td className="px-5 py-4 text-sm text-slate-300">{p.assignedEventsCount ?? 0}</td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-2">
                          {!isFacultyAdmin ? (
                            <button
                              type="button"
                              onClick={() => setDrawerTarget(p)}
                              className="rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                            >
                              View assignments
                            </button>
                          ) : (
                            <DotsMenu
                              items={[
                                {
                                  id: "edit",
                                  label: "Edit role",
                                  onClick: () => {
                                    setEditTarget(p);
                                    setEditRole(p.role);
                                    setEditOpen(true);
                                  },
                                },
                                {
                                  id: "disable",
                                  label: "Disable access",
                                  danger: true,
                                  disabled: p.status === "disabled",
                                  onClick: () => void onDisable(p),
                                },
                                ...(p.status === "invited"
                                  ? [
                                      {
                                        id: "resend",
                                        label: "Resend invite",
                                        onClick: () => void onResend(p),
                                      },
                                    ]
                                  : []),
                                {
                                  id: "assignments",
                                  label: "View assignments",
                                  onClick: () => setDrawerTarget(p),
                                },
                              ]}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="px-5 py-10 text-sm text-slate-400" colSpan={7}>
                    No people found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {inviteOpen ? (
        <ModalShell
          title="Invite"
          onClose={() => {
            if (inviteBusy) return;
            setInviteOpen(false);
          }}
        >
          <div className="space-y-4">
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Email</div>
              <input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="name@school.edu"
                className="w-full rounded-xl border border-slate-800/60 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-orange-500/40"
              />
            </div>

            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Role</div>
              <RoleSelect value={inviteRole} onChange={(v) => setInviteRole(v as any)} />
            </div>

            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Assign to upcoming event (optional)</div>
              <select
                value={inviteAssignEventId}
                onChange={(e) => setInviteAssignEventId(e.target.value)}
                className="w-full rounded-xl border border-slate-800/60 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-orange-500/40"
              >
                <option value="">None</option>
                {upcomingEvents.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={inviteBusy}
                onClick={() => setInviteOpen(false)}
                className={`rounded-xl border border-slate-800/60 px-4 py-2 text-sm text-slate-200 hover:bg-slate-900 ${
                  inviteBusy ? "cursor-not-allowed opacity-60" : ""
                }`}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={inviteBusy || !inviteEmail.trim()}
                onClick={() => void onInviteSend()}
                className={`rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 px-4 py-2 text-sm font-semibold text-white hover:from-orange-400 hover:to-amber-500 ${
                  inviteBusy || !inviteEmail.trim() ? "cursor-not-allowed opacity-60" : ""
                }`}
              >
                Send invite
              </button>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {editOpen && editTarget ? (
        <ModalShell
          title="Edit role"
          onClose={() => {
            if (editBusy) return;
            setEditOpen(false);
          }}
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-800/50 bg-slate-950/40 p-4">
              <div className="text-sm font-semibold text-white">{editTarget.name || "—"}</div>
              <div className="mt-1 text-sm text-slate-400">{editTarget.email || editTarget.id}</div>
            </div>

            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Role</div>
              <RoleSelect value={editRole} onChange={setEditRole} allowFacultyAdmin includeAssigned />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={editBusy}
                onClick={() => setEditOpen(false)}
                className={`rounded-xl border border-slate-800/60 px-4 py-2 text-sm text-slate-200 hover:bg-slate-900 ${
                  editBusy ? "cursor-not-allowed opacity-60" : ""
                }`}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={editBusy}
                onClick={() => void onSaveRole()}
                className={`rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 ${
                  editBusy ? "cursor-not-allowed opacity-60" : ""
                }`}
              >
                Save
              </button>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {drawerTarget ? (
        <DrawerShell title="Assignments" onClose={() => setDrawerTarget(null)}>
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-800/50 bg-slate-950/40 p-4">
              <div className="text-sm font-semibold text-white">{drawerTarget.name || "—"}</div>
              <div className="mt-1 text-sm text-slate-400">{drawerTarget.email || drawerTarget.id}</div>
              <div className="mt-2">
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${roleBadgeClass(drawerTarget.role)}`}>
                  {roleLabel(drawerTarget.role)}
                </span>
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Assigned events</div>
              {drawerTarget.assignedEventIds && drawerTarget.assignedEventIds.length ? (
                <div className="space-y-2">
                  {drawerTarget.assignedEventIds.map((id) => {
                    const ev = allEvents.find((e) => e.id === id);
                    return (
                      <div key={id} className="rounded-xl border border-slate-800/50 bg-slate-900/40 p-4">
                        <div className="text-sm font-semibold text-white">{ev?.title || id}</div>
                        {ev?.startsAt ? <div className="mt-1 text-sm text-slate-400">{new Date(ev.startsAt).toLocaleString()}</div> : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-slate-800/50 bg-slate-900/30 p-4 text-sm text-slate-400">No assignments yet.</div>
              )}
            </div>
          </div>
        </DrawerShell>
      ) : null}
    </div>
  );
}
