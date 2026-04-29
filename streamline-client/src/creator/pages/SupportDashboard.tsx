/**
 * SupportDashboard — Admin-only support / Horizon monitoring dashboard.
 *
 * Connects to the authenticated Horizon WebSocket at /ws/horizon and
 * provides a real-time view for admin users.
 */
import React, { useEffect, useRef, useState, useCallback } from "react";
import { API_BASE } from "../../lib/apiBase";
import { getFirebaseIdToken } from "../../lib/firebaseClient";
import { apiFetchAuth } from "../../lib/api";

// ── Types ───────────────────────────────────────────────────────────────
interface HorizonStatus {
  ok: boolean;
  service: string;
  ts: string;
}

type WsState = "connecting" | "open" | "closed" | "error";

// ── Helpers ─────────────────────────────────────────────────────────────

/** Build the WS URL from the current API_BASE, swapping http(s) → ws(s). */
function wsBase(): string {
  return API_BASE.replace(/^http/, "ws");
}

/** Get the best available auth token for the WebSocket connection. */
async function getWsToken(): Promise<string | null> {
  // Prefer Firebase ID token (mirrors apiFetchAuth priority)
  let token = await getFirebaseIdToken();
  if (token) return token;

  // Fallback to legacy localStorage token
  try {
    token = window.localStorage.getItem("authToken");
    if (token) return token;
  } catch {
    // ignore
  }
  return null;
}

// ── Component ───────────────────────────────────────────────────────────

export default function SupportDashboard() {
  const [wsState, setWsState] = useState<WsState>("closed");
  const [horizonStatus, setHorizonStatus] = useState<HorizonStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch the Horizon HTTP status on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetchAuth("/api/horizon/status", {}, { allowNonOk: true });
        if (!cancelled && res.ok) {
          setHorizonStatus(await res.json());
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Failed to fetch Horizon status");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // WebSocket lifecycle
  const connect = useCallback(async () => {
    // Tear down any existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setWsState("connecting");
    setError(null);

    const token = await getWsToken();
    if (!token) {
      setError("No auth token available");
      setWsState("error");
      return;
    }

    const url = `${wsBase()}/ws/horizon?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setWsState("open");
    ws.onclose = () => setWsState("closed");
    ws.onerror = () => {
      setError("WebSocket connection error");
      setWsState("error");
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "pong") {
          // keepalive ack — no-op for now
        }
      } catch {
        // ignore malformed frames
      }
    };
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setWsState("closed");
  }, []);

  // Cleanup on unmount
  useEffect(() => () => { wsRef.current?.close(); }, []);

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 32, maxWidth: 720, margin: "0 auto", color: "#fff" }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Support Dashboard</h1>

      {error && (
        <div style={{ padding: 12, background: "#3a1c1c", borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Horizon HTTP status */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Horizon Status</h2>
        {horizonStatus ? (
          <pre style={{ background: "#1a1a2e", padding: 12, borderRadius: 8, overflow: "auto" }}>
            {JSON.stringify(horizonStatus, null, 2)}
          </pre>
        ) : (
          <p style={{ opacity: 0.6 }}>Loading…</p>
        )}
      </section>

      {/* WebSocket controls */}
      <section>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>
          Horizon WebSocket{" "}
          <span style={{ fontSize: 12, opacity: 0.7 }}>({wsState})</span>
        </h2>
        {wsState === "closed" || wsState === "error" ? (
          <button onClick={connect} style={btnStyle}>
            Connect
          </button>
        ) : (
          <button onClick={disconnect} style={btnStyle}>
            Disconnect
          </button>
        )}
      </section>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "8px 20px",
  borderRadius: 6,
  border: "1px solid #555",
  background: "#222",
  color: "#fff",
  cursor: "pointer",
};
