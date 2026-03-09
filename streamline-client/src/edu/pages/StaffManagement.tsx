import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Phone, MessageSquare, Loader2 } from "lucide-react";
import { useEduMe } from "../layout/EduProtectedRoute";
import {
  fetchPendingStaff,
  createPendingStaff,
  regenerateStaffCode,
  updateStaffStatus,
  type PendingStaffRecord,
} from "../api/schoolPortal";
import { createEduCall } from "../api/calls";
import { getOrCreateDirectChatRoom, type DirectCallTarget } from "../api/directComms";

/* ── Helpers ────────────────────────────────────────────────────── */

function initials(name: string): string {
  return (name || "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

const badgeCls: Record<string, string> = {
  pending: "border-yellow-500/30 bg-yellow-500/10 text-yellow-300",
  active: "border-green-500/30 bg-green-500/10 text-green-300",
  inactive: "border-slate-600/30 bg-slate-700/20 text-slate-400",
};

const inputCls =
  "mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/10";
const labelCls = "block text-sm font-medium text-slate-300";


/* ================================================================
   StaffManagement — manage pending & active staff accounts
   Rendered inside PeopleHub "Staff" tab
   ================================================================ */

export default function StaffManagement() {
  const me = useEduMe();
  const navigate = useNavigate();
  const isFacultyAdmin = String(me?.orgRole || me?.role || "") === "faculty_admin";
  const isFacultyTeacher = String(me?.orgRole || me?.role || "") === "faculty_teacher";
  const isStaff = isFacultyAdmin || isFacultyTeacher;

  const [staff, setStaff] = useState<PendingStaffRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [callBusy, setCallBusy] = useState<string | null>(null);
  const [chatBusy, setChatBusy] = useState<string | null>(null);

  /** Can the current user contact this staff member? */
  function canContact(s: PendingStaffRecord): boolean {
    if (!isStaff) return false;
    if (s.status !== "active") return false;
    if (s.id === me?.uid) return false;
    return true;
  }

  /** Start a direct call with a staff member. */
  const handleStartCall = useCallback(async (s: PendingStaffRecord) => {
    if (callBusy) return;
    setCallBusy(s.id);
    try {
      const target: DirectCallTarget = {
        uid: s.id,
        name: s.fullName,
        role: s.positionTitle || s.role,
      };
      // Create a scheduled call so the recipient gets the incoming-call banner
      const call = await createEduCall({
        title: `Call with ${s.fullName}`,
        participants: [s.id],
      });
      // Navigate to Calls page with context to auto-connect
      navigate("/streamline/edu/calls", {
        state: {
          directCallTarget: target,
          callId: call.id,
          autoConnect: true,
        },
      });
    } catch (err: any) {
      console.error("[StaffMgmt] call error:", err?.message || err);
    } finally {
      setCallBusy(null);
    }
  }, [callBusy, me?.uid, navigate]);

  /** Open a direct chat with a staff member. */
  const handleOpenChat = useCallback(async (s: PendingStaffRecord) => {
    if (chatBusy) return;
    setChatBusy(s.id);
    try {
      const { roomId } = await getOrCreateDirectChatRoom(s.id);
      navigate("/streamline/edu/chat", {
        state: {
          directRoomId: roomId,
          targetName: s.fullName,
        },
      });
    } catch (err: any) {
      console.error("[StaffMgmt] chat error:", err?.message || err);
    } finally {
      setChatBusy(null);
    }
  }, [chatBusy, navigate]);

  /* ── Fetch ─────────────────────────────────────────────────── */
  const loadStaff = useCallback(async () => {
    try {
      setLoading(true);
      const list = await fetchPendingStaff();
      setStaff(list);
    } catch (e: any) {
      setError(e?.message || "Failed to load staff");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStaff(); }, [loadStaff]);

  /* ── Actions ───────────────────────────────────────────────── */
  const handleRegenerate = useCallback(async (id: string) => {
    setActionBusy(id);
    try {
      const result = await regenerateStaffCode(id);
      setStaff((prev) => prev.map((s) => (s.id === id ? { ...s, onboardingCode: result.onboardingCode } : s)));
    } catch {}
    setActionBusy(null);
  }, []);

  const handleStatusToggle = useCallback(async (id: string, current: string) => {
    const next: "active" | "inactive" = current === "inactive" ? "active" : "inactive";
    setActionBusy(id);
    try {
      await updateStaffStatus(id, next);
      setStaff((prev) => prev.map((s) => (s.id === id ? { ...s, status: next as any } : s)));
    } catch {}
    setActionBusy(null);
  }, []);

  const copyCode = useCallback((code: string, id: string) => {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  /* ── Filter ────────────────────────────────────────────────── */
  const filtered = useMemo(() => {
    if (!search.trim()) return staff;
    const q = search.toLowerCase();
    return staff.filter(
      (s) =>
        s.fullName.toLowerCase().includes(q) ||
        (s.email || "").toLowerCase().includes(q) ||
        s.positionTitle.toLowerCase().includes(q) ||
        s.onboardingCode.toLowerCase().includes(q),
    );
  }, [staff, search]);

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
            {staff.length} staff member{staff.length !== 1 ? "s" : ""}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search staff..."
              className="rounded-xl border border-slate-700 bg-slate-800/50 py-2.5 pl-10 pr-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-orange-500"
            />
          </div>

          {/* Add Staff button */}
          {isFacultyAdmin && (
            <button
              onClick={() => setShowAdd(true)}
              className="rounded-xl bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
            >
              + Add Staff
            </button>
          )}
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

      {/* Add Staff form (inline) */}
      {showAdd && isFacultyAdmin && (
        <AddStaffForm
          onCreated={(rec) => {
            setStaff((prev) => [rec, ...prev]);
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
              <th className="px-5 py-3">Name</th>
              <th className="px-5 py-3">Position</th>
              <th className="px-5 py-3">Status</th>
              {isStaff && <th className="px-5 py-3 text-center">Contact</th>}
              <th className="px-5 py-3">Activation Code</th>
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
                      {s.email && <div className="text-xs text-slate-400">{s.email}</div>}
                    </div>
                  </div>
                </td>
                <td className="px-5 py-4 text-sm text-slate-300">{s.positionTitle || "—"}</td>
                <td className="px-5 py-4">
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs ${badgeCls[s.status] || badgeCls["pending"]}`}>
                    {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                  </span>
                </td>
                {isStaff && (
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-center gap-2">
                      {canContact(s) ? (
                        <>
                          <button
                            onClick={() => handleStartCall(s)}
                            disabled={callBusy === s.id}
                            title={`Call ${s.fullName}`}
                            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-700 hover:text-green-400 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {callBusy === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
                          </button>
                          <button
                            onClick={() => handleOpenChat(s)}
                            disabled={chatBusy === s.id}
                            title={`Chat with ${s.fullName}`}
                            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-700 hover:text-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {chatBusy === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
                          </button>
                        </>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </div>
                  </td>
                )}
                <td className="px-5 py-4">
                  <div className="flex items-center gap-2">
                    <code className="rounded bg-slate-800 px-2 py-1 font-mono text-xs tracking-widest text-orange-300">{s.onboardingCode}</code>
                    <button
                      onClick={() => copyCode(s.onboardingCode, s.id)}
                      className="rounded p-1 text-slate-400 hover:text-white"
                      title="Copy code"
                    >
                      {copiedId === s.id ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 text-green-400"><path d="M20 6 9 17l-5-5" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
                      )}
                    </button>
                  </div>
                </td>
                {isFacultyAdmin && (
                  <td className="px-5 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {s.status === "pending" && (
                        <button
                          onClick={() => handleRegenerate(s.id)}
                          disabled={actionBusy === s.id}
                          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-700 disabled:opacity-50"
                          title="Regenerate code"
                        >
                          Regen
                        </button>
                      )}
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
                <td colSpan={isFacultyAdmin ? 6 : isStaff ? 5 : 4} className="px-5 py-12 text-center text-slate-400">
                  {search ? "No staff match your search." : "No staff added yet. Click '+ Add Staff' to invite team members."}
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
   AddStaffForm — inline form to create a pending staff record
   ================================================================ */

function AddStaffForm({
  onCreated,
  onCancel,
}: {
  onCreated: (rec: PendingStaffRecord) => void;
  onCancel: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"faculty_admin" | "faculty_teacher">("faculty_teacher");
  const [position, setPosition] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [createdRecord, setCreatedRecord] = useState<PendingStaffRecord | null>(null);

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError("");
      if (!fullName.trim()) { setError("Full name is required."); return; }

      setBusy(true);
      try {
        const rec = await createPendingStaff({
          fullName: fullName.trim(),
          role,
          positionTitle: position.trim(),
          email: email.trim() || undefined,
        });
        setCreatedRecord(rec);
      } catch (err: any) {
        setError(err?.message || "Failed to create staff record.");
      } finally {
        setBusy(false);
      }
    },
    [fullName, role, position, email],
  );

  /* ── Show activation code after creation ─────────────────── */
  if (createdRecord) {
    return (
      <div className="rounded-2xl border border-green-500/20 bg-green-500/5 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-500/20">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5 text-green-400"><path d="M20 6 9 17l-5-5" /></svg>
          </div>
          <div>
            <div className="font-semibold text-white">Staff Added: {createdRecord.fullName}</div>
            <p className="text-sm text-slate-400">Share this activation code with them.</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3">
          <span className="text-sm text-slate-400">Activation Code:</span>
          <code className="font-mono text-lg tracking-[0.3em] text-orange-300 font-bold">{createdRecord.onboardingCode}</code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(createdRecord.onboardingCode).catch(() => {});
            }}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
          >
            Copy
          </button>
        </div>

        <p className="text-xs text-slate-500">
          Direct them to your school portal's "Activate Account" tab. They'll use this code + choose their own username & password.
        </p>

        <button
          onClick={() => onCreated(createdRecord)}
          className="rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-700"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-slate-700 bg-slate-800/30 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Add Staff Member</h3>
        <button type="button" onClick={onCancel} className="text-slate-400 hover:text-white text-sm">
          Cancel
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Full Name *</label>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputCls} placeholder="Jordan Lee" />
        </div>
        <div>
          <label className={labelCls}>Position / Title</label>
          <input value={position} onChange={(e) => setPosition(e.target.value)} className={inputCls} placeholder="Media Arts Teacher" />
        </div>
        <div>
          <label className={labelCls}>Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as any)}
            className={inputCls + " appearance-none"}
          >
            <option value="faculty_teacher">Teacher</option>
            <option value="faculty_admin">Admin</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Email (optional)</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="jordan@school.edu" type="email" />
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button type="submit" disabled={busy} className="rounded-xl bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {busy ? "Creating…" : "Create & Generate Code"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl border border-slate-700 px-5 py-2.5 text-sm text-slate-300 hover:bg-slate-700">
          Cancel
        </button>
      </div>
    </form>
  );
}
