import { useNavigate } from "react-router-dom";
import { getProgramConfig } from "../config/programs";
import type { ProgramKey } from "../config/programs";

interface LaneNotAvailableProps {
  /** The program key of the route that was blocked (not the active program). */
  blockedProgram?: ProgramKey;
}

/**
 * Shown when a user navigates to a route that belongs to a different
 * StreamLine program/lane than the one this build was configured for.
 */
export default function LaneNotAvailable({ blockedProgram }: LaneNotAvailableProps) {
  const nav = useNavigate();
  const config = getProgramConfig();

  const blockedName =
    blockedProgram === "edu"
      ? "StreamLine EDU"
      : blockedProgram === "corporate"
      ? "StreamLine Corporate"
      : "this StreamLine lane";

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#0f172a",
        color: "#94a3b8",
        padding: "2rem",
        textAlign: "center",
        gap: "1.5rem",
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "rgba(148,163,184,0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 24,
        }}
      >
        🔒
      </div>

      <div>
        <h1
          style={{
            fontSize: "1.375rem",
            fontWeight: 700,
            color: "#f8fafc",
            margin: "0 0 0.5rem",
          }}
        >
          Not available in this lane
        </h1>
        <p style={{ margin: 0, maxWidth: 380, lineHeight: 1.6 }}>
          {blockedName} is not part of this {config.appName} deployment. You may
          be looking for a different StreamLine environment.
        </p>
      </div>

      <button
        onClick={() => nav(config.defaultRouteAfterLogin)}
        style={{
          padding: "10px 20px",
          borderRadius: 8,
          border: "1px solid rgba(148,163,184,0.2)",
          background: "rgba(148,163,184,0.08)",
          color: "#f8fafc",
          fontSize: 14,
          cursor: "pointer",
          fontWeight: 500,
        }}
      >
        Go to {config.appName} dashboard
      </button>
    </div>
  );
}
