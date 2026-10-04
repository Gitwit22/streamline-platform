import { useEffect, useState } from "react";
import { apiGetRoomPolicy, apiUpdateRoomPolicy } from "../../lib/api";
import {
  ROOM_ACCESS_HLS_NOTE,
  ROOM_ACCESS_OPTIONS,
  normalizeRoomAccess,
  roomAccessLabel,
  type RoomAccessMode,
} from "../../lib/roomAccess";

/**
 * Host dashboard control for the production room's access mode
 * (Invite Only / Anyone With Link / Public). Hosts and co-hosts/producers
 * with moderation rights can change it; others see it read-only.
 */
export default function RoomAccessControl({
  roomId,
  roomAccessToken,
  value,
  canEdit,
  onChange,
}: {
  roomId: string;
  roomAccessToken: string;
  /** Known access mode (e.g. from the /token response). Fetched when missing. */
  value?: RoomAccessMode | null;
  canEdit: boolean;
  onChange?: (mode: RoomAccessMode) => void;
}) {
  // Local value after a change here or a fetch; the prop wins when it changes.
  const [local, setLocal] = useState<{ mode: RoomAccessMode; forValue: RoomAccessMode | null } | null>(null);
  const [saving, setSaving] = useState<RoomAccessMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current: RoomAccessMode | null =
    local && local.forValue === (value ?? null) ? local.mode : (value ?? null);

  useEffect(() => {
    if (value || !roomId || !roomAccessToken) return;
    let cancelled = false;
    apiGetRoomPolicy(roomId, roomAccessToken)
      .then((p) => {
        if (!cancelled && p?.ok) setLocal({ mode: normalizeRoomAccess(p.access), forValue: null });
      })
      .catch(() => {
        // Keep "unknown"; the control still works.
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, roomAccessToken, value]);

  const choose = async (mode: RoomAccessMode) => {
    if (!canEdit || saving || mode === current) return;
    setSaving(mode);
    setError(null);
    try {
      const res = await apiUpdateRoomPolicy(roomId, roomAccessToken, { access: mode });
      const next = normalizeRoomAccess(res?.access ?? mode);
      setLocal({ mode: next, forValue: value ?? null });
      onChange?.(next);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      setError(msg ? `Couldn't change access: ${msg}` : "Couldn't change access");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div
      data-testid="room-access-control"
      style={{
        border: "1px solid rgba(148,163,184,0.25)",
        borderRadius: "0.5rem",
        padding: "0.6rem 0.75rem",
        background: "rgba(15,23,42,0.6)",
        display: "flex",
        flexDirection: "column",
        gap: "0.4rem",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: "0.8rem", color: "#e5e7eb" }}>Studio access</span>
        <span style={{ fontSize: "0.75rem", color: "#93c5fd" }}>{current ? roomAccessLabel(current) : "…"}</span>
      </div>
      <div role="radiogroup" aria-label="Studio access" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {ROOM_ACCESS_OPTIONS.map((opt) => {
          const selected = current === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              title={opt.description}
              disabled={!canEdit || !!saving}
              onClick={() => choose(opt.value)}
              style={{
                padding: "4px 9px",
                borderRadius: 999,
                fontSize: "0.72rem",
                fontWeight: 600,
                border: `1px solid ${selected ? "rgba(59,130,246,0.7)" : "rgba(75,85,99,0.8)"}`,
                background: selected ? "rgba(59,130,246,0.18)" : "transparent",
                color: selected ? "#bfdbfe" : "#cbd5e1",
                cursor: canEdit && !saving ? "pointer" : "default",
                opacity: !canEdit && !selected ? 0.55 : 1,
              }}
            >
              {saving === opt.value ? "Saving…" : opt.label}
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>
        {current ? ROOM_ACCESS_OPTIONS.find((o) => o.value === current)?.description : null} {ROOM_ACCESS_HLS_NOTE}
      </div>
      {!canEdit && (
        <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>Only the host (or a co-host who can moderate) can change this.</div>
      )}
      {error && <div style={{ fontSize: "0.72rem", color: "#fca5a5" }}>{error}</div>}
    </div>
  );
}
