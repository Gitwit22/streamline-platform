import { useCallback, useEffect, useState } from "react";
import {
  Building2,
  Copy,
  Check,
  RefreshCw,
  Key,
  Loader2,
} from "lucide-react";
import { useCorporateMe } from "../layout/CorporateProtectedRoute";
import { isCorporateBypassEnabled } from "../state/corporateMode";
import {
  getOrgInfo,
  regenerateJoinCode,
  type OrgInfoResult,
} from "../api/orgs";

export default function Company() {
  const bypass = isCorporateBypassEnabled();
  const me = useCorporateMe();

  const [loading, setLoading] = useState(false);
  const [org, setOrg] = useState<OrgInfoResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState("");

  const loadOrg = useCallback(async () => {
    if (bypass) return;
    setLoading(true);
    try {
      const info = await getOrgInfo();
      setOrg(info);
    } catch (e: any) {
      setError(e.message || "Failed to load org info");
    } finally {
      setLoading(false);
    }
  }, [bypass]);

  useEffect(() => {
    loadOrg();
  }, [loadOrg]);

  const copyCode = () => {
    if (!org?.joinCode) return;
    navigator.clipboard.writeText(org.joinCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRegenerate = async () => {
    if (!window.confirm("Generate a new join code? The old code will stop working.")) return;
    setRegenerating(true);
    try {
      const newCode = await regenerateJoinCode();
      setOrg((prev) => (prev ? { ...prev, joinCode: newCode } : prev));
    } catch (e: any) {
      setError(e.message || "Regenerate failed");
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="flex-1 p-6 flex flex-col gap-5 overflow-y-auto">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2" style={{ color: "#fff" }}>
            <Building2 className="w-5 h-5" style={{ color: "hsl(197 89% 66%)" }} />
            Company
          </h1>
          <p className="text-xs mt-1" style={{ color: "hsl(214 25% 50%)" }}>
            Organization profile, join code, and company setup
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
          <div className="flex flex-col gap-4">
            {/* Org identity card */}
            <div className="rounded-xl p-5 flex flex-col gap-4" style={{ background: "hsl(218 35% 13%)", border: "1px solid hsl(215 35% 20%)" }}>
              <div className="flex items-center gap-3 mb-1">
                <Building2 className="w-5 h-5" style={{ color: "hsl(197 89% 66%)" }} />
                <span className="text-sm font-semibold" style={{ color: "#fff" }}>Organization Profile</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] font-semibold tracking-[1px] uppercase mb-1" style={{ color: "hsl(214 25% 45%)" }}>Name</div>
                  <div className="text-sm" style={{ color: "#fff" }}>{org?.name || me?.orgName || "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold tracking-[1px] uppercase mb-1" style={{ color: "hsl(214 25% 45%)" }}>Slug</div>
                  <div className="text-sm font-mono" style={{ color: "hsl(197 89% 66%)" }}>{org?.slug || "—"}</div>
                </div>
              </div>
            </div>

            {/* Join code card */}
            <div className="rounded-xl p-5 flex flex-col gap-4" style={{ background: "hsl(218 35% 13%)", border: "1px solid hsl(215 35% 20%)" }}>
              <div className="flex items-center gap-3 mb-1">
                <Key className="w-5 h-5" style={{ color: "hsl(142 60% 55%)" }} />
                <span className="text-sm font-semibold" style={{ color: "#fff" }}>Join Code</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-mono" style={{ background: "hsl(142 60% 55% / 0.15)", color: "hsl(142 60% 55%)" }}>
                  Share with your team
                </span>
              </div>
              <p className="text-xs" style={{ color: "hsl(214 25% 55%)" }}>
                New employees sign up at the Corporate login, then enter your organization slug
                (<span className="font-mono" style={{ color: "hsl(197 89% 66%)" }}>{org?.slug || "—"}</span>)
                and this join code to get added.
              </p>
              <div className="flex items-center gap-3">
                <div className="flex-1 px-4 py-3 rounded-lg font-mono text-lg tracking-[0.25em] text-center select-all" style={{ background: "hsl(218 35% 8%)", border: "1px solid hsl(215 35% 20%)", color: "hsl(142 60% 55%)" }}>
                  {org?.joinCode || "———"}
                </div>
                <button onClick={copyCode} title="Copy to clipboard" className="p-2.5 rounded-lg transition-colors" style={{ background: "hsl(215 28% 18%)", border: "1px solid hsl(215 35% 20%)", color: copied ? "hsl(142 60% 55%)" : "hsl(214 25% 60%)" }}>
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
                <button onClick={handleRegenerate} disabled={regenerating} title="Regenerate join code" className="p-2.5 rounded-lg transition-colors disabled:opacity-50" style={{ background: "hsl(215 28% 18%)", border: "1px solid hsl(215 35% 20%)", color: "hsl(214 25% 60%)" }}>
                  <RefreshCw className={`w-4 h-4 ${regenerating ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {/* Roles card */}
            <div className="rounded-xl p-5 flex flex-col gap-4" style={{ background: "hsl(218 35% 13%)", border: "1px solid hsl(215 35% 20%)" }}>
              <span className="text-sm font-semibold" style={{ color: "#fff" }}>Roles</span>
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3 px-4 py-3 rounded-lg" style={{ background: "hsl(218 35% 10%)", border: "1px solid hsl(215 35% 20% / 0.5)" }}>
                  <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-full" style={{ background: "hsl(197 89% 66% / 0.15)", color: "hsl(197 89% 66%)" }}>leader</span>
                  <span className="text-xs flex-1" style={{ color: "hsl(214 25% 65%)" }}>Full access — company setup, user management, analytics, settings</span>
                </div>
                <div className="flex items-center gap-3 px-4 py-3 rounded-lg" style={{ background: "hsl(218 35% 10%)", border: "1px solid hsl(215 35% 20% / 0.5)" }}>
                  <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-full" style={{ background: "hsl(215 28% 18%)", color: "hsl(214 25% 55%)" }}>employee</span>
                  <span className="text-xs flex-1" style={{ color: "hsl(214 25% 65%)" }}>Day-to-day access — chat, calls, broadcasts, training, documents</span>
                </div>
                <div className="flex items-center gap-3 px-4 py-3 rounded-lg" style={{ background: "hsl(218 35% 10%)", border: "1px solid hsl(215 35% 20% / 0.5)" }}>
                  <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-full" style={{ background: "hsl(40 90% 50% / 0.12)", color: "hsl(40 90% 60%)" }}>external</span>
                  <span className="text-xs flex-1" style={{ color: "hsl(214 25% 65%)" }}>Limited access for vendors &amp; partners — chat, documents</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
