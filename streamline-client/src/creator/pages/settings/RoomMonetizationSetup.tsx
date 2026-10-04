/**
 * Channel viewer access + earnings (Settings → HLS, per selected channel).
 *
 * Who may watch the channel is enforced SERVER-SIDE when a viewer asks for
 * playback (signed, short-lived playlist URLs for every non-public mode):
 *   public        – anyone
 *   registered    – signed-in StreamLine accounts
 *   subscriber    – coming soon (no subscription product yet)
 *   pay_per_view  – ticket holders of a paid event (Monetization page)
 *   private       – you, your cohosts and an email allowlist
 *
 * Replaces the old per-room "monetization / pay-per-view" toggles, which were
 * never enforced. roomId is the channel's home room (same doc as branding).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE } from "../../../lib/apiBase";
import { apiFetchAuth } from "../../../lib/api";
import { formatPrice, type ViewerAccessMode } from "../../../lib/playbackAccess";

export interface RoomMonetizationSetupProps {
  /** Currently selected channel's home roomId (from SettingsHlsSetup). */
  roomId: string | null;
  /** Whether HLS is enabled on this room (from hlsConfig.enabled). */
  hlsEnabled: boolean;
  /** Platform-level monetization kill-switch. */
  platformMonetizationEnabled: boolean;
  /** Platform-level PPV kill-switch. */
  platformPayPerViewEnabled: boolean;
  /** Plan-level monetization entitlement. */
  planMonetization: boolean;
  /** Plan-level PPV entitlement. */
  planPayPerView: boolean;
  /** Navigate to upgrade/billing. */
  onUpgrade?: () => void;
}

type ModeOption = { available: boolean; reason: string | null };

type PaidEvent = {
  id: string;
  name: string;
  monetizationMode: "fixed" | "pwyw" | "donation" | "off";
  currency: string;
  fixedAmountCents: number | null;
  pwywMinCents: number | null;
  status: string;
};

type ViewerAccessResponse = {
  roomId: string;
  viewerAccess: { mode: ViewerAccessMode; ppvEventId?: string | null; allowEmails?: string[] };
  effective: { mode: ViewerAccessMode; ppvEventId?: string | null };
  live: boolean;
  liveProtected: boolean;
  activePaidEvents: PaidEvent[];
  options: Record<ViewerAccessMode, ModeOption>;
};

type EarningsTotals = {
  currency: string;
  grossCents: number;
  platformFeeCents: number;
  netCents: number;
  refundedCents: number;
  paidCount: number;
  refundedCount: number;
  disputedCount: number;
};

const MODE_COPY: Record<ViewerAccessMode, { label: string; help: string }> = {
  public: { label: "Public", help: "Anyone with the link can watch. Free (ads coming later)." },
  registered: { label: "Registered viewers", help: "Viewers must sign in with a free StreamLine account." },
  subscriber: { label: "Subscribers", help: "Paying channel subscribers only." },
  pay_per_view: { label: "Pay-per-view", help: "Viewers buy a ticket for a paid event. Payment unlocks their device automatically." },
  private: { label: "Private", help: "Only you, your cohosts and the emails you list below." },
};

const MODES: ViewerAccessMode[] = ["public", "registered", "subscriber", "pay_per_view", "private"];

/** Option availability = server answer AND client-known platform flags. */
export function modeAvailability(
  mode: ViewerAccessMode,
  server: Record<ViewerAccessMode, ModeOption> | null,
  flags: { hlsEnabled: boolean; platformMonetizationEnabled: boolean; platformPayPerViewEnabled: boolean; planPayPerView: boolean }
): ModeOption {
  if (mode === "subscriber") return { available: false, reason: "Coming soon — channel subscriptions are not available yet." };
  if (mode === "public") return { available: true, reason: null };
  if (!flags.hlsEnabled) return { available: false, reason: "Enable HLS on this channel first." };
  if (mode === "pay_per_view") {
    if (!flags.platformMonetizationEnabled || !flags.platformPayPerViewEnabled) {
      return { available: false, reason: "Pay-per-view is currently disabled platform-wide." };
    }
    if (!flags.planPayPerView) return { available: false, reason: "Pay-per-view is not included in your plan." };
  }
  return server?.[mode] ?? { available: true, reason: null };
}

const box: React.CSSProperties = {
  marginTop: 16,
  padding: "12px 14px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(15,23,42,0.5)",
};

export default function RoomMonetizationSetup({
  roomId,
  hlsEnabled,
  platformMonetizationEnabled,
  platformPayPerViewEnabled,
  planMonetization,
  planPayPerView,
  onUpgrade,
}: RoomMonetizationSetupProps) {
  const [data, setData] = useState<ViewerAccessResponse | null>(null);
  const [mode, setMode] = useState<ViewerAccessMode>("public");
  const [ppvEventId, setPpvEventId] = useState<string>("");
  const [allowEmails, setAllowEmails] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [earnings, setEarnings] = useState<{ totals: EarningsTotals[]; platformFeeBps: number } | null>(null);

  const load = useCallback(async () => {
    if (!roomId) return;
    try {
      const res = await apiFetchAuth(
        `${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/viewer-access`,
        { cache: "no-store" },
        { allowNonOk: true }
      );
      const body = (await res.json().catch(() => null)) as ViewerAccessResponse | null;
      if (res.ok && body) {
        setData(body);
        setMode(body.viewerAccess?.mode || "public");
        setPpvEventId(body.viewerAccess?.ppvEventId || body.activePaidEvents?.[0]?.id || "");
        setAllowEmails((body.viewerAccess?.allowEmails || []).join("\n"));
      }
    } catch {
      // non-fatal
    }
  }, [roomId]);

  useEffect(() => {
    setData(null);
    setMsg(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (!planMonetization || !platformMonetizationEnabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetchAuth(`${API_BASE}/api/monetization/earnings`, { cache: "no-store" }, { allowNonOk: true });
        const body = await res.json().catch(() => null);
        if (!cancelled && res.ok && body?.ok) setEarnings({ totals: body.totals || [], platformFeeBps: body.platformFeeBps ?? 1000 });
      } catch {
        // non-fatal
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planMonetization, platformMonetizationEnabled]);

  const flags = { hlsEnabled, platformMonetizationEnabled, platformPayPerViewEnabled, planPayPerView };
  const options = useMemo(
    () => Object.fromEntries(MODES.map((m) => [m, modeAvailability(m, data?.options ?? null, flags)])) as Record<ViewerAccessMode, ModeOption>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, hlsEnabled, platformMonetizationEnabled, platformPayPerViewEnabled, planPayPerView]
  );

  async function save() {
    if (!roomId) return;
    setSaving(true);
    setMsg(null);
    try {
      const payload: Record<string, unknown> = { mode };
      if (mode === "pay_per_view" && ppvEventId) payload.ppvEventId = ppvEventId;
      if (mode === "private") {
        payload.allowEmails = allowEmails
          .split(/[\s,;]+/)
          .map((e) => e.trim())
          .filter(Boolean);
      }
      const res = await apiFetchAuth(
        `${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/viewer-access`,
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
        { allowNonOk: true }
      );
      const body = await res.json().catch(() => null);
      if (res.ok) {
        setMsg({ kind: "ok", text: "Viewer access saved." });
        await load();
      } else {
        setMsg({ kind: "err", text: body?.reason || body?.error || "Could not save viewer access." });
      }
    } catch {
      setMsg({ kind: "err", text: "Could not save viewer access." });
    } finally {
      setSaving(false);
    }
  }

  if (!roomId) return null;

  const stored = data?.viewerAccess?.mode || "public";
  const effective = data?.effective?.mode || stored;
  const dirty =
    mode !== stored ||
    (mode === "pay_per_view" && (ppvEventId || "") !== (data?.viewerAccess?.ppvEventId || "")) ||
    (mode === "private" && allowEmails.trim() !== (data?.viewerAccess?.allowEmails || []).join("\n").trim());

  return (
    <>
      <div style={box} data-testid="viewer-access-settings">
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e5e7eb", marginBottom: 4 }}>👁 Who can watch this channel</div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>
          Enforced on our servers: non-public channels only play through short-lived, signed links.
        </div>

        <div role="radiogroup" aria-label="Viewer access" style={{ display: "grid", gap: 6 }}>
          {MODES.map((m) => {
            const opt = options[m];
            const selected = mode === m;
            return (
              <label
                key={m}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: `1px solid ${selected ? "rgba(99,102,241,0.6)" : "rgba(255,255,255,0.06)"}`,
                  background: selected ? "rgba(99,102,241,0.12)" : "transparent",
                  opacity: opt.available || selected ? 1 : 0.55,
                  cursor: opt.available ? "pointer" : "not-allowed",
                }}
              >
                <input
                  type="radio"
                  name={`viewer-access-${roomId}`}
                  value={m}
                  checked={selected}
                  disabled={!opt.available || saving}
                  onChange={() => setMode(m)}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <span style={{ fontSize: 13, color: "#e5e7eb", fontWeight: 600 }}>
                    {MODE_COPY[m].label}
                    {m === "subscriber" ? (
                      <span style={{ marginLeft: 6, fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "rgba(148,163,184,0.2)", color: "#cbd5e1" }}>
                        Coming soon
                      </span>
                    ) : null}
                  </span>
                  <span style={{ display: "block", fontSize: 11, color: "#94a3b8", marginTop: 1 }}>{MODE_COPY[m].help}</span>
                  {!opt.available && opt.reason ? (
                    <span style={{ display: "block", fontSize: 11, color: "#f59e0b", marginTop: 2 }}>{opt.reason}</span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>

        {mode === "pay_per_view" && (data?.activePaidEvents?.length || 0) > 0 ? (
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 12, color: "#cbd5e1" }}>
              Ticketed event
              <select
                value={ppvEventId}
                onChange={(e) => setPpvEventId(e.target.value)}
                style={{ display: "block", marginTop: 4, width: "100%", padding: "6px 8px", borderRadius: 6, background: "#0f172a", color: "#e5e7eb", border: "1px solid rgba(255,255,255,0.12)" }}
              >
                {data!.activePaidEvents.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} —{" "}
                    {e.monetizationMode === "fixed"
                      ? formatPrice(e.fixedAmountCents, e.currency)
                      : `pay what you want (min ${formatPrice(e.pwywMinCents ?? 100, e.currency)})`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        {(mode === "pay_per_view" || options.pay_per_view.reason?.includes("paid event")) && (data?.activePaidEvents?.length || 0) === 0 ? (
          <div style={{ marginTop: 8, fontSize: 12, color: "#94a3b8" }}>
            Create a paid event for this channel on the{" "}
            <a href="/settings/monetization" style={{ color: "#a5b4fc" }}>
              Monetization page
            </a>
            .
          </div>
        ) : null}

        {mode === "private" ? (
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 12, color: "#cbd5e1" }}>
              Allowed viewer emails (one per line; viewers sign in with a verified email)
              <textarea
                value={allowEmails}
                onChange={(e) => setAllowEmails(e.target.value)}
                rows={3}
                style={{ display: "block", marginTop: 4, width: "100%", padding: "6px 8px", borderRadius: 6, background: "#0f172a", color: "#e5e7eb", border: "1px solid rgba(255,255,255,0.12)", fontFamily: "monospace", fontSize: 12 }}
              />
            </label>
          </div>
        ) : null}

        {effective !== stored ? (
          <div style={{ marginTop: 10, fontSize: 12, color: "#fbbf24" }}>
            Currently enforced: <b>{MODE_COPY[effective].label}</b>
            {effective === "pay_per_view" ? " (an active paid event keeps this channel ticketed until the event ends)." : "."}
          </div>
        ) : null}
        {data?.live && !data.liveProtected && mode !== "public" ? (
          <div style={{ marginTop: 8, fontSize: 12, color: "#94a3b8" }}>
            You're live right now: new viewers are checked immediately; restart the stream to also retire links viewers already opened.
          </div>
        ) : null}

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving || !options[mode].available}
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              border: "none",
              background: dirty ? "linear-gradient(135deg,#6366f1,#4f46e5)" : "rgba(75,85,99,0.5)",
              color: "#f9fafb",
              fontSize: 12,
              fontWeight: 600,
              cursor: dirty && !saving ? "pointer" : "not-allowed",
            }}
          >
            {saving ? "Saving…" : "Save access"}
          </button>
          {msg ? <span style={{ fontSize: 12, color: msg.kind === "ok" ? "#22c55e" : "#f87171" }}>{msg.text}</span> : null}
          {!planPayPerView && platformMonetizationEnabled ? (
            <button
              type="button"
              onClick={() => (onUpgrade ? onUpgrade() : (window.location.href = "/settings/billing"))}
              style={{ marginLeft: "auto", padding: "6px 12px", borderRadius: 999, border: "1px solid rgba(99,102,241,0.5)", background: "transparent", color: "#c7d2fe", fontSize: 12, cursor: "pointer" }}
            >
              Upgrade for pay-per-view
            </button>
          ) : null}
        </div>
      </div>

      {planMonetization && platformMonetizationEnabled ? (
        <div style={box} data-testid="earnings-card">
          <div style={{ fontSize: 13, fontWeight: 700, color: "#e5e7eb", marginBottom: 6 }}>💰 Earnings</div>
          {!earnings || earnings.totals.length === 0 ? (
            <div style={{ fontSize: 12, color: "#94a3b8" }}>No sales yet.</div>
          ) : (
            earnings.totals.map((t) => (
              <div key={t.currency} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8, marginBottom: 6 }}>
                <Stat label="Gross" value={formatPrice(t.grossCents, t.currency)} />
                <Stat label={`Platform fee (${(earnings.platformFeeBps / 100).toFixed(earnings.platformFeeBps % 100 ? 1 : 0)}%)`} value={formatPrice(t.platformFeeCents, t.currency)} />
                <Stat label="Your earnings" value={formatPrice(t.netCents, t.currency)} strong />
                <Stat label="Sales / refunds" value={`${t.paidCount} / ${t.refundedCount + t.disputedCount}`} />
              </div>
            ))
          )}
          <div style={{ marginTop: 6, fontSize: 11, color: "#64748b" }}>
            Payouts coming soon — earnings are recorded now and will be paid out once creator payouts launch.
          </div>
        </div>
      ) : null}
    </>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ padding: "6px 8px", borderRadius: 8, background: "rgba(255,255,255,0.03)" }}>
      <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 14, color: strong ? "#22c55e" : "#e5e7eb", fontWeight: strong ? 700 : 600 }}>{value}</div>
    </div>
  );
}
