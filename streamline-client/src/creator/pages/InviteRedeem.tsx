import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../../lib/api";
import { detectInAppBrowser, getInAppBrowserName, getOpenInBrowserHint } from "../../lib/detectInAppBrowser";
import {
  sanitizeDisplayName,
  resolveDisplayName,
  persistDisplayName,
} from "../../lib/displayNameUtils";

interface InviteInfo {
  inviteId: string;
  roomId: string;
  roomName: string;
  hostName: string;
  role: string;
  status: string;           // backward compat ("live" | "idle")
  roomStatus?: string;      // normalized: "idle" | "live" | "ended" | "not_found"
  allowGuests: boolean;
  guestJoinAllowed?: boolean;
  inviteValid: boolean;
  roomType?: string;
  debugReason?: string;
  // Greenroom Phase 3 — only present when greenroomMode is not "off"
  greenroomMode?: "prejoin" | "hls_waiting";
  lifecycleState?: string;
}

type GateState =
  | "loading"       // Fetching invite info
  | "invalid"       // Invite not found / expired / revoked
  | "waiting"       // Room exists but idle — host hasn't started yet
  | "ready"         // Room is live — show join form
  | "closed"        // Room has ended or is no longer open
  | "joining";      // Join-now in progress

function deriveGateState(info: InviteInfo | null, error: string | null, loading: boolean): GateState {
  if (loading) return "loading";
  if (error && !info) return "invalid";
  if (!info) return "invalid";
  if (!info.inviteValid) return "invalid";

  // Use roomStatus when available (new backend), fall back to status
  const rs = info.roomStatus || info.status;
  if (rs === "live") return "ready";
  if (rs === "ended" || rs === "not_found") return "closed";
  // idle with valid invite = waiting for host
  return "waiting";
}

// Stale-link threshold: after 15 minutes of polling with no room going live,
// show a more helpful message so guests aren't stuck on a spinner forever.
const STALE_THRESHOLD_MS = 15 * 60 * 1000;

export default function InviteRedeem() {
  const nav = useNavigate();
  const { inviteId } = useParams();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(() => resolveDisplayName(null));
  const [linkCopied, setLinkCopied] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waitingStartRef = useRef<number | null>(null);
  const isInApp = detectInAppBrowser();
  const inAppName = isInApp ? getInAppBrowserName() : null;
  const openHint = isInApp ? getOpenInBrowserHint(inAppName) : null;

  // Fetch invite info (reusable for both initial load and polling)
  const fetchInfo = useCallback(async (isPolling = false) => {
    const id = String(inviteId || "").trim();
    if (!id) {
      if (!isPolling) { setError("Invalid invite link."); setLoading(false); }
      return null;
    }
    try {
      const res = await apiFetch(`/api/invites/${encodeURIComponent(id)}/info`, {}, { allowNonOk: true });
      const ct = res.headers.get("content-type") || "";
      const data: any = ct.includes("application/json") ? await res.json() : null;

      if (!res.ok) {
        if (!isPolling) {
          setError(data?.error === "invite_not_found" ? "This invite link is no longer valid." : (data?.error || `HTTP ${res.status}`));
          setLoading(false);
        }
        return null;
      }
      if (!data?.inviteValid) {
        if (!isPolling) {
          setError("This invite has expired or reached its use limit.");
          setLoading(false);
        }
        return null;
      }
      return data as InviteInfo;
    } catch (err: any) {
      if (!isPolling) {
        setError(err?.message || "Could not load invite details.");
        setLoading(false);
      }
      return null;
    }
  }, [inviteId]);

  // Initial fetch
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await fetchInfo(false);
      if (cancelled) return;
      if (data) setInfo(data);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [fetchInfo]);

  // Auto-poll when room is idle (waiting for host) — every 5 seconds
  const gateState = deriveGateState(info, error, loading);

  // Greenroom routing (Phase 3):
  // When the room's greenroom mode is active and the lifecycle state is
  // "greenroom", redirect guests to the dedicated waiting room page.
  // This is checked after every info fetch (initial + poll).
  // Fallback: if greenroom state cannot be read, the existing "waiting"
  // state in this page acts as the /prejoin behavior — never removed.
  useEffect(() => {
    if (!info || loading) return;
    const { greenroomMode, lifecycleState, roomId } = info;
    if (
      greenroomMode &&
      greenroomMode !== ("off" as string) &&
      lifecycleState === "greenroom" &&
      roomId
    ) {
      nav(`/greenroom/${encodeURIComponent(roomId)}`, { replace: true });
    }
  }, [info, loading, nav]);

  useEffect(() => {
    if (gateState !== "waiting") {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      waitingStartRef.current = null;
      setIsStale(false);
      return;
    }
    // Track when we entered waiting state for stale-link guard
    if (!waitingStartRef.current) waitingStartRef.current = Date.now();

    pollRef.current = setInterval(async () => {
      const fresh = await fetchInfo(true);
      if (fresh) setInfo(fresh);
      // Check stale threshold
      if (waitingStartRef.current && Date.now() - waitingStartRef.current >= STALE_THRESHOLD_MS) {
        setIsStale(true);
      }
    }, 5000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [gateState, fetchInfo]);

  // Join handler — calls join-now to redeem + get room token in one step
  const handleJoin = useCallback(async () => {
    if (!info || joining) return;
    const name = sanitizeDisplayName(displayName).trim();
    if (!name) return;
    setJoining(true);
    setError(null);
    try {
      persistDisplayName(name);
      const res = await apiFetch(`/api/invites/${encodeURIComponent(info.inviteId)}/join-now`, {
        method: "POST",
        body: JSON.stringify({ displayName: name }),
      }, { allowNonOk: true });

      const ct = res.headers.get("content-type") || "";
      const data: any = ct.includes("application/json") ? await res.json() : null;

      if (!res.ok) {
        const msg = data?.error || `HTTP ${res.status}`;
        if (msg === "invite_expired") setError("This invite has expired.");
        else if (msg === "max_uses_reached" || msg === "invite_max_used" || msg === "invite_already_used") setError("This invite has reached its use limit.");
        else if (msg === "room_full") setError("This room is full. Please try again later.");
        else if (msg === "rate_limited") setError("Too many attempts. Please wait a moment.");
        else setError(msg);
        setJoining(false);
        return;
      }

      const roomId = data?.roomId;
      const gst = data?.guestSessionToken;
      if (!roomId) { setError("Missing room ID."); setJoining(false); return; }

      // Store guest session token in multiple layers for resilience
      if (gst) {
        try { sessionStorage.setItem(`sl_guest_session:${roomId}`, gst); } catch {}
        try { localStorage.setItem("sl_guestSessionToken", gst); localStorage.setItem("sl_guestSessionRoomId", roomId); } catch {}
      }

      // Cache the LiveKit token from join-now so Room.tsx can use it immediately
      if (data?.roomToken && data?.serverUrl) {
        try {
          sessionStorage.setItem(`sl_lk_token:${roomId}`, JSON.stringify({
            token: data.roomToken,
            serverUrl: data.serverUrl,
            identity: data.identity || "",
            displayName: name,
            roomAccessToken: data.roomAccessToken || "",
            isViewer: data.isViewer ?? false,
            role: data.role || "guest",
            fetchedAt: Date.now(),
          }));
        } catch { /* ignore */ }
      }

      // Pre-set displayName so Room.tsx skips its own name-entry gate
      try { localStorage.setItem("sl_displayName", name); } catch {}

      const qp = gst ? `?gst=${encodeURIComponent(gst)}` : "";
      nav(`/room/${encodeURIComponent(roomId)}${qp}`, { replace: true });
    } catch (err: any) {
      setError(err?.message || "Failed to join room.");
      setJoining(false);
    }
  }, [info, joining, displayName, nav]);

  // ── Shared styles ──
  const wrap: React.CSSProperties = {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    background: "#0a0a0f",
    color: "#fff",
    fontFamily: "'Inter', system-ui, sans-serif",
  };

  const card: React.CSSProperties = {
    maxWidth: 440,
    width: "100%",
    padding: 32,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.04)",
  };

  // ── GATE: Loading ──
  if (gateState === "loading") {
    return (
      <div style={wrap}>
        <div style={card}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 15, opacity: 0.7 }}>Loading invite…</div>
          </div>
        </div>
      </div>
    );
  }

  // ── GATE: Invalid invite (expired / revoked / not found) ──
  if (gateState === "invalid") {
    return (
      <div style={wrap}>
        <div style={card}>
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⚠</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              Invite Unavailable
            </div>
            <div style={{ fontSize: 14, opacity: 0.7, lineHeight: 1.5 }}>
              {error || "This invite is invalid or expired."}
            </div>
          </div>
          <button onClick={() => nav("/")} style={btnStyle("secondary")}>
            Return home
          </button>
        </div>
      </div>
    );
  }

  // ── GATE: Closed (room ended / no longer open) ──
  if (gateState === "closed") {
    return (
      <div style={wrap}>
        <div style={card}>
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🚪</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              Room is not open
            </div>
            <div style={{ fontSize: 14, opacity: 0.7, lineHeight: 1.5 }}>
              This session has ended or the room is no longer available.
            </div>
          </div>

          {/* Room info */}
          {info?.roomName && (
            <div style={{
              padding: "12px 16px", borderRadius: 10, marginBottom: 16,
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
            }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>
                {info.roomName}
              </div>
              {info.hostName && (
                <div style={{ fontSize: 13, opacity: 0.55, marginTop: 2 }}>
                  Hosted by {info.hostName}
                </div>
              )}
            </div>
          )}

          <button onClick={() => nav("/")} style={btnStyle("secondary")}>
            Return home
          </button>
        </div>
      </div>
    );
  }

  // ── GATE: Waiting for host (room idle) ──
  if (gateState === "waiting") {
    return (
      <div style={wrap}>
        <div style={card}>
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <div style={{
              width: 48, height: 48, margin: "0 auto 16px",
              borderRadius: "50%",
              border: "3px solid rgba(99,102,241,0.3)",
              borderTopColor: "#6366f1",
              animation: "sl-spin 1s linear infinite",
            }} />
            <style>{`@keyframes sl-spin { to { transform: rotate(360deg); } }`}</style>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
              Room has not started yet
            </div>
            <div style={{ fontSize: 14, opacity: 0.65, lineHeight: 1.5 }}>
              {isStale
                ? "This room has still not started. The host may not be live yet."
                : "The host has not opened this room yet. Please wait for the session to begin."}
            </div>
          </div>

          {/* Room info */}
          <div style={{
            padding: "12px 16px", borderRadius: 10, marginBottom: 16,
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
          }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>
              {info?.roomName || "StreamLine Room"}
            </div>
            {info?.hostName && (
              <div style={{ fontSize: 13, opacity: 0.55, marginTop: 2 }}>
                Hosted by {info.hostName}
              </div>
            )}
          </div>

          <div style={{ fontSize: 12, opacity: 0.4, textAlign: "center", marginBottom: 16 }}>
            Checking automatically…
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={async () => {
                const fresh = await fetchInfo(true);
                if (fresh) setInfo(fresh);
              }}
              style={{ ...btnStyle("secondary"), flex: 1 }}
            >
              Refresh
            </button>
            <button onClick={() => nav("/")} style={{ ...btnStyle("secondary"), flex: 1 }}>
              Return home
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── GATE: Ready to join (room is live) ──
  // This is the only state that shows the name input + Join button.
  const effectiveState = joining ? "joining" : gateState;

  return (
    <div style={wrap}>
      <div style={card}>
        {/* Room info header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 1.2, opacity: 0.5, marginBottom: 6 }}>
            You're invited to
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.3 }}>
            {info?.roomName || "a StreamLine room"}
          </div>
          {info?.hostName && (
            <div style={{ fontSize: 14, opacity: 0.65, marginTop: 4 }}>
              Hosted by {info.hostName}
            </div>
          )}
          <span style={{
            display: "inline-block", marginTop: 8, padding: "3px 10px",
            borderRadius: 20, fontSize: 11, fontWeight: 600,
            background: "rgba(34,197,94,0.15)", color: "#22c55e",
          }}>
            ● LIVE NOW
          </span>
        </div>

        {/* In-app browser warning */}
        {isInApp && (
          <div style={{
            padding: "10px 14px", borderRadius: 10, marginBottom: 16,
            background: "rgba(250,204,21,0.1)", border: "1px solid rgba(250,204,21,0.25)",
            fontSize: 13, lineHeight: 1.45,
          }}>
            <strong>Heads up:</strong> You're in {inAppName ? `the ${inAppName} browser` : "an in-app browser"} which may block camera &amp; mic access.
            {openHint && <span> {openHint}.</span>}
            <button
              onClick={() => {
                try {
                  navigator.clipboard.writeText(window.location.href);
                  setLinkCopied(true);
                  setTimeout(() => setLinkCopied(false), 2000);
                } catch { /* ignore */ }
              }}
              aria-label={linkCopied ? "Link copied to clipboard" : "Copy invite link to clipboard"}
              style={{
                display: "block", marginTop: 8, padding: "6px 14px", borderRadius: 8,
                border: "1px solid rgba(250,204,21,0.35)", background: "rgba(250,204,21,0.08)",
                color: "#fbbf24", fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}
            >
              <span aria-live="polite">
                {linkCopied ? "✓ Link copied!" : "📋 Copy link to open in browser"}
              </span>
            </button>
          </div>
        )}

        {/* Display name input */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, opacity: 0.8 }}>
            Your display name
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(sanitizeDisplayName(e.target.value))}
            placeholder="Enter your name"
            maxLength={50}
            autoFocus
            disabled={effectiveState === "joining"}
            style={{
              width: "100%", padding: "10px 14px", borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)",
              color: "#fff", fontSize: 15, outline: "none", boxSizing: "border-box",
              opacity: effectiveState === "joining" ? 0.5 : 1,
            }}
          />
        </div>

        {/* Error banner */}
        {error && (
          <div style={{
            padding: "10px 14px", borderRadius: 10, marginBottom: 16,
            background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)",
            fontSize: 13, color: "#f87171",
          }}>
            {error}
          </div>
        )}

        {/* Join button */}
        <button
          onClick={handleJoin}
          disabled={effectiveState === "joining" || !sanitizeDisplayName(displayName).trim()}
          style={{
            ...btnStyle("primary"),
            opacity: (effectiveState === "joining" || !sanitizeDisplayName(displayName).trim()) ? 0.5 : 1,
            cursor: (effectiveState === "joining" || !sanitizeDisplayName(displayName).trim()) ? "not-allowed" : "pointer",
          }}
        >
          {effectiveState === "joining" ? "Joining…" : "Join Room"}
        </button>

        {/* Role info */}
        <div style={{ marginTop: 14, fontSize: 12, opacity: 0.45, textAlign: "center" }}>
          You'll join as <strong>{info?.role || "guest"}</strong> — no account required
        </div>
      </div>
    </div>
  );
}

function btnStyle(variant: "primary" | "secondary"): React.CSSProperties {
  const base: React.CSSProperties = {
    width: "100%",
    padding: "12px 20px",
    borderRadius: 12,
    border: "none",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    transition: "opacity 0.15s",
  };
  if (variant === "primary") {
    return { ...base, background: "#6366f1", color: "#fff" };
  }
  return {
    ...base,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.15)",
    color: "#fff",
  };
}
