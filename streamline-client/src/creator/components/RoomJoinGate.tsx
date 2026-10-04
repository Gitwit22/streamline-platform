import React from "react";
import { formatElapsed } from "../../lib/roomJoin";

// Pre-join screens for the routed room page: the shared dark/red layout of
// the name gate, plus status cards (waiting for host, ended, not found, no
// access). Styling matches the existing name form in creator/pages/Room.tsx.

const cardStyle: React.CSSProperties = {
  background: "rgba(39, 39, 42, 0.5)",
  borderRadius: "1rem",
  padding: "2rem",
  width: "100%",
  maxWidth: "400px",
  display: "flex",
  flexDirection: "column",
  gap: "1rem",
  border: "1px solid rgba(63, 63, 70, 0.8)",
  backdropFilter: "blur(20px)",
  position: "relative",
  zIndex: 1,
  boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
  textAlign: "center",
};

const secondaryButton: React.CSSProperties = {
  flex: 1,
  padding: "0.75rem",
  borderRadius: "0.75rem",
  background: "rgba(255, 255, 255, 0.08)",
  color: "#ffffff",
  fontWeight: 600,
  border: "1px solid rgba(255, 255, 255, 0.2)",
  cursor: "pointer",
  fontSize: "0.875rem",
};

export function JoinGateLayout({
  roomName,
  hostName,
  isLive,
  children,
}: {
  roomName: string;
  hostName?: string | null;
  isLive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#000000",
        color: "#ffffff",
        padding: "1.5rem",
        position: "relative",
        overflow: "hidden",
        gap: "1rem",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "20%",
          left: "15%",
          width: "200px",
          height: "200px",
          borderRadius: "50%",
          background: "linear-gradient(135deg, #dc2626, #ef4444)",
          opacity: 0.1,
          filter: "blur(30px)",
          animation: "float 7s ease-in-out infinite",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "25%",
          right: "20%",
          width: "150px",
          height: "150px",
          borderRadius: "50%",
          background: "linear-gradient(135deg, #ef4444, #dc2626)",
          opacity: 0.08,
          filter: "blur(25px)",
          animation: "float 9s ease-in-out infinite reverse",
        }}
      />
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-15px) rotate(180deg); }
        }
        @keyframes sl-spin { to { transform: rotate(360deg); } }
      `}</style>

      <div style={{ textAlign: "center", position: "relative", zIndex: 1 }} data-testid="join-gate-header">
        <h2 style={{ fontSize: "1.25rem", fontWeight: 600, color: "rgba(255, 255, 255, 0.9)", marginBottom: "0.25rem" }}>
          {roomName}
        </h2>
        {isLive && (
          <span
            style={{
              display: "inline-block",
              background: "#e53e3e",
              color: "white",
              fontSize: "0.7rem",
              fontWeight: 700,
              padding: "3px 10px",
              borderRadius: "20px",
              letterSpacing: "0.5px",
            }}
          >
            ● LIVE
          </span>
        )}
        {hostName && (
          <p style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.55)", marginTop: "0.25rem" }}>Hosted by {hostName}</p>
        )}
      </div>

      {children}

      <img src="/logosmall.png" alt="StreamLine Logo" className="mt-6 w-40 opacity-90" style={{ position: "relative", zIndex: 1 }} />
    </div>
  );
}

export function WaitingForHostCard({
  elapsedMs,
  stale,
  hasName,
  onCheckNow,
  onHome,
}: {
  elapsedMs: number;
  stale: boolean;
  /** Name chosen: we'll join automatically once live. */
  hasName: boolean;
  onCheckNow: () => void;
  onHome: () => void;
}) {
  return (
    <div style={cardStyle} role="status" data-testid="join-gate-waiting">
      <div
        style={{
          width: 40,
          height: 40,
          margin: "0 auto",
          borderRadius: "50%",
          border: "3px solid rgba(239,68,68,0.3)",
          borderTopColor: "#ef4444",
          animation: "sl-spin 1s linear infinite",
        }}
      />
      <h1 style={{ fontSize: "1.25rem", fontWeight: 600, color: "#ffffff", margin: 0 }}>Room has not started yet</h1>
      <p style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.6)", lineHeight: 1.5, margin: 0 }}>
        {stale
          ? "This room has still not started. The host may not be live yet — check the link or try again later."
          : hasName
            ? "You'll join automatically as soon as the host starts the session."
            : "The host has not opened this room yet. Enter your name below and you'll join when it starts."}
      </p>
      <p style={{ fontSize: "0.75rem", opacity: 0.5, margin: 0 }}>
        Checking automatically… waiting {formatElapsed(elapsedMs)}
      </p>
      <div style={{ display: "flex", gap: 10 }}>
        <button type="button" onClick={onCheckNow} style={secondaryButton}>
          Check now
        </button>
        <button type="button" onClick={onHome} style={secondaryButton}>
          Return home
        </button>
      </div>
    </div>
  );
}

export function RoomUnavailableCard({
  title,
  message,
  actionLabel,
  onAction,
  testId,
}: {
  title: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
  testId?: string;
}) {
  return (
    <div style={cardStyle} role="alert" data-testid={testId}>
      <h1 style={{ fontSize: "1.25rem", fontWeight: 600, color: "#ffffff", margin: 0 }}>{title}</h1>
      <p style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.6)", lineHeight: 1.5, margin: 0 }}>{message}</p>
      <button type="button" onClick={onAction} style={secondaryButton}>
        {actionLabel}
      </button>
    </div>
  );
}
