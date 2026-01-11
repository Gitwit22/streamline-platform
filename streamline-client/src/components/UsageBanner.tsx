import { useEffect, useState } from "react";

// Use relative paths - Vite proxy forwards /api/* to http://localhost:5137
const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

type UsageSummary = {
  displayName: string;
  planId: string;
  usedHours: number;
  maxHours: number;
  ytdHours: number;
  resetDate: string | null;
  maxGuests: number;
  multistreamEnabled: boolean;
};

export default function UsageBanner() {
  const [data, setData] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/usage/me`, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        const planId = json?.plan?.id || json?.user?.planId || "free";
        const participantMinutes = Number(json?.usageMonthly?.usage?.participantMinutes ?? 0);
        const usedHours = Math.round((participantMinutes / 60) * 10) / 10;
        const maxMinutes = Number(json?.plan?.limits?.participantMinutes ?? 0);
        const maxHours = maxMinutes > 0 ? Math.round((maxMinutes / 60) * 10) / 10 : 0;
        const ytdMinutes = Number(json?.usageMonthly?.ytd?.participantMinutes ?? 0);
        const ytdHours = Math.round((ytdMinutes / 60) * 10) / 10;
        const resetDate = json?.resetDate || null;
        const multistreamEnabled = !!json?.plan?.features?.rtmpMultistream;
        const maxGuests = Number(json?.plan?.limits?.maxGuests ?? (planId === "pro" ? 10 : planId === "starter" ? 2 : 1));

        setData({
          displayName: "",
          planId,
          usedHours,
          maxHours,
          ytdHours,
          resetDate,
          maxGuests,
          multistreamEnabled,
        });
      } catch (err) {
        console.error("usage banner error", err);
        setError("Could not load usage");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  if (loading) {
    return (
      <div className="w-full max-w-3xl mx-auto mb-4 rounded-xl border border-zinc-700 bg-zinc-900/80 px-4 py-3 text-xs text-zinc-300">
        Loading your usage…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="w-full max-w-3xl mx-auto mb-4 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-xs text-zinc-400">
        Usage data unavailable right now.
      </div>
    );
  }

  const {
    displayName,
    planId,
    usedHours,
    maxHours,
    ytdHours,
    resetDate,
    maxGuests,
    multistreamEnabled,
  } = data;

  const resetText = resetDate
    ? new Date(resetDate).toLocaleDateString()
    : "N/A";

  const usedPct =
    maxHours > 0 ? Math.min(100, (usedHours / maxHours) * 100) : 0;

  return (
    <div className="w-full max-w-3xl mx-auto mb-6 rounded-2xl border border-zinc-700/80 bg-zinc-900/90 px-5 py-4 text-sm text-zinc-100 shadow-lg">
      <div className="flex items-center justify-between gap-4 mb-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-400">
            StreamLine Usage
          </div>
          <div className="text-base">
            Welcome back,{" "}
            <span className="font-semibold">
              {displayName || "Streamer"}
            </span>
            .
          </div>
          <div className="text-xs text-zinc-400 mt-1">
            Plan:{" "}
            <span className="font-semibold text-zinc-100">
              {planId}
            </span>{" "}
            • Up to{" "}
            <span className="font-semibold text-zinc-100">
              {maxGuests}
            </span>{" "}
            guests • Multistream{" "}
            <span className="font-semibold text-zinc-100">
              {multistreamEnabled ? "ON" : "OFF"}
            </span>
          </div>
        </div>
        <div className="text-right text-xs text-zinc-400">
          <div>
            This month:{" "}
            <span className="font-semibold text-zinc-100">
              {usedHours.toFixed(1)} / {maxHours.toFixed(1)} hrs
            </span>
          </div>
          <div>
            YTD:{" "}
            <span className="font-semibold text-zinc-100">
              {ytdHours.toFixed(1)} hrs
            </span>
          </div>
          <div>Resets: {resetText}</div>
        </div>
      </div>

      {/* progress bar */}
      <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden mt-2">
        <div
          className={`h-full ${
            usedPct > 90 ? "bg-red-500" : usedPct > 70 ? "bg-amber-500" : "bg-emerald-500"
          }`}
          style={{ width: `${usedPct}%` }}
        />
      </div>
    </div>
  );
}
