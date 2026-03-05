import { useState } from "react";
import {
  X,
  Mail,
  MessageSquare,
  Phone,
  MapPin,
  Briefcase,
  Building2,
  Pencil,
  Check,
  Loader2,
} from "lucide-react";
import type { DirectoryMember } from "../api/directory";
import { updateProfile } from "../api/directory";
import { useCorporateMe } from "../layout/CorporateProtectedRoute";
import { useNavigate } from "react-router-dom";

interface Props {
  member: DirectoryMember | null;
  onClose: () => void;
  onUpdated?: (updated: Partial<DirectoryMember> & { uid: string }) => void;
}

export default function ProfileDrawer({ member, onClose, onUpdated }: Props) {
  const me = useCorporateMe();
  const nav = useNavigate();
  const isAdmin = me?.orgRole === "owner" || me?.orgRole === "admin";
  const isSelf = me?.uid === member?.uid;
  const canEdit = isSelf || isAdmin;

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    jobTitle: "",
    department: "",
    location: "",
    bio: "",
  });

  if (!member) return null;

  const startEdit = () => {
    setForm({
      jobTitle: member.jobTitle,
      department: member.department,
      location: member.location,
      bio: member.bio,
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      const patch: any = { ...form };
      if (!isSelf) patch.targetUid = member.uid;
      await updateProfile(patch);
      onUpdated?.({ uid: member.uid, ...form });
      setEditing(false);
    } catch {
      // silent for now
    } finally {
      setSaving(false);
    }
  };

  const initials = (member.displayName || member.email || "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";

  const roleBadge = (role: string) => {
    const styles: Record<string, { bg: string; color: string }> = {
      owner: { bg: "hsl(40 90% 50% / 0.15)", color: "hsl(40 90% 60%)" },
      admin: { bg: "hsl(197 89% 66% / 0.15)", color: "hsl(197 89% 66%)" },
      employee: { bg: "hsl(215 28% 18%)", color: "hsl(214 25% 55%)" },
    };
    const s = styles[role] || styles.employee;
    return (
      <span
        className="text-xs font-mono px-2 py-0.5 rounded-full"
        style={{ background: s.bg, color: s.color }}
      >
        {role}
      </span>
    );
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[60] bg-black/50 animate-fade-in"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="fixed right-0 top-0 z-[61] h-full w-[400px] max-w-[90vw] flex flex-col animate-slide-in-right"
        style={{ background: "hsl(218 35% 11%)", borderLeft: "1px solid hsl(215 35% 20%)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid hsl(215 35% 20%)" }}
        >
          <span className="text-sm font-semibold" style={{ color: "#fff" }}>Profile</span>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: "hsl(214 25% 55%)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "hsl(215 28% 18%)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
          {/* Avatar + name */}
          <div className="flex flex-col items-center gap-3">
            {member.photoURL ? (
              <img
                src={member.photoURL}
                alt={member.displayName}
                className="w-20 h-20 rounded-full object-cover"
                style={{ border: "2px solid hsl(215 35% 20%)" }}
              />
            ) : (
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold"
                style={{
                  background: "linear-gradient(135deg, hsl(215 35% 22%), hsl(215 28% 28%))",
                  color: "#fff",
                }}
              >
                {initials}
              </div>
            )}
            <div className="text-center">
              <div className="text-lg font-semibold" style={{ color: "#fff" }}>
                {member.displayName || "\u2014"}
              </div>
              {member.jobTitle && (
                <div className="text-sm mt-0.5" style={{ color: "hsl(214 25% 60%)" }}>
                  {member.jobTitle}
                </div>
              )}
              <div className="mt-2">{roleBadge(member.role)}</div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => { onClose(); nav("/streamline/corporate/chat"); }}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors"
              style={{ background: "hsl(197 89% 66% / 0.15)", color: "hsl(197 89% 66%)", border: "1px solid hsl(197 89% 66% / 0.25)" }}
            >
              <MessageSquare className="w-4 h-4" /> Message
            </button>
            <button
              onClick={() => { onClose(); nav("/streamline/corporate/calls"); }}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors"
              style={{ background: "hsl(142 60% 55% / 0.12)", color: "hsl(142 60% 55%)", border: "1px solid hsl(142 60% 55% / 0.25)" }}
            >
              <Phone className="w-4 h-4" /> Call
            </button>
          </div>

          {/* Info fields (view mode) */}
          {!editing && (
            <div className="flex flex-col gap-3">
              <InfoRow icon={<Mail className="w-4 h-4" />} label="Email" value={member.email} />
              <InfoRow icon={<Briefcase className="w-4 h-4" />} label="Job Title" value={member.jobTitle || "\u2014"} />
              <InfoRow icon={<Building2 className="w-4 h-4" />} label="Department" value={member.department || "\u2014"} />
              <InfoRow icon={<MapPin className="w-4 h-4" />} label="Location" value={member.location || "\u2014"} />
              {member.bio && (
                <div className="mt-1">
                  <div className="text-[10px] font-semibold tracking-[1px] uppercase mb-1" style={{ color: "hsl(214 25% 45%)" }}>Bio</div>
                  <div className="text-sm leading-relaxed" style={{ color: "hsl(214 25% 70%)" }}>{member.bio}</div>
                </div>
              )}

              {canEdit && (
                <button
                  onClick={startEdit}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-medium transition-colors self-start mt-2"
                  style={{ background: "hsl(215 28% 18%)", border: "1px solid hsl(215 35% 20%)", color: "hsl(214 25% 65%)" }}
                >
                  <Pencil className="w-3.5 h-3.5" />
                  {isSelf ? "Edit My Profile" : "Edit Profile"}
                </button>
              )}
            </div>
          )}

          {/* Edit mode */}
          {editing && (
            <div className="flex flex-col gap-3">
              <EditField label="Job Title" value={form.jobTitle} onChange={(v) => setForm((f) => ({ ...f, jobTitle: v }))} />
              <EditField label="Department" value={form.department} onChange={(v) => setForm((f) => ({ ...f, department: v }))} />
              <EditField label="Location" value={form.location} onChange={(v) => setForm((f) => ({ ...f, location: v }))} />
              <div>
                <div className="text-[10px] font-semibold tracking-[1px] uppercase mb-1" style={{ color: "hsl(214 25% 45%)" }}>Bio</div>
                <textarea
                  value={form.bio}
                  onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
                  rows={3}
                  maxLength={500}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none"
                  style={{ background: "hsl(218 35% 8%)", border: "1px solid hsl(215 35% 20%)", color: "#fff" }}
                />
              </div>
              <div className="flex gap-2 mt-1">
                <button
                  onClick={saveEdit}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-50"
                  style={{ background: "hsl(197 89% 66% / 0.2)", border: "1px solid hsl(197 89% 66% / 0.4)", color: "hsl(197 89% 66%)" }}
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Save
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="px-4 py-2 rounded-lg text-[13px] font-medium transition-colors"
                  style={{ background: "hsl(215 28% 18%)", border: "1px solid hsl(215 35% 20%)", color: "hsl(214 25% 60%)" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ── Helper components ──────────────────────────────────────────── */

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div style={{ color: "hsl(214 25% 45%)" }}>{icon}</div>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold tracking-[1px] uppercase" style={{ color: "hsl(214 25% 45%)" }}>{label}</div>
        <div className="text-sm truncate" style={{ color: "#fff" }}>{value}</div>
      </div>
    </div>
  );
}

function EditField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="text-[10px] font-semibold tracking-[1px] uppercase mb-1" style={{ color: "hsl(214 25% 45%)" }}>{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={200}
        className="w-full px-3 py-2 rounded-lg text-sm outline-none"
        style={{ background: "hsl(218 35% 8%)", border: "1px solid hsl(215 35% 20%)", color: "#fff" }}
      />
    </div>
  );
}
