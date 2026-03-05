import { useCallback, useEffect, useState } from "react";
import {
  Users,
  Loader2,
  UserMinus,
  ChevronDown,
} from "lucide-react";
import { useCorporateMe } from "../layout/CorporateProtectedRoute";
import { isCorporateBypassEnabled } from "../state/corporateMode";
import {
  getOrgMembers,
  removeMember,
  type OrgMember,
} from "../api/orgs";
import { demoSeedId } from "@/lib/demoPaths";

const demoMembers: OrgMember[] = [
  { uid: demoSeedId("corporate", "usr", 1), email: "sarah.kim@corp.io", displayName: "Sarah Kim", role: "leader", status: "active", joinedAt: Date.now() - 365 * 86400_000 },
  { uid: demoSeedId("corporate", "usr", 2), email: "dev.patel@corp.io", displayName: "Dev Patel", role: "employee", status: "active", joinedAt: Date.now() - 200 * 86400_000 },
  { uid: demoSeedId("corporate", "usr", 3), email: "marcus.j@corp.io", displayName: "Marcus Johnson", role: "employee", status: "active", joinedAt: Date.now() - 150 * 86400_000 },
  { uid: demoSeedId("corporate", "usr", 4), email: "lisa.chen@corp.io", displayName: "Lisa Chen", role: "employee", status: "active", joinedAt: Date.now() - 90 * 86400_000 },
  { uid: demoSeedId("corporate", "usr", 5), email: "tom.w@corp.io", displayName: "Tom Wilson", role: "employee", status: "active", joinedAt: Date.now() - 30 * 86400_000 },
];

export default function Members() {
  const bypass = isCorporateBypassEnabled();
  const me = useCorporateMe();

  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [removingUid, setRemovingUid] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (bypass) {
        setMembers(demoMembers);
      } else {
        const list = await getOrgMembers();
        setMembers(list);
      }
    } catch (e: any) {
      setError(e.message || "Failed to load members");
    } finally {
      setLoading(false);
    }
  }, [bypass]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRemove = async (uid: string, name: string) => {
    if (!window.confirm(`Remove ${name || uid} from the organization?`)) return;
    setRemovingUid(uid);
    try {
      if (!bypass) await removeMember(uid);
      setMembers((prev) => prev.filter((m) => m.uid !== uid));
    } catch (e: any) {
      setError(e.message || "Remove failed");
    } finally {
      setRemovingUid(null);
    }
  };

  const formatDate = (ms: number | null) =>
    ms ? new Date(ms).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "—";

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="flex-1 p-6 flex flex-col gap-5 overflow-y-auto">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2" style={{ color: "#fff" }}>
            <Users className="w-5 h-5" style={{ color: "hsl(197 89% 66%)" }} />
            Members
          </h1>
          <p className="text-xs mt-1" style={{ color: "hsl(214 25% 50%)" }}>
            Manage your organization's team members and roles
          </p>
        </div>

        {error && (
          <div className="rounded-lg px-4 py-3 text-sm" style={{ background: "hsl(0 70% 20% / 0.3)", border: "1px solid hsl(0 50% 30%)", color: "hsl(0 80% 70%)" }}>
            {error}
            <button className="ml-3 underline text-xs" onClick={() => setError("")}>dismiss</button>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: "hsl(197 89% 66%)" }} />
          </div>
        )}

        {!loading && (
          <div className="rounded-xl overflow-hidden" style={{ background: "hsl(218 35% 13%)", border: "1px solid hsl(215 35% 20%)" }}>
            <div className="flex items-center gap-3 px-5 py-4">
              <Users className="w-5 h-5" style={{ color: "hsl(197 89% 66%)" }} />
              <span className="text-sm font-semibold" style={{ color: "#fff" }}>Organization Members</span>
              <span className="text-xs font-mono px-2 py-0.5 rounded-full" style={{ background: "hsl(197 89% 66% / 0.15)", color: "hsl(197 89% 66%)" }}>
                {members.length}
              </span>
            </div>

            {/* Header */}
            <div className="grid grid-cols-[1fr_180px_90px_100px_60px] gap-3 px-5 py-2.5 text-[10px] font-semibold tracking-[1px] uppercase" style={{ borderTop: "1px solid hsl(215 35% 20%)", borderBottom: "1px solid hsl(215 35% 20%)", color: "hsl(214 25% 45%)", background: "hsl(218 35% 10%)" }}>
              <span>Name</span>
              <span>Email</span>
              <span>Role</span>
              <span>Joined</span>
              <span />
            </div>

            {members.length === 0 && (
              <div className="px-5 py-8 text-center text-sm" style={{ color: "hsl(214 25% 50%)" }}>
                No members yet — share your join code to invite people
              </div>
            )}

            {members.map((m) => (
              <div
                key={m.uid}
                className="grid grid-cols-[1fr_180px_90px_100px_60px] gap-3 items-center px-5 py-3 transition-colors"
                style={{ borderBottom: "1px solid hsl(215 35% 20% / 0.5)", color: "#fff" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "hsl(215 28% 18% / 0.4)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold flex-shrink-0" style={{ background: "linear-gradient(135deg, hsl(215 35% 22%), hsl(215 28% 28%))", color: "#fff" }}>
                    {(m.displayName || m.email || "?").split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?"}
                  </div>
                  <span className="truncate text-sm font-medium">{m.displayName || "—"}</span>
                </div>
                <span className="truncate text-xs" style={{ color: "hsl(214 25% 60%)" }}>{m.email}</span>
                <span
                  className="text-xs font-mono px-2 py-0.5 rounded-full w-fit"
                  style={{
                    background: m.role === "leader" ? "hsl(197 89% 66% / 0.15)" : m.role === "external" ? "hsl(40 90% 50% / 0.12)" : "hsl(215 28% 18%)",
                    color: m.role === "leader" ? "hsl(197 89% 66%)" : m.role === "external" ? "hsl(40 90% 60%)" : "hsl(214 25% 55%)",
                  }}
                >
                  {m.role}
                </span>
                <span className="text-xs" style={{ color: "hsl(214 25% 55%)" }}>{formatDate(m.joinedAt)}</span>
                <div>
                  {m.uid !== me?.uid && (
                    <button
                      onClick={() => handleRemove(m.uid, m.displayName || m.email)}
                      disabled={removingUid === m.uid}
                      title="Remove member"
                      className="p-1.5 rounded-lg transition-colors disabled:opacity-50"
                      style={{ color: "hsl(355 82% 65%)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "hsl(355 82% 65% / 0.1)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      {removingUid === m.uid ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserMinus className="w-4 h-4" />}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
