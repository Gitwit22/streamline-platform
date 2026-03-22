/**
 * Room Monetization Setup — per-room monetization/PPV toggles inside HLS settings.
 *
 * Embedded in the HLS section of SettingsBilling. Reads room-level
 * monetization state from the hls-config endpoint and persists back via PUT.
 */
import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "../../../lib/apiBase";
import { apiFetchAuth } from "../../../lib/api";

export interface RoomMonetizationSetupProps {
  /** Currently selected room/embed roomId (from SettingsHlsSetup). */
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

export default function RoomMonetizationSetup({
  roomId,
  hlsEnabled,
  platformMonetizationEnabled,
  platformPayPerViewEnabled,
  planMonetization,
  planPayPerView,
  onUpgrade,
}: RoomMonetizationSetupProps) {
  const [monetizationOn, setMonetizationOn] = useState(false);
  const [ppvOn, setPpvOn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Derive whether each toggle should be interactive.
  const canToggleMonetization =
    hlsEnabled && platformMonetizationEnabled && planMonetization;
  const canTogglePpv =
    hlsEnabled && platformPayPerViewEnabled && planPayPerView && monetizationOn;

  // Load room monetization state when roomId changes.
  const load = useCallback(async () => {
    if (!roomId) { setLoaded(false); return; }
    try {
      const res = await apiFetchAuth(
        `${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/hls-config`,
        { cache: "no-store" },
        { allowNonOk: true },
      );
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        setMonetizationOn(data.monetizationEnabled === true);
        setPpvOn(data.payPerViewEnabled === true);
      }
    } catch {
      // non-fatal
    } finally {
      setLoaded(true);
    }
  }, [roomId]);

  useEffect(() => { load(); }, [load]);

  // Persist a toggle change back to the server.
  const persist = async (nextMon: boolean, nextPpv: boolean) => {
    if (!roomId) return;
    setSaving(true);
    try {
      const res = await apiFetchAuth(
        `${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/hls-config`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // Send current HLS enabled state (we're not changing it here).
            enabled: hlsEnabled,
            monetizationEnabled: nextMon,
            payPerViewEnabled: nextPpv,
          }),
        },
        { allowNonOk: true },
      );
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        setMonetizationOn(data.monetizationEnabled === true);
        setPpvOn(data.payPerViewEnabled === true);
      }
    } catch {
      // revert on failure
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleMonetizationToggle = () => {
    if (!canToggleMonetization || saving) return;
    const next = !monetizationOn;
    // If disabling monetization, also disable PPV.
    const nextPpv = next ? ppvOn : false;
    setMonetizationOn(next);
    if (!next) setPpvOn(false);
    persist(next, nextPpv);
  };

  const handlePpvToggle = () => {
    if (!canTogglePpv || saving) return;
    const next = !ppvOn;
    setPpvOn(next);
    persist(monetizationOn, next);
  };

  // Helper text explaining why a toggle is locked.
  function lockReason(
    label: string,
    platform: boolean,
    plan: boolean,
    extra?: boolean,
  ): string | null {
    if (!hlsEnabled) return `${label} requires HLS to be enabled on this room.`;
    if (!platform) return `${label} is currently disabled platform-wide.`;
    if (!plan)
      return `${label} is not included in your plan.`;
    if (extra === false) return `Enable monetization first.`;
    return null;
  }

  const monLock = lockReason(
    "Monetization",
    platformMonetizationEnabled,
    planMonetization,
  );
  const ppvLock = lockReason(
    "Pay-per-view",
    platformPayPerViewEnabled,
    planPayPerView,
    monetizationOn,
  );

  if (!roomId) return null;
  if (!loaded) return null;

  const toggleRow: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "8px 0",
  };

  const toggleTrack = (on: boolean, disabled: boolean): React.CSSProperties => ({
    width: 40,
    height: 22,
    borderRadius: 11,
    background: disabled
      ? "rgba(75,85,99,0.35)"
      : on
        ? "#6366f1"
        : "rgba(75,85,99,0.55)",
    cursor: disabled ? "not-allowed" : "pointer",
    position: "relative",
    transition: "background 0.2s",
    flexShrink: 0,
    opacity: disabled ? 0.5 : 1,
  });

  const toggleThumb = (on: boolean): React.CSSProperties => ({
    width: 16,
    height: 16,
    borderRadius: "50%",
    background: "#fff",
    position: "absolute",
    top: 3,
    left: on ? 21 : 3,
    transition: "left 0.2s",
  });

  const helperStyle: React.CSSProperties = {
    fontSize: 11,
    color: "#f59e0b",
    marginTop: 2,
  };

  return (
    <div style={{
      marginTop: 16,
      padding: "12px 14px",
      borderRadius: 10,
      border: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(15,23,42,0.5)",
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#e5e7eb", marginBottom: 8 }}>
        💰 Monetization
      </div>

      {/* Monetization toggle */}
      <div style={toggleRow}>
        <div>
          <div style={{ fontSize: 13, color: "#cbd5e1" }}>Enable monetization for this room</div>
          {monLock && <div style={helperStyle}>{monLock}</div>}
        </div>
        <div
          style={toggleTrack(monetizationOn, !canToggleMonetization)}
          onClick={handleMonetizationToggle}
          role="switch"
          aria-checked={monetizationOn}
        >
          <div style={toggleThumb(monetizationOn)} />
        </div>
      </div>

      {/* PPV toggle */}
      <div style={toggleRow}>
        <div>
          <div style={{ fontSize: 13, color: "#cbd5e1" }}>Enable pay-per-view for this room</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 1 }}>
            Pay-per-view requires HLS and an eligible plan
          </div>
          {ppvLock && <div style={helperStyle}>{ppvLock}</div>}
        </div>
        <div
          style={toggleTrack(ppvOn, !canTogglePpv)}
          onClick={handlePpvToggle}
          role="switch"
          aria-checked={ppvOn}
        >
          <div style={toggleThumb(ppvOn)} />
        </div>
      </div>

      {/* Upgrade nudge */}
      {(!planMonetization || !planPayPerView) && (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={() => (onUpgrade ? onUpgrade() : (window.location.href = "/settings/billing"))}
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              border: "none",
              background: "linear-gradient(135deg,#6366f1,#4f46e5)",
              color: "#f9fafb",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Upgrade Plan
          </button>
        </div>
      )}
    </div>
  );
}
