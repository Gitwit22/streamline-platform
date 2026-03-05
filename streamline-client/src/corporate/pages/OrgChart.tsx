import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Network,
  Loader2,
  ChevronRight,
  ChevronDown,
  Briefcase,
  Building2,
  Users,
} from "lucide-react";
import { fetchDirectory, type DirectoryMember } from "../api/directory";
import ProfileDrawer from "../components/ProfileDrawer";

/* ── Tree node type ─────────────────────────────────────────── */
interface TreeNode {
  member: DirectoryMember;
  children: TreeNode[];
}

export default function OrgChart() {
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<DirectoryMember[]>([]);
  const [error, setError] = useState("");
  const [drawerMember, setDrawerMember] = useState<DirectoryMember | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchDirectory();
      setMembers(res.members);
    } catch (e: any) {
      setError(e.message || "Failed to load organization data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* Build tree from flat member list */
  const roots = useMemo(() => {
    const byUid = new Map<string, DirectoryMember>();
    members.forEach((m) => byUid.set(m.uid, m));

    const childrenOf = new Map<string | null, DirectoryMember[]>();
    members.forEach((m) => {
      const parent = m.managerUserId ?? null;
      if (!childrenOf.has(parent)) childrenOf.set(parent, []);
      childrenOf.get(parent)!.push(m);
    });

    function build(parentId: string | null): TreeNode[] {
      const kids = childrenOf.get(parentId) || [];
      return kids.map((m) => ({
        member: m,
        children: build(m.uid),
      }));
    }

    // Root nodes: members with no manager, OR whose manager doesn't exist
    const rootMembers = members.filter(
      (m) => !m.managerUserId || !byUid.has(m.managerUserId),
    );
    // Build children for each root
    return rootMembers.map((m) => ({
      member: m,
      children: build(m.uid),
    }));
  }, [members]);

  const handleProfileUpdated = (updated: Partial<DirectoryMember> & { uid: string }) => {
    setMembers((prev) =>
      prev.map((m) => (m.uid === updated.uid ? { ...m, ...updated } : m)),
    );
    setDrawerMember((prev) =>
      prev && prev.uid === updated.uid ? { ...prev, ...updated } : prev,
    );
  };

  const totalWithManager = members.filter((m) => m.managerUserId).length;

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="flex-1 p-6 flex flex-col gap-5 overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1
              className="text-xl font-bold tracking-tight flex items-center gap-2"
              style={{ color: "#fff" }}
            >
              <Network className="w-5 h-5" style={{ color: "hsl(197 89% 66%)" }} />
              Organization Chart
            </h1>
            <p className="text-xs mt-1" style={{ color: "hsl(214 25% 50%)" }}>
              Visualize reporting structure and team hierarchy
            </p>
          </div>
          {!loading && (
            <div className="flex gap-3">
              <StatPill icon={<Users className="w-3.5 h-3.5" />} label="Members" value={members.length} />
              <StatPill icon={<Network className="w-3.5 h-3.5" />} label="Reporting" value={totalWithManager} />
            </div>
          )}
        </div>

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

        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: "hsl(197 89% 66%)" }} />
          </div>
        )}

        {!loading && roots.length === 0 && (
          <div className="text-center py-16 text-sm" style={{ color: "hsl(214 25% 50%)" }}>
            No organization data found. Assign managers to build the org chart.
          </div>
        )}

        {/* Tree */}
        {!loading && roots.length > 0 && (
          <div
            className="rounded-xl p-5"
            style={{
              background: "hsl(218 35% 13%)",
              border: "1px solid hsl(215 35% 20%)",
            }}
          >
            {roots.map((node) => (
              <OrgNode
                key={node.member.uid}
                node={node}
                depth={0}
                onSelect={setDrawerMember}
              />
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
    </div>
  );
}

/* ── Recursive tree node ──────────────────────────────────────── */

function OrgNode({
  node,
  depth,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  onSelect: (m: DirectoryMember) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2); // auto-expand first 2 levels
  const m = node.member;
  const hasKids = node.children.length > 0;

  const initials = (m.displayName || m.email || "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";

  return (
    <div style={{ paddingLeft: depth > 0 ? 24 : 0 }}>
      {/* Connector lines for non-root */}
      <div className="flex items-center gap-2 group">
        {/* Expand/collapse toggle */}
        {hasKids ? (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-0.5 rounded transition-colors"
            style={{ color: "hsl(214 25% 50%)" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "hsl(214 25% 50%)"; }}
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        ) : (
          <span className="w-5" /> // spacer
        )}

        {/* Node card */}
        <button
          onClick={() => onSelect(m)}
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 flex-1 min-w-0 text-left transition-colors"
          style={{ border: "1px solid transparent" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "hsl(215 28% 18% / 0.6)";
            e.currentTarget.style.borderColor = "hsl(215 35% 25%)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "transparent";
          }}
        >
          {/* Avatar */}
          {m.photoURL ? (
            <img
              src={m.photoURL}
              alt={m.displayName}
              className="w-9 h-9 rounded-full object-cover flex-shrink-0"
              style={{ border: "2px solid hsl(215 35% 20%)" }}
            />
          ) : (
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{
                background: "linear-gradient(135deg, hsl(215 35% 22%), hsl(215 28% 28%))",
                color: "#fff",
              }}
            >
              {initials}
            </div>
          )}

          {/* Info */}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate" style={{ color: "#fff" }}>
              {m.displayName || "\u2014"}
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {m.jobTitle && (
                <span className="text-[11px] flex items-center gap-1 truncate" style={{ color: "hsl(214 25% 55%)" }}>
                  <Briefcase className="w-3 h-3 flex-shrink-0" /> {m.jobTitle}
                </span>
              )}
              {m.department && (
                <span className="text-[11px] flex items-center gap-1 truncate" style={{ color: "hsl(197 89% 66% / 0.7)" }}>
                  <Building2 className="w-3 h-3 flex-shrink-0" /> {m.department}
                </span>
              )}
            </div>
          </div>

          {/* Direct report count badge */}
          {hasKids && (
            <span
              className="text-[10px] font-mono px-2 py-0.5 rounded-full flex-shrink-0"
              style={{
                background: "hsl(197 89% 66% / 0.12)",
                color: "hsl(197 89% 66%)",
              }}
            >
              {node.children.length} direct
            </span>
          )}
        </button>
      </div>

      {/* Children */}
      {expanded && hasKids && (
        <div
          className="ml-5"
          style={{ borderLeft: "1px solid hsl(215 35% 20% / 0.5)" }}
        >
          {node.children.map((child) => (
            <OrgNode key={child.member.uid} node={child} depth={depth + 1} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Stat pill ──────────────────────────────────────────────── */
function StatPill({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs"
      style={{
        background: "hsl(218 35% 13%)",
        border: "1px solid hsl(215 35% 20%)",
        color: "hsl(214 25% 60%)",
      }}
    >
      <span style={{ color: "hsl(197 89% 66%)" }}>{icon}</span>
      <span>{label}</span>
      <span className="font-semibold" style={{ color: "#fff" }}>{value}</span>
    </div>
  );
}
