import { useEffect, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../../lib/api";
import { detectInAppBrowser, getInAppBrowserName, getOpenInBrowserHint } from "../../lib/detectInAppBrowser";
import {
  sanitizeDisplayName,
  resolveDisplayName,
  persistDisplayName,
  getPersistedDisplayName,
} from "../../lib/displayNameUtils";

interface InviteInfo {
  inviteId: string;
  roomId: string;
  roomName: string;
  hostName: string;
  role: string;
  status: string;
  allowGuests: boolean;
  inviteValid: boolean;
}

export default function InviteRedeem() {
  const nav = useNavigate();
  const { inviteId } = useParams();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(() => resolveDisplayName(null));
  const [linkCopied, setLinkCopied] = useState(false);
  const isInApp = detectInAppBrowser();
  const inAppName = isInApp ? getInAppBrowserName() : null;
  const openHint = isInApp ? getOpenInBrowserHint(inAppName) : null;

  // Fetch invite info on mount (read-only, no useCount burn)
  useEffect(() => {
    const load = async () => {
      try {
        const id = String(inviteId || "").trim();
        if (!id) { setError("Invalid invite link."); setLoading(false); return; }

        const res = await apiFetch(`/api/invites/${encodeURIComponent(id)}/info`, {}, { allowNonOk: true });
        const ct = res.headers.get("content-type") || "";
        const data: any = ct.includes("application/json") ? await res.json() : null;

        if (!res.ok) {
          setError(data?.error === "invite_not_found" ? "This invite link is no longer valid." : (data?.error || `HTTP ${res.status}`));
          setLoading(false);
          return;
        }

        if (!data?.inviteValid) {
          setError("This invite has expired or reached its use limit.");
          setLoading(false);
          return;
        }

        setInfo(data as InviteInfo);
      } catch (err: any) {
        setError(err?.message || "Could not load invite details.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [inviteId]);

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
        setError(msg === "invite_expired" ? "This invite has expired." : msg === "max_uses_reached" ? "This invite has reached its use limit." : msg);
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
      // without a second round-trip to /api/rooms/:roomId/token.
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

      const qp = gst ? `?gst=${encodeURIComponent(gst)}` : "";
      nav(`/room/${encodeURIComponent(roomId)}${qp}`, { replace: true });
    } catch (err: any) {
      setError(err?.message || "Failed to join room.");
      setJoining(false);
    }
  }, [info, joining, displayName, nav]);

  // --- Render ---
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

  // Loading state
  if (loading) {
    return (
      <div style={wrap}>
        <div style={card}>
          <div style={{ fontSize: 15, opacity: 0.7 }}>Loading invite…</div>
        </div>
      </div>
    );
  }

  // Error-only state (no info loaded)
  if (error && !info) {
    return (
      <div style={wrap}>
        <div style={card}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Invite Error</div>
          <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 18 }}>{error}</div>
          <button
            onClick={() => nav("/login")}
            style={btnStyle("secondary")}
          >
            Sign in instead
          </button>
        </div>
      </div>
    );
  }

  // Landing page
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
          {info?.status === "live" && (
            <span style={{
              display: "inline-block", marginTop: 8, padding: "3px 10px",
              borderRadius: 20, fontSize: 11, fontWeight: 600,
              background: "rgba(34,197,94,0.15)", color: "#22c55e",
            }}>
              ● LIVE NOW
            </span>
          )}
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
                display: "block",
                marginTop: 8,
                padding: "6px 14px",
                borderRadius: 8,
                border: "1px solid rgba(250,204,21,0.35)",
                background: "rgba(250,204,21,0.08)",
                color: "#fbbf24",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
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
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.06)",
              color: "#fff",
              fontSize: 15,
              outline: "none",
              boxSizing: "border-box",
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
          disabled={joining || !sanitizeDisplayName(displayName).trim()}
          style={{
            ...btnStyle("primary"),
            opacity: (joining || !sanitizeDisplayName(displayName).trim()) ? 0.5 : 1,
            cursor: (joining || !sanitizeDisplayName(displayName).trim()) ? "not-allowed" : "pointer",
          }}
        >
          {joining ? "Joining…" : "Join Room"}
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
