import React from "react";
import { apiAdmitAllWaiting, apiDecideWaiting, apiGetWaitingRoom, apiUpdateRoomPolicy } from "../../lib/api";
import { WAITING_ROOM_LIST_POLL_MS, normalizeWaitingRoomList, type WaitingRoomEntry } from "../../lib/waitingRoom";

/**
 * Host Dashboard section: turn the waiting room on/off and let people in.
 * The server enforces everything (who waits, who may admit); this only shows
 * its state. Refreshes the queue while the Dashboard is open.
 */
export default function WaitingRoomPanel({ roomId, roomAccessToken }: { roomId: string; roomAccessToken: string }) {
  const [enabled, setEnabled] = React.useState<boolean | null>(null);
  const [entries, setEntries] = React.useState<WaitingRoomEntry[]>([]);
  const [toggleBusy, setToggleBusy] = React.useState(false);
  const [busyIds, setBusyIds] = React.useState<Record<string, boolean>>({});
  const [admitAllBusy, setAdmitAllBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    if (!roomId || !roomAccessToken) return;
    try {
      const list = normalizeWaitingRoomList(await apiGetWaitingRoom(roomId, roomAccessToken));
      setEnabled(list.enabled);
      setEntries(list.entries);
    } catch {
      // Keep what we showed last; the next poll tries again.
    }
  }, [roomId, roomAccessToken]);

  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      await refresh();
      if (!cancelled) timer = setTimeout(tick, WAITING_ROOM_LIST_POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [refresh]);

  const toggle = async () => {
    if (enabled === null) return;
    setToggleBusy(true);
    setError(null);
    try {
      const res = await apiUpdateRoomPolicy(roomId, roomAccessToken, { waitingRoomEnabled: !enabled });
      setEnabled(res.waitingRoomEnabled === true);
    } catch {
      setError("Couldn't change the waiting room. Try again.");
    } finally {
      setToggleBusy(false);
    }
  };

  const decide = async (id: string, decision: "admit" | "deny") => {
    setBusyIds((prev) => ({ ...prev, [id]: true }));
    setError(null);
    try {
      await apiDecideWaiting(roomId, roomAccessToken, id, decision);
      // They leave the list right away; the next poll confirms.
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch {
      setError(decision === "admit" ? "Couldn't let them in. Try again." : "Couldn't deny them. Try again.");
    } finally {
      setBusyIds((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const admitAll = async () => {
    setAdmitAllBusy(true);
    setError(null);
    try {
      await apiAdmitAllWaiting(roomId, roomAccessToken);
      setEntries([]);
    } catch {
      setError("Couldn't let everyone in. Try again.");
    } finally {
      setAdmitAllBusy(false);
    }
  };

  const on = enabled === true;
  return (
    <div data-testid="waiting-room-panel">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.75rem", color: "rgba(248, 250, 252, 0.75)", lineHeight: 1.4 }}>
          {on ? "People wait until you let them in." : "People join as soon as they open the link."}
        </span>
        <button
          type="button"
          onClick={toggle}
          disabled={toggleBusy || enabled === null}
          aria-pressed={on}
          data-testid="waiting-room-toggle"
          style={{
            flexShrink: 0,
            borderRadius: "9999px",
            border: on ? "1px solid rgba(34, 197, 94, 0.9)" : "1px solid rgba(148, 163, 184, 0.7)",
            padding: "0.25rem 0.75rem",
            fontSize: "0.7rem",
            background: on ? "rgba(34, 197, 94, 0.18)" : "rgba(31, 41, 55, 0.5)",
            color: on ? "#bbf7d0" : "#e5e7eb",
            cursor: toggleBusy || enabled === null ? "not-allowed" : "pointer",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: "0.25rem",
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 9999, background: on ? "#22c55e" : "#9ca3af" }} />
          {enabled === null ? "Waiting Room…" : on ? "Waiting Room On" : "Waiting Room Off"}
        </button>
      </div>

      {entries.length > 0 && (
        <div style={{ marginTop: "0.6rem" }} data-testid="waiting-room-list">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.35rem" }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#f8fafc" }}>Waiting ({entries.length})</span>
            {entries.length > 1 && (
              <button
                type="button"
                onClick={admitAll}
                disabled={admitAllBusy}
                data-testid="waiting-room-admit-all"
                style={smallButton(true, admitAllBusy)}
              >
                {admitAllBusy ? "Letting in…" : "Admit all"}
              </button>
            )}
          </div>
          {entries.map((e) => (
            <div
              key={e.id}
              data-testid="waiting-room-entry"
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", padding: "0.3rem 0" }}
            >
              <span style={{ fontSize: "0.8rem", color: "#f8fafc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {e.displayName}
              </span>
              <span style={{ display: "flex", gap: "0.35rem", flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => decide(e.id, "admit")}
                  disabled={!!busyIds[e.id]}
                  aria-label={`Admit ${e.displayName}`}
                  style={smallButton(true, !!busyIds[e.id])}
                >
                  Admit
                </button>
                <button
                  type="button"
                  onClick={() => decide(e.id, "deny")}
                  disabled={!!busyIds[e.id]}
                  aria-label={`Deny ${e.displayName}`}
                  style={smallButton(false, !!busyIds[e.id])}
                >
                  Deny
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {on && entries.length === 0 && (
        <p style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "rgba(248, 250, 252, 0.6)" }}>Nobody is waiting.</p>
      )}
      {error && (
        <p role="alert" style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#fca5a5" }}>
          {error}
        </p>
      )}
    </div>
  );
}

function smallButton(primary: boolean, busy: boolean): React.CSSProperties {
  return {
    borderRadius: "0.375rem",
    border: primary ? "1px solid rgba(34, 197, 94, 0.7)" : "1px solid rgba(148, 163, 184, 0.6)",
    padding: "0.2rem 0.55rem",
    fontSize: "0.72rem",
    fontWeight: 600,
    background: primary ? "rgba(34, 197, 94, 0.2)" : "rgba(31, 41, 55, 0.6)",
    color: primary ? "#bbf7d0" : "#e5e7eb",
    cursor: busy ? "not-allowed" : "pointer",
    opacity: busy ? 0.6 : 1,
  };
}
