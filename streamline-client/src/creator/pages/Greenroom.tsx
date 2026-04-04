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
 * This page has two operating modes:
 *
 * 1. Request mode (requireApproval=true or autoAdmit):
 *    Guest enters their display name → server puts them in pending queue or
 *    auto-admits them → page polls /greenroom/status until approved/denied.
 *
 * 2. Passive mode (fallback when request endpoint is unavailable):
 *    Polls /api/rooms/:roomId/info every 5 seconds and redirects when the
 *    room goes live (guestJoinAllowed === true). This preserves the behavior
 *    of rooms that don't use the approval flow.
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

type GuestStage =
  | "loading"
  | "name_form"
  | "requesting"
  | "pending"
  | "approved"
  | "denied"
  | "waiting"; // passive fallback

const POLL_INTERVAL_MS = 5_000;
const STALE_THRESHOLD_MS = 15 * 60 * 1_000; // 15 minutes

export default function Greenroom() {
  const nav = useNavigate();
  const { roomId } = useParams<{ roomId: string }>();

  const [info, setInfo] = useState<RoomInfo | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [customization, setCustomization] = useState<PublicRoomCustomization | null>(null);

  // Approval-flow state
  const [stage, setStage] = useState<GuestStage>("loading");
  const [displayName, setDisplayName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waitingStartRef = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

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
   * Returns true if a redirect was triggered.
   */
  const maybeRedirect = useCallback(
    (data: RoomInfo | null): boolean => {
      if (!data || !roomId) return false;

      const rs = data.roomStatus || data.status || "";
      const lifecycleState = data.lifecycleState || "";

      // Room went live — admit immediately.
      if (rs === "live" || data.guestJoinAllowed === true) {
        stopPolling();
        nav(`/room/${encodeURIComponent(roomId)}`, { replace: true });
        return true;
      }

      // Room ended — send home.
      if (rs === "ended" || rs === "not_found") {
        stopPolling();
        nav("/join", { replace: true });
        return true;
      }

      // Lifecycle has moved past "greenroom" — time to join.
      if (lifecycleState && lifecycleState !== "greenroom" && lifecycleState !== "draft" && lifecycleState !== "setup") {
        stopPolling();
        nav(`/room/${encodeURIComponent(roomId)}`, { replace: true });
        return true;
      }

      // Greenroom was disabled — fall back to prejoin flow.
      if (data.greenroomMode === "off" || data.greenroomMode === undefined) {
        stopPolling();
        nav(`/join`, { replace: true });
        return true;
      }

      return false;
    },
    [roomId, nav]
  );

  // Initial fetch — determine room state, then choose stage.
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
        nav("/join", { replace: true });
        return;
      }

      setInfo(data);

      if (maybeRedirect(data)) return;

      // Fetch public customization for branding (best-effort).
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

      // Show the name form to initiate the request flow.
      setStage("name_form");
    })();

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [roomId, fetchInfo, maybeRedirect, nav]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = displayName.trim();
    if (!name) {
      setNameError("Please enter your display name.");
      return;
    }
    setNameError(null);
    setRequestError(null);
    setStage("requesting");

    try {
      const res = await apiFetch(
        `/api/rooms/${encodeURIComponent(String(roomId))}/greenroom/request`,
        { method: "POST", body: JSON.stringify({ displayName: name }) },
        { allowNonOk: true }
      );
      const ct = res.headers.get("content-type") || "";
      const data: any = ct.includes("application/json") ? await res.json() : {};

      if (res.status === 403) {
        setStage("denied");
        return;
      }

      if (res.status === 409 && data?.error === "greenroom_not_active") {
        // Greenroom not configured server-side — fall back to passive waiting.
        setStage("waiting");
        startPassivePolling();
        return;
      }

      if (!res.ok) {
        setRequestError(data?.details || data?.error || "Could not submit request. Please try again.");
        setStage("name_form");
        return;
      }

      if (data.approved) {
        // Auto-admitted (autoAdmit or vipBypass). Redirect to room.
        nav(`/room/${encodeURIComponent(String(roomId))}`, { replace: true });
        return;
      }

      if (data.pending && data.requestId) {
        setRequestId(data.requestId);
        setStage("pending");
        startApprovalPolling(data.requestId);
        return;
      }

      // Unexpected response — fallback to passive.
      setStage("waiting");
      startPassivePolling();
    } catch {
      setRequestError("Could not reach the server. Please try again.");
      setStage("name_form");
    }
  };

  const startApprovalPolling = useCallback((rid: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await apiFetch(
          `/api/rooms/${encodeURIComponent(String(roomId))}/greenroom/status?requestId=${encodeURIComponent(rid)}`,
          {},
          { allowNonOk: true }
        );
        if (!res.ok) return;
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("application/json")) return;
        const data: any = await res.json();

        if (data.approved) {
          stopPolling();
          setStage("approved");
          setTimeout(() => {
            nav(`/room/${encodeURIComponent(String(roomId))}`, { replace: true });
          }, 1200);
          return;
        }

        if (data.denied) {
          stopPolling();
          setStage("denied");
        }
      } catch {
        // Transient error — keep polling.
      }
    }, POLL_INTERVAL_MS);
  }, [roomId, nav]);

  const startPassivePolling = useCallback(() => {
    stopPolling();
    if (!waitingStartRef.current) waitingStartRef.current = Date.now();

    pollRef.current = setInterval(async () => {
      const fresh = await fetchInfo();
      if (!fresh) return;
      setInfo(fresh);
      if (maybeRedirect(fresh)) return;

      if (waitingStartRef.current && Date.now() - waitingStartRef.current >= STALE_THRESHOLD_MS) {
        setIsStale(true);
      }
    }, POLL_INTERVAL_MS);
  }, [fetchInfo, maybeRedirect]);

  // ── Render ────────────────────────────────────────────────────────────────

  const waitingMessage =
    customization?.greenroom?.waitingRoomMessage ||
    (isStale
      ? "The host has not opened the room yet. They may be running late."
      : "The host will admit you shortly. Please stand by.");

  if (stage === "loading") {
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

  if (stage === "denied") {
    return (
      <RoomBrandingLayer customization={customization}>
        <div style={styles.page}>
          <div style={styles.card}>
            <h1 style={{ ...styles.title, color: "#f87171" }}>Access Denied</h1>
            <p style={styles.subtitle}>Your request to join this room was not approved.</p>
            <button style={{ ...styles.btn, marginTop: 20 }} onClick={() => nav("/join")}>
              Return home
            </button>
          </div>
        </div>
      </RoomBrandingLayer>
    );
  }

  if (stage === "approved") {
    return (
      <RoomBrandingLayer customization={customization}>
        <div style={styles.page}>
          <div style={styles.card}>
            <div style={{ textAlign: "center" }}>
              <div style={styles.spinner} />
              <style>{spinnerKeyframes}</style>
              <h1 style={{ ...styles.title, color: "#4ade80" }}>Approved!</h1>
              <p style={styles.subtitle}>Entering the room…</p>
            </div>
          </div>
        </div>
      </RoomBrandingLayer>
    );
  }

  if (stage === "name_form" || stage === "requesting") {
    return (
      <RoomBrandingLayer customization={customization}>
        <div style={styles.page}>
          <div style={styles.card}>
            {info && (info.roomName || info.hostName) && (
              <div style={{ ...styles.roomInfo, marginBottom: 20 }}>
                {info.roomName && <div style={styles.roomName}>{info.roomName}</div>}
                {info.hostName && <div style={styles.hostName}>Hosted by {info.hostName}</div>}
              </div>
            )}
            <h1 style={styles.title}>Join the waiting room</h1>
            <p style={styles.subtitle}>Enter your name to request access.</p>
            <form onSubmit={handleRequestSubmit} style={{ marginTop: 20 }}>
              <input
                type="text"
                placeholder="Your display name"
                value={displayName}
                maxLength={40}
                disabled={stage === "requesting"}
                onChange={(e) => setDisplayName(e.target.value)}
                style={styles.nameInput}
                autoFocus
              />
              {nameError && <p style={styles.errorText}>{nameError}</p>}
              {requestError && <p style={styles.errorText}>{requestError}</p>}
              <button
                type="submit"
                disabled={stage === "requesting"}
                style={{ ...styles.btn, width: "100%", marginTop: 12 }}
              >
                {stage === "requesting" ? "Requesting…" : "Request to Join"}
              </button>
            </form>
          </div>
        </div>
      </RoomBrandingLayer>
    );
  }

  if (stage === "pending") {
    return (
      <RoomBrandingLayer customization={customization}>
        <div style={styles.page}>
          <div style={styles.card}>
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={styles.spinner} />
              <style>{spinnerKeyframes}</style>
              <h1 style={styles.title}>Waiting for approval</h1>
              <p style={styles.subtitle}>
                The host will admit you shortly. Please stand by.
              </p>
            </div>
            {info && (info.roomName || info.hostName) && (
              <div style={styles.roomInfo}>
                {info.roomName && <div style={styles.roomName}>{info.roomName}</div>}
                {info.hostName && <div style={styles.hostName}>Hosted by {info.hostName}</div>}
              </div>
            )}
            <div style={styles.hint}>Checking automatically…</div>
          </div>
        </div>
      </RoomBrandingLayer>
    );
  }

  // "waiting" — passive fallback mode.
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

          {info && (info.roomName || info.hostName) && (
            <div style={styles.roomInfo}>
              {info.roomName && <div style={styles.roomName}>{info.roomName}</div>}
              {info.hostName && <div style={styles.hostName}>Hosted by {info.hostName}</div>}
            </div>
          )}

          <div style={styles.hint}>Checking automatically…</div>

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button
              style={{ ...styles.btn, flex: 1 }}
              onClick={async () => {
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
  nameInput: {
    width: "100%",
    boxSizing: "border-box" as const,
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    fontSize: 14,
    outline: "none",
  },
};
