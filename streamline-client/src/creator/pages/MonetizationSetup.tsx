/**
 * Monetization Setup — Host-facing page for creating/editing monetized events
 *
 * Lives under HLS Settings as "Monetization" (/settings/monetization).
 */
import React, { useEffect, useState, useCallback } from "react";
import { apiFetchAuth, apiFetch } from "../../lib/api";
import { useEffectiveEntitlements } from "../../hooks/useEffectiveEntitlements";
import { useFeatureAccess } from "../../hooks/useFeatureAccess";

type MonetizationMode = "off" | "fixed" | "pwyw" | "donation";

interface MonetizedEvent {
  id: string;
  roomId: string;
  name: string;
  startsAt: string | null;
  monetizationMode: MonetizationMode;
  currency: string;
  fixedAmountCents: number | null;
  pwywMinCents: number | null;
  donationPresetsCents: number[];
  allowCustomDonation: boolean;
  singlePersonOnly: boolean;
  status: string;
  /** scheduled (presale, room unchanged) | live (started, paywalls room) | ended */
  effectiveStatus?: "scheduled" | "live" | "ended";
  checkoutOpen?: boolean;
  /** A ticket was sold: price fields can't change. */
  priceLocked?: boolean;
  broadcast?: {
    live: boolean;
    protected: boolean;
    assignedEventId: string | null;
    servingThisEvent: boolean;
    restartRequired: boolean;
    unassigned: boolean;
  };
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  scheduled: { label: "Scheduled · presale", color: "#a5b4fc" },
  live: { label: "Started", color: "#4ade80" },
  ended: { label: "Ended", color: "#9ca3af" },
};

const LIFECYCLE_ERRORS: Record<string, string> = {
  another_event_live: "Another event is already started on this room. End it first.",
  broadcast_public_restart_required:
    "This room is streaming publicly right now. Stop the stream, start the event, then go live again so the stream is protected.",
  invalid_transition: "An ended event can't be started again. Create a new event instead.",
  price_locked: "Tickets have already been sold, so the price can't change.",
  event_ended: "This event has ended and can't be edited.",
  end_event_first: "End this event and create a paid one instead.",
  not_owner: "Only the event owner can do that.",
  monetization_not_entitled: "Monetization isn't included in your plan.",
  payPerView_not_entitled: "Pay-per-view isn't included in your plan.",
  hls_not_entitled: "HLS isn't included in your plan.",
};

function lifecycleError(body: unknown, fallback: string): string {
  const b = (body && typeof body === "object" ? body : {}) as { error?: unknown; reason?: unknown; liveEventName?: unknown };
  const code = typeof b.error === "string" ? b.error : "";
  if (code === "another_event_live" && typeof b.liveEventName === "string") {
    return `"${b.liveEventName}" is already started on this room. End it first.`;
  }
  return LIFECYCLE_ERRORS[code] || (typeof b.reason === "string" && b.reason) || fallback;
}

const MODE_LABELS: Record<MonetizationMode, string> = {
  off: "Off",
  fixed: "Fixed Price PPV",
  pwyw: "Pay What You Want",
  donation: "Free + Donations",
};

export default function MonetizationSetup() {
  // ── Entitlement checks ───────────────────────────────────────────
  const { effectiveEntitlements } = useEffectiveEntitlements();
  const { access } = useFeatureAccess(effectiveEntitlements);
  const canMonetization = !!access?.monetization?.allowed;
  const canPayPerView = !!access?.payPerView?.allowed;
  const ppvPlatformEnabled = !!access?.payPerView?.platformEnabled;
  const ppvPlanIncluded = !!access?.payPerView?.planIncluded;

  // ── State ────────────────────────────────────────────────────────
  const [events, setEvents] = useState<MonetizedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // HLS room picker
  const [hlsRooms, setHlsRooms] = useState<{ id: string; name: string }[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);

  // Form
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState("");
  const [name, setName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [mode, setMode] = useState<MonetizationMode>("off");
  const [fixedAmountDollars, setFixedAmountDollars] = useState("10.00");
  const [pwywMinDollars, setPwywMinDollars] = useState("1.00");
  const [donationPresets, setDonationPresets] = useState("5,10,20");
  const [allowCustomDonation, setAllowCustomDonation] = useState(true);
  const [singlePersonOnly, setSinglePersonOnly] = useState(true);

  const [busyEventId, setBusyEventId] = useState<string | null>(null);
  const [priceLocked, setPriceLocked] = useState(false);
  const [payoutNote, setPayoutNote] = useState<string | null>(null);

  // Share link
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ── Load existing events ─────────────────────────────────────────
  const loadEvents = useCallback(async () => {
    try {
      const res = await apiFetchAuth("/api/monetization/events");
      const data = await res.json();
      setEvents(data.events || []);
    } catch (err: any) {
      console.error("Failed to load events:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Load HLS-enabled rooms ──────────────────────────────────────
  const loadHlsRooms = useCallback(async () => {
    try {
      const res = await apiFetchAuth("/api/monetization/hls-rooms");
      const data = await res.json();
      setHlsRooms(data.rooms || []);
    } catch (err: any) {
      console.error("Failed to load HLS rooms:", err);
    } finally {
      setRoomsLoading(false);
    }
  }, []);

  // How/when creators get paid (shown before they sell tickets).
  const loadPayoutNote = useCallback(async () => {
    try {
      const res = await apiFetchAuth("/api/monetization/earnings", {}, { allowNonOk: true });
      const data = await res.json().catch(() => null);
      const msg = data?.payouts?.message;
      setPayoutNote(typeof msg === "string" && msg.trim() ? msg.trim() : null);
    } catch {
      setPayoutNote(null);
    }
  }, []);

  useEffect(() => {
    if (canMonetization) {
      loadEvents();
      loadHlsRooms();
      void loadPayoutNote();
    } else {
      setLoading(false);
      setRoomsLoading(false);
    }
  }, [canMonetization, loadEvents, loadHlsRooms, loadPayoutNote]);

  // ── Populate form for editing ────────────────────────────────────
  function editEvent(ev: MonetizedEvent) {
    setEditingEventId(ev.id);
    setRoomId(ev.roomId);
    setName(ev.name);
    setStartsAt(ev.startsAt || "");
    setMode(ev.monetizationMode);
    setFixedAmountDollars(ev.fixedAmountCents ? (ev.fixedAmountCents / 100).toFixed(2) : "10.00");
    setPwywMinDollars(ev.pwywMinCents != null ? (ev.pwywMinCents / 100).toFixed(2) : "1.00");
    setDonationPresets(ev.donationPresetsCents.map((c) => (c / 100).toString()).join(","));
    setAllowCustomDonation(ev.allowCustomDonation);
    setSinglePersonOnly(ev.singlePersonOnly);
    setPriceLocked(!!ev.priceLocked);
    setShareLink(`${window.location.origin}/ppv/${ev.id}`);
    setSuccess(null);
    setError(null);
  }

  function resetForm() {
    setEditingEventId(null);
    setRoomId("");
    setName("");
    setStartsAt("");
    setMode("off");
    setFixedAmountDollars("10.00");
    setPwywMinDollars("1.00");
    setDonationPresets("5,10,20");
    setAllowCustomDonation(true);
    setSinglePersonOnly(true);
    setPriceLocked(false);
    setShareLink(null);
    setSuccess(null);
    setError(null);
  }

  // ── Save ─────────────────────────────────────────────────────────
  async function handleSave() {
    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const fixedAmountCents = Math.round(parseFloat(fixedAmountDollars || "0") * 100);
      const pwywMinCents = Math.round(parseFloat(pwywMinDollars || "0") * 100);
      const presetsCents = donationPresets
        .split(",")
        .map((s) => Math.round(parseFloat(s.trim()) * 100))
        .filter((n) => n > 0);

      const body: Record<string, any> = {
        monetizationMode: mode,
        name,
        roomId,
        startsAt: startsAt || null,
        allowCustomDonation,
        singlePersonOnly,
        donationPresetsCents: presetsCents.length > 0 ? presetsCents : [500, 1000, 2000],
        // Status is never sent: saving preserves it (Start / End buttons change it).
      };

      if (editingEventId) body.eventId = editingEventId;
      if (mode === "fixed") body.fixedAmountCents = fixedAmountCents;
      if (mode === "pwyw") body.pwywMinCents = pwywMinCents;

      const res = await apiFetchAuth(
        "/api/monetization/events",
        { method: "POST", body: JSON.stringify(body) },
        { allowNonOk: true }
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(lifecycleError(data, data?.reason || data?.error || "Save failed"));
        return;
      }

      const savedEvent = data.event;
      const link = `${window.location.origin}/ppv/${savedEvent.id}`;
      setShareLink(link);
      setEditingEventId(savedEvent.id);
      setSuccess(editingEventId ? "Event saved." : "Event scheduled. Tickets are on presale; press Start when the show begins.");
      await loadEvents();
    } catch (err: any) {
      setError(err?.body?.error || err?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(ev: MonetizedEvent, action: "start" | "end") {
    if (
      action === "end" &&
      !window.confirm(
        `End "${ev.name}"? Ticket sales close and ticket holders can no longer watch this event live. Tickets and payments are kept. This can't be undone.`
      )
    ) {
      return;
    }
    setBusyEventId(ev.id);
    setError(null);
    setSuccess(null);
    try {
      const res = await apiFetchAuth(
        `/api/monetization/events/${encodeURIComponent(ev.id)}/${action}`,
        { method: "POST", body: "{}" },
        { allowNonOk: true }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(lifecycleError(data, action === "start" ? "Couldn't start the event." : "Couldn't end the event."));
        return;
      }
      const b = data.broadcast || {};
      if (action === "start") {
        setSuccess(
          b.restartRequired
            ? "Event started. The stream that's running belongs to another event: stop it and go live again for this event's ticket holders to watch."
            : b.live
              ? "Event started."
              : "Event started. Go live on this room and ticket holders can watch."
        );
      } else {
        setSuccess(
          b.stillLiveForThisEvent
            ? "Event ended. The stream is still running, but this event's ticket holders can no longer watch it. Stop the stream, or start your next event and go live again."
            : "Event ended. Ticket sales are closed."
        );
      }
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Something went wrong.");
    } finally {
      setBusyEventId(null);
      await loadEvents();
    }
  }

  function handleCopyLink() {
    if (!shareLink) return;
    navigator.clipboard.writeText(shareLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // ── Styles ───────────────────────────────────────────────────────
  const card: React.CSSProperties = {
    background: "#1a1a2e",
    borderRadius: 12,
    padding: 24,
    marginBottom: 16,
    border: "1px solid rgba(255,255,255,0.08)",
  };

  const label: React.CSSProperties = {
    display: "block",
    fontSize: 13,
    color: "#aaa",
    marginBottom: 4,
    marginTop: 12,
  };

  const input: React.CSSProperties = {
    width: "100%",
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
    fontSize: 14,
    boxSizing: "border-box",
  };

  const btnPrimary: React.CSSProperties = {
    padding: "10px 20px",
    borderRadius: 8,
    border: "none",
    background: "#6366f1",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  };

  const btnSecondary: React.CSSProperties = {
    ...btnPrimary,
    background: "rgba(255,255,255,0.1)",
    border: "1px solid rgba(255,255,255,0.15)",
  };

  const radioGroup: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginTop: 8,
  };

  // ── Render ───────────────────────────────────────────────────────

  // ── Locked state: monetization not entitled ─────────────────────
  if (!canMonetization) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: 24, color: "#fff" }}>
        <h1 style={{ fontSize: 22, marginBottom: 4 }}>Monetization</h1>
        <div style={{
          background: "#1a1a2e",
          borderRadius: 12,
          padding: 24,
          border: "1px solid rgba(255,255,255,0.08)",
          textAlign: "center",
        }}>
          <p style={{ fontSize: 16, marginBottom: 8 }}>Monetization is not available on your current plan.</p>
          <p style={{ color: "#888", fontSize: 14 }}>
            Upgrade to a plan with monetization to create pay-per-view events.
          </p>
        </div>
      </div>
    );
  }

  if (!canPayPerView) {
    // Platform PPV off → not available messaging (no upgrade option)
    // Plan PPV missing → upgrade prompt
    const isPlanOnly = ppvPlatformEnabled && !ppvPlanIncluded;
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: 24, color: "#fff" }}>
        <h1 style={{ fontSize: 22, marginBottom: 4 }}>Monetization</h1>
        <div style={{
          background: "#1a1a2e",
          borderRadius: 12,
          padding: 24,
          border: "1px solid rgba(255,255,255,0.08)",
          textAlign: "center",
        }}>
          <p style={{ fontSize: 16, marginBottom: 8 }}>
            {isPlanOnly ? "Pay-per-view is not included in your current plan." : "Pay-per-view is not currently available."}
          </p>
          <p style={{ color: "#888", fontSize: 14 }}>
            {isPlanOnly
              ? "Upgrade your plan to create pay-per-view events."
              : "Pay-per-view is not enabled on this platform."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 24, color: "#fff" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Monetization</h1>
      <p style={{ color: "#888", fontSize: 14, marginBottom: 16 }}>
        Set up pay-per-view, pay-what-you-want, or donation-based access for your HLS events.
      </p>

      <div style={{ ...card, borderColor: "rgba(250,204,21,0.35)", padding: 16 }} data-testid="payout-note">
        <h3 style={{ fontSize: 14, margin: "0 0 6px" }}>How you get paid</h3>
        <p style={{ color: "#ccc", fontSize: 13, margin: 0 }}>
          {payoutNote || "Ticket revenue is collected by StreamLine. Payout details will be shared before payouts begin."}
        </p>
      </div>

      <div style={{ ...card, padding: 16 }}>
        <h3 style={{ fontSize: 14, margin: "0 0 6px" }}>How events work</h3>
        <p style={{ color: "#aaa", fontSize: 13, margin: 0 }}>
          New events are <b>scheduled</b>: tickets go on presale and your room stays as it is. Press <b>Start</b> when the
          show begins, then go live. Only one event can be started per room. <b>End event</b> closes ticket sales; tickets
          for one event never unlock another.
        </p>
      </div>

      {/* ── Form ──────────────────────────────────────────────────── */}
      <div style={card}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>
          {editingEventId ? "Edit Event" : "Create Monetized Event"}
        </h2>

        <label style={label}>HLS Room</label>
        {roomsLoading ? (
          <p style={{ color: "#888", fontSize: 13 }}>Loading rooms…</p>
        ) : hlsRooms.length === 0 ? (
          <p style={{ color: "#ef4444", fontSize: 13 }}>
            No HLS-enabled rooms found. Create a room with HLS enabled first.
          </p>
        ) : (
          <select
            style={{ ...input, appearance: "auto" as any }}
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
          >
            <option value="">Select an HLS room…</option>
            {hlsRooms.map((r) => (
              <option key={r.id} value={r.id}>{r.name || r.id}</option>
            ))}
          </select>
        )}

        <label style={label}>Event Name</label>
        <input
          style={input}
          placeholder="My Live Event"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <label style={label}>Start Date/Time (optional)</label>
        <input
          style={input}
          type="datetime-local"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
        />

        <label style={label}>Monetization Mode</label>
        {priceLocked && (
          <p data-testid="price-locked-note" style={{ color: "#fbbf24", fontSize: 12, margin: "4px 0" }}>
            Tickets have been sold, so the price and mode can't change.
          </p>
        )}
        <div style={radioGroup}>
          {(Object.keys(MODE_LABELS) as MonetizationMode[]).map((m) => (
            <label key={m} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="radio"
                name="monetizationMode"
                checked={mode === m}
                disabled={priceLocked}
                onChange={() => setMode(m)}
              />
              <span style={{ fontSize: 14 }}>{MODE_LABELS[m]}</span>
            </label>
          ))}
        </div>

        {/* Mode-specific fields */}
        {mode === "fixed" && (
          <>
            <label style={label}>Fixed Price (USD)</label>
            <input
              style={input}
              type="number"
              min="1"
              step="0.01"
              value={fixedAmountDollars}
              disabled={priceLocked}
              onChange={(e) => setFixedAmountDollars(e.target.value)}
            />
          </>
        )}

        {mode === "pwyw" && (
          <>
            <label style={label}>Minimum Price (USD)</label>
            <input
              style={input}
              type="number"
              min="0"
              step="0.01"
              value={pwywMinDollars}
              disabled={priceLocked}
              onChange={(e) => setPwywMinDollars(e.target.value)}
            />
          </>
        )}

        {(mode === "donation" || mode === "pwyw") && (
          <>
            <label style={label}>Donation/Tip Presets (comma-separated USD amounts)</label>
            <input
              style={input}
              placeholder="5,10,20"
              value={donationPresets}
              onChange={(e) => setDonationPresets(e.target.value)}
            />
            <label style={{ ...label, display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
              <input
                type="checkbox"
                checked={allowCustomDonation}
                onChange={(e) => setAllowCustomDonation(e.target.checked)}
              />
              Allow custom donation amount
            </label>
          </>
        )}

        {(mode === "fixed" || mode === "pwyw") && (
          <label style={{ ...label, display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
            <input
              type="checkbox"
              checked={singlePersonOnly}
              onChange={(e) => setSinglePersonOnly(e.target.checked)}
            />
            Single-use access code (one viewer per purchase)
          </label>
        )}

        <div style={{ marginTop: 20, display: "flex", gap: 12 }}>
          <button style={btnPrimary} onClick={handleSave} disabled={saving || !roomId || !name || mode === "off"}>
            {saving ? "Saving…" : editingEventId ? "Update Event" : "Create Event"}
          </button>
          {editingEventId && (
            <button style={btnSecondary} onClick={resetForm}>
              New Event
            </button>
          )}
        </div>

        {error && (
          <p style={{ color: "#ef4444", fontSize: 13, marginTop: 12 }}>{error}</p>
        )}
        {success && (
          <p style={{ color: "#22c55e", fontSize: 13, marginTop: 12 }}>{success}</p>
        )}
      </div>

      {/* ── Share link ────────────────────────────────────────────── */}
      {shareLink && (
        <div style={{ ...card, borderColor: "#6366f1" }}>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>Share Link</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              style={{ ...input, flex: 1 }}
              readOnly
              value={shareLink}
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button style={btnSecondary} onClick={handleCopyLink}>
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <button
            style={{ ...btnSecondary, marginTop: 12 }}
            onClick={() => window.open(shareLink, "_blank")}
          >
            Open Viewer Page ↗
          </button>
        </div>
      )}

      {/* ── Existing events list ──────────────────────────────────── */}
      {!loading && events.length > 0 && (
        <div style={card}>
          <h3 style={{ fontSize: 14, marginBottom: 12 }}>Your Events</h3>
          {events.map((ev) => (
            <div
              key={ev.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 0",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  {ev.name}{" "}
                  {ev.effectiveStatus && STATUS_LABELS[ev.effectiveStatus] && (
                    <span
                      data-testid={`event-status-${ev.id}`}
                      style={{ fontSize: 11, marginLeft: 6, color: STATUS_LABELS[ev.effectiveStatus].color }}
                    >
                      ● {STATUS_LABELS[ev.effectiveStatus].label}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "#888" }}>
                  {MODE_LABELS[ev.monetizationMode]} · Room: {ev.roomId}
                  {ev.broadcast?.servingThisEvent ? " · On air" : ""}
                </div>
                {ev.broadcast?.unassigned && (
                  <div style={{ fontSize: 12, color: "#fbbf24", marginTop: 4 }}>
                    ⚠ The stream on this room isn't linked to an event, so ticket holders can't watch it. Stop the stream and go live again.
                  </div>
                )}
                {!ev.broadcast?.unassigned && ev.broadcast?.restartRequired && (
                  <div style={{ fontSize: 12, color: "#fbbf24", marginTop: 4 }}>
                    {ev.broadcast.protected
                      ? "⚠ The running stream belongs to another event. Stop it and go live again for this event."
                      : "⚠ This room is streaming publicly. Stop the stream and go live again so it's protected."}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                {ev.effectiveStatus === "scheduled" && (
                  <button
                    style={btnSecondary}
                    disabled={busyEventId === ev.id}
                    onClick={() => void changeStatus(ev, "start")}
                  >
                    Start
                  </button>
                )}
                {ev.effectiveStatus && ev.effectiveStatus !== "ended" && (
                  <button
                    style={{ ...btnSecondary, borderColor: "rgba(220,38,38,0.5)", color: "#fca5a5" }}
                    disabled={busyEventId === ev.id}
                    onClick={() => void changeStatus(ev, "end")}
                  >
                    End event
                  </button>
                )}
                {ev.effectiveStatus !== "ended" && (
                  <button style={btnSecondary} onClick={() => editEvent(ev)}>
                    Edit
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {loading && <p style={{ color: "#888" }}>Loading…</p>}
    </div>
  );
}
