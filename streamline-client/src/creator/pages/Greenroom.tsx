import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../../lib/api";
import RoomBrandingLayer, { type PublicRoomCustomization } from "../components/RoomBrandingLayer";

/**
 * Greenroom — Guest waiting room for Phase 3 greenroom staging.
 *
 * Route: /greenroom/:roomId
 *
 * Guests land here when:
 *   - The room has a greenroom policy with mode !== "off"
 *   - The room lifecycle state is "greenroom"
 *
 * This page polls /api/rooms/:roomId/info every 5 seconds.
 * When the lifecycle state exits "greenroom" (e.g., the host admits guests
 * or advances the lifecycle), guests are redirected to the room.
 *
 * If the greenroom state cannot be confirmed, we fall back to /invite
 * or /join to preserve the existing prejoin behavior.
 *
 * Admission control is enforced server-side — this page is UI only.
 */

interface RoomInfo {
  roomId: string;
  roomName?: string;
  hostName?: string;
  roomStatus?: string;
  status?: string;
  guestJoinAllowed?: boolean;
  greenroomMode?: string;
  lifecycleState?: string;
}

const POLL_INTERVAL_MS = 5_000;
const STALE_THRESHOLD_MS = 15 * 60 * 1_000; // 15 minutes

export default function Greenroom() {
  const nav = useNavigate();
  const { roomId } = useParams<{ roomId: string }>();

  const [info, setInfo] = useState<RoomInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [isStale, setIsStale] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [customization, setCustomization] = useState<PublicRoomCustomization | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waitingStartRef = useRef<number | null>(null);

  const fetchInfo = useCallback(async (): Promise<RoomInfo | null> => {
    const id = String(roomId || "").trim();
    if (!id) return null;
    try {
      const res = await apiFetch(
        `/api/rooms/${encodeURIComponent(id)}/info`,
        {},
        { allowNonOk: true }
      );
      const ct = res.headers.get("content-type") || "";
      if (!res.ok || !ct.includes("application/json")) return null;
      return (await res.json()) as RoomInfo;
    } catch {
      return null;
    }
  }, [roomId]);

  /**
   * Decide whether the guest should leave the greenroom.
   * Redirects to /room/:roomId when the room is ready for guests.
   * Returns true if a redirect was triggered.
   */
  const maybeRedirect = useCallback(
    (data: RoomInfo | null): boolean => {
      if (!data || !roomId) return false;

      const rs = data.roomStatus || data.status || "";
      const lc = data.lifecycleState || "";

      // Room went live — admit immediately.
      if (rs === "live" || data.guestJoinAllowed === true) {
        nav(`/room/${encodeURIComponent(roomId)}`, { replace: true });
        return true;
      }

      // Room ended — send home.
      if (rs === "ended" || rs === "not_found") {
        nav("/join", { replace: true });
        return true;
      }

      // Lifecycle has moved past "greenroom" — time to join.
      if (lc && lc !== "greenroom" && lc !== "draft" && lc !== "setup") {
        nav(`/room/${encodeURIComponent(roomId)}`, { replace: true });
        return true;
      }

      // Greenroom was disabled — fall back to prejoin flow (the existing join page).
      if (data.greenroomMode === "off" || data.greenroomMode === undefined) {
        nav(`/join`, { replace: true });
        return true;
      }

      return false;
    },
    [roomId, nav]
  );

  // Initial fetch
  useEffect(() => {
    if (!roomId) {
      nav("/join", { replace: true });
      return;
    }

    let cancelled = false;
    (async () => {
      const data = await fetchInfo();
      if (cancelled) return;

      if (!data) {
        // Couldn't reach server — fall back to join
        nav("/join", { replace: true });
        return;
      }

      setInfo(data);
      setLoading(false);
      maybeRedirect(data);

      // Fetch public customization for branding (best-effort, non-blocking).
      apiFetch(
        `/api/rooms/${encodeURIComponent(data.roomId)}/customization/public`,
        {},
        { allowNonOk: true }
      )
        .then(async (r) => {
          if (!r.ok) return;
          const ct = r.headers.get("content-type") || "";
          if (!ct.includes("application/json")) return;
          const json = await r.json();
          if (json?.customization && !cancelled) {
            setCustomization(json.customization as PublicRoomCustomization);
          }
        })
        .catch(() => { /* branding failure is silent */ });
    })();

    return () => {
      cancelled = true;
    };
  }, [roomId, fetchInfo, maybeRedirect, nav]);

  // Poll while in greenroom state
  useEffect(() => {
    if (loading || !info) return;

    // If we already redirected (or should redirect), don't start polling.
    if (maybeRedirect(info)) return;

    if (!waitingStartRef.current) waitingStartRef.current = Date.now();

    pollRef.current = setInterval(async () => {
      const fresh = await fetchInfo();
      if (!fresh) return; // transient error — keep polling

      setInfo(fresh);
      if (maybeRedirect(fresh)) {
        if (pollRef.current) clearInterval(pollRef.current);
        return;
      }

      if (waitingStartRef.current && Date.now() - waitingStartRef.current >= STALE_THRESHOLD_MS) {
        setIsStale(true);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [loading, info, fetchInfo, maybeRedirect]);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={styles.spinner} />
            <style>{spinnerKeyframes}</style>
            <div style={styles.loadingText}>Loading…</div>
          </div>
        </div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <p style={styles.errorText}>{fetchError}</p>
          <button style={styles.btn} onClick={() => nav("/join")}>
            Return home
          </button>
        </div>
      </div>
    );
  }

  // ── Waiting room UI ──────────────────────────────────────────────────────
  const waitingMessage =
    customization?.greenroom?.waitingRoomMessage ||
    (isStale
      ? "The host has not opened the room yet. They may be running late."
      : "The host will admit you shortly. Please stand by.");

  return (
    <RoomBrandingLayer customization={customization}>
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={styles.spinner} />
            <style>{spinnerKeyframes}</style>
            <h1 style={styles.title}>You're in the waiting room</h1>
            <p style={styles.subtitle}>{waitingMessage}</p>
          </div>

          {/* Room info */}
          {info && (info.roomName || info.hostName) && (
            <div style={styles.roomInfo}>
              {info.roomName && (
                <div style={styles.roomName}>{info.roomName}</div>
              )}
              {info.hostName && (
                <div style={styles.hostName}>Hosted by {info.hostName}</div>
              )}
            </div>
          )}

          <div style={styles.hint}>Checking automatically…</div>

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button
              style={{ ...styles.btn, flex: 1 }}
              onClick={async () => {
                setFetchError(null);
                const fresh = await fetchInfo();
                if (fresh) {
                  setInfo(fresh);
                  maybeRedirect(fresh);
                }
              }}
            >
              Refresh
            </button>
            <button
              style={{ ...styles.btn, flex: 1 }}
              onClick={() => nav("/join")}
            >
              Return home
            </button>
          </div>
        </div>
      </div>
    </RoomBrandingLayer>
  );
}

const spinnerKeyframes = `@keyframes sl-greenroom-spin { to { transform: rotate(360deg); } }`;

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    fontFamily: "'Inter', system-ui, sans-serif",
    color: "#fff",
  },
  card: {
    maxWidth: 440,
    width: "100%",
    padding: 32,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.04)",
  },
  spinner: {
    width: 48,
    height: 48,
    margin: "0 auto 20px",
    borderRadius: "50%",
    border: "3px solid rgba(99,102,241,0.3)",
    borderTopColor: "#6366f1",
    animation: "sl-greenroom-spin 1s linear infinite",
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    margin: "0 0 8px",
    lineHeight: 1.3,
  },
  subtitle: {
    fontSize: 14,
    opacity: 0.65,
    lineHeight: 1.6,
    margin: 0,
  },
  roomInfo: {
    padding: "12px 16px",
    borderRadius: 10,
    marginBottom: 12,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
  },
  roomName: {
    fontSize: 15,
    fontWeight: 600,
  },
  hostName: {
    fontSize: 13,
    opacity: 0.55,
    marginTop: 2,
  },
  hint: {
    fontSize: 12,
    opacity: 0.4,
    textAlign: "center",
    marginTop: 4,
  },
  btn: {
    padding: "10px 20px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  loadingText: {
    fontSize: 15,
    opacity: 0.7,
  },
  errorText: {
    color: "#f87171",
    fontSize: 14,
    marginBottom: 16,
  },
};
