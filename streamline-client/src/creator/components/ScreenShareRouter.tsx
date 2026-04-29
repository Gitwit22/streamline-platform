import { useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScreenShareRouteMode =
  | "off"
  | "main"
  | "popout";

export const SCREEN_SHARE_ROUTE_LABELS: Record<ScreenShareRouteMode, string> = {
  off: "Off",
  main: "Main Feed",
  popout: "Pop-out Window",
};

export const SCREEN_SHARE_ROUTE_DESCRIPTIONS: Record<ScreenShareRouteMode, string> = {
  off: "Screen share audio/video is disabled",
  main: "Send screen share directly to the live stream",
  popout: "Open screen share in a separate producer preview window",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ScreenShareRouterProps {
  open: boolean;
  onClose: () => void;
  mode: ScreenShareRouteMode;
  onModeChange: (mode: ScreenShareRouteMode) => void;
  /** Name of the participant currently screen sharing, if any */
  activeSharerName?: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ScreenShareRouter({
  open,
  onClose,
  mode,
  onModeChange,
  activeSharerName,
}: ScreenShareRouterProps) {
  const [selectedMode, setSelectedMode] = useState<ScreenShareRouteMode>(mode);

  // Sync with parent when prop changes
  useEffect(() => {
    setSelectedMode(mode);
  }, [mode]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const modes: ScreenShareRouteMode[] = ["off", "main", "popout"];

  const handleSelect = (m: ScreenShareRouteMode) => {
    setSelectedMode(m);
    onModeChange(m);
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: "80px",
        right: "420px",
        zIndex: 51,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div
        style={{
          width: "340px",
          display: "flex",
          flexDirection: "column",
          background: "rgba(20, 20, 20, 0.98)",
          border: "1px solid rgba(59, 130, 246, 0.5)",
          borderRadius: "0.75rem",
          boxShadow: "0 20px 60px rgba(59, 130, 246, 0.2)",
          backdropFilter: "blur(20px)",
          color: "#e5e7eb",
        }}
      >
        {/* ---- Header ---- */}
        <div
          style={{
            padding: "0.75rem 1rem",
            background:
              "linear-gradient(135deg, rgba(59,130,246,0.12), rgba(96,165,250,0.06))",
            borderBottom: "2px solid rgba(59,130,246,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "0.75rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                color: "#60a5fa",
              }}
            >
              🖥️ Screen Share Routing
            </div>
            <div style={{ fontSize: "0.65rem", color: "#9ca3af", marginTop: 2 }}>
              Where does the screen share go?
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(59,130,246,0.15)",
              border: "1px solid rgba(59,130,246,0.3)",
              borderRadius: "0.4rem",
              color: "#93c5fd",
              cursor: "pointer",
              padding: "0.25rem 0.55rem",
              fontSize: "0.8rem",
              fontWeight: 600,
              lineHeight: 1,
            }}
            aria-label="Close screen share router"
          >
            ✕
          </button>
        </div>

        {/* ---- Options ---- */}
        <div style={{ padding: "0.75rem 1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {modes.map((m) => {
            const active = selectedMode === m;
            return (
              <button
                key={m}
                onClick={() => handleSelect(m)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.15rem",
                  padding: "0.65rem 0.8rem",
                  borderRadius: "0.5rem",
                  border: active
                    ? "1px solid rgba(59,130,246,0.6)"
                    : "1px solid rgba(55,65,81,0.5)",
                  background: active
                    ? "rgba(59,130,246,0.12)"
                    : "rgba(15,23,42,0.5)",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 0.15s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  {/* Radio indicator */}
                  <div
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      border: active
                        ? "2px solid #3b82f6"
                        : "2px solid #4b5563",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {active && (
                      <div
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: "#3b82f6",
                        }}
                      />
                    )}
                  </div>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      color: active ? "#93c5fd" : "#d1d5db",
                    }}
                  >
                    {SCREEN_SHARE_ROUTE_LABELS[m]}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: "0.6rem",
                    color: "#6b7280",
                    marginLeft: 22,
                  }}
                >
                  {SCREEN_SHARE_ROUTE_DESCRIPTIONS[m]}
                </span>
              </button>
            );
          })}

          {/* Current status */}
          <div
            style={{
              marginTop: "0.25rem",
              padding: "0.5rem 0.7rem",
              background: "rgba(15,23,42,0.7)",
              borderRadius: "0.4rem",
              border: "1px solid rgba(55,65,81,0.5)",
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
            }}
          >
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background:
                  selectedMode === "off"
                    ? "#6b7280"
                    : selectedMode === "main"
                      ? "#34d399"
                      : "#60a5fa",
              }}
            />
            <span style={{ fontSize: "0.6rem", color: "#9ca3af" }}>
              Current: <strong style={{ color: "#d1d5db" }}>{SCREEN_SHARE_ROUTE_LABELS[selectedMode]}</strong>
            </span>
          </div>

          {/* Active screen share indicator */}
          <div
            style={{
              padding: "0.5rem 0.7rem",
              background: activeSharerName
                ? "rgba(16,185,129,0.08)"
                : "rgba(15,23,42,0.7)",
              borderRadius: "0.4rem",
              border: activeSharerName
                ? "1px solid rgba(16,185,129,0.3)"
                : "1px solid rgba(55,65,81,0.5)",
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
            }}
          >
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: activeSharerName ? "#10b981" : "#4b5563",
                animation: activeSharerName ? "pulse 1.5s ease-in-out infinite" : "none",
              }}
            />
            <span style={{ fontSize: "0.6rem", color: "#9ca3af" }}>
              {activeSharerName ? (
                <>Sharing: <strong style={{ color: "#6ee7b7" }}>{activeSharerName}</strong></>
              ) : (
                "No active screen share"
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
