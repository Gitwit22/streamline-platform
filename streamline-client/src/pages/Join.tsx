import { useState, useEffect } from "react";
import { API_BASE } from "../lib/apiBase";
import { logAuthDebugContext } from "../lib/logAuthDebug";
import { useNavigate, useSearchParams,} from "react-router-dom";


type UsageData = {
  streamingMinutes: number;
  maxStreamingMinutes: 500;
  storageUsed: number;
  maxStorage: 10;
  planId: string;
};

export default function Join() {
  // Log auth/user info when arriving at join page
  useEffect(() => { logAuthDebugContext("Arrive Join Page"); }, []);
  const nav = useNavigate();
  const [searchParams] = useSearchParams();

  const [displayName, setDisplayName] = useState("");
  const [roomName, setRoomName] = useState("");
  const [showEditingModal, setShowEditingModal] = useState(false);

  // Usage state
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);

  // Pull user from localStorage (existing behavior) - useState so it's stable
  const [user] = useState(() => {
    const raw = localStorage.getItem("sl_user");
    if (!raw || raw === "undefined") return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      localStorage.removeItem("sl_user");
      return null;
    }
  });

  // Check for invite link (room query parameter)
  const isParticipant = searchParams.get("room") !== null;
  const role = searchParams.get("role") || "guest"; // Get role from URL
const [isAdmin, setIsAdmin] = useState(false);
const [adminLoading, setAdminLoading] = useState(true);

// Swallow all errors from /api/admin/status so Join never blocks
useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/status`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setIsAdmin(!!data.isAdmin);
      console.log("[DEBUG] isAdmin set to:", !!data.isAdmin);
    } catch {
      // ignore completely
    } finally {
      if (!cancelled) setAdminLoading(false);
      console.log("[DEBUG] adminLoading set to false");
    }
  })();
  return () => { cancelled = true; };
}, []);

  useEffect(() => {
    const inviteRoom = searchParams.get("room");
    if (inviteRoom) {
      const decodedRoom = decodeURIComponent(inviteRoom);
      setRoomName(decodedRoom);

      // Store role for later use in room
      console.log("👤 Joining as role:", role);
      localStorage.setItem("sl_current_role", role);
    }
  }, [searchParams, role]);

  // Fetch real usage summary (for all authenticated users)
  useEffect(() => {
    let didCancel = false;
   

    setUsageLoading(true);
    setUsageError(null);

    fetch(`${API_BASE}/api/usage/me`, { credentials: "include" })
  .then(async (res) => {
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "Failed to fetch usage data");
    }
    return res.json();
  })
  .then((data) => {
    if (!didCancel) {
      const um = data?.usageMonthly || {};
      setUsageData({
        streamingMinutes: um?.participantMinutes ?? um?.usage?.participantMinutes ?? 0,
        maxStreamingMinutes: data?.plan?.limits?.participantMinutes ?? 0,
        storageUsed: um?.storageGB ?? um?.usage?.storageGB ?? 0,
        maxStorage: data?.plan?.limits?.storageGB ?? 0,
        planId: data?.plan?.id ?? data?.user?.planId ?? "free",
      });
      setUsageLoading(false);
    }
  })
      .catch((err) => {
        if (!didCancel) {
          setUsageError(err.message || "Failed to fetch usage data");
          setUsageLoading(false);
        }
      });
    return () => {
      didCancel = true;
    };
  }, [user]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const name = displayName.trim();
    const room = roomName.trim();
    if (!name || !room) return;

    localStorage.setItem("sl_displayName", name);

    // Mark this room as created by this user (only if not joining via invite)
    if (!isParticipant) {
      const createdRooms = JSON.parse(
        localStorage.getItem("sl_created_rooms") || "[]"
      );
      if (!createdRooms.includes(room)) {
        createdRooms.push(room);
        localStorage.setItem("sl_created_rooms", JSON.stringify(createdRooms));
      }
      // Set role to 'host' when creating a room
      localStorage.setItem("sl_current_role", "host");
    }

    nav(`/room/${encodeURIComponent(room)}`);
  }

  const streamingPercent =
    usageData && usageData.maxStreamingMinutes > 0
      ? (usageData.streamingMinutes / usageData.maxStreamingMinutes) * 100
      : 0;

  const storagePercent =
    usageData && usageData.maxStorage > 0
      ? (usageData.storageUsed / usageData.maxStorage) * 100
      : 0;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#000000",
        color: "#ffffff",
        padding: "24px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* ANIMATED BACKGROUND */}
      <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
        <div
          style={{
            position: "absolute",
            top: "20%",
            right: "15%",
            width: "500px",
            height: "500px",
            background: "rgba(220, 38, 38, 0.15)",
            borderRadius: "50%",
            filter: "blur(120px)",
            animation: "pulse 4s ease-in-out infinite",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "20%",
            left: "15%",
            width: "600px",
            height: "600px",
            background: "rgba(239, 68, 68, 0.1)",
            borderRadius: "50%",
            filter: "blur(150px)",
            animation: "pulse 4s ease-in-out infinite",
            animationDelay: "2s",
          }}
        />
      </div>

      {/* USAGE BANNER - TOP BAR - For all authenticated users */}
      {user && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 30,
            background: "rgba(15, 15, 15, 0.9)",
            backdropFilter: "blur(20px)",
            borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
            padding: "16px 24px",
          }}
        >
          <div
            style={{
              maxWidth: "1200px",
              margin: "0 auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "24px",
              flexWrap: "wrap",
            }}
          >
            {/* Usage Stats */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "32px",
                flexWrap: "wrap",
              }}
            >
              {/* Streaming Minutes */}
              <div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "#6b7280",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom: "4px",
                  }}
                >
                  Streaming Minutes
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{ fontSize: "18px", fontWeight: 700 }}>
                    {usageLoading
                      ? "..."
                      : usageError
                      ? "—"
                      : usageData?.streamingMinutes ?? "—"}
                  </div>
                  <div style={{ fontSize: "13px", color: "#9ca3af" }}>
                    /{" "}
                    {usageLoading
                      ? "..."
                      : usageError
                      ? "—"
                      : usageData?.maxStreamingMinutes ?? "—"}
                  </div>
                </div>
                <div
                  style={{
                    width: "120px",
                    height: "4px",
                    background: "rgba(255, 255, 255, 0.1)",
                    borderRadius: "2px",
                    marginTop: "4px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${streamingPercent}%`,
                      background: "linear-gradient(to right, #dc2626, #ef4444)",
                      borderRadius: "2px",
                    }}
                  />
                </div>
              </div>

              {/* Storage Used */}
              <div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "#6b7280",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom: "4px",
                  }}
                >
                  Storage Used
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{ fontSize: "18px", fontWeight: 700 }}>
                    {usageLoading
                      ? "..."
                      : usageError
                      ? "—"
                      : usageData?.storageUsed ?? "—"}{" "}
                    GB
                  </div>
                  <div style={{ fontSize: "13px", color: "#9ca3af" }}>
                    /{" "}
                    {usageLoading
                      ? "..."
                      : usageError
                      ? "—"
                      : usageData?.maxStorage ?? "—"}{" "}
                    GB
                  </div>
                </div>
                <div
                  style={{
                    width: "120px",
                    height: "4px",
                    background: "rgba(255, 255, 255, 0.1)",
                    borderRadius: "2px",
                    marginTop: "4px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${storagePercent}%`,
                      background: "linear-gradient(to right, #dc2626, #ef4444)",
                      borderRadius: "2px",
                    }}
                  />
                </div>
              </div>

              {/* Plan Badge */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div
                  style={{
                    padding: "6px 12px",
                    background: "rgba(220, 38, 38, 0.2)",
                    border: "1px solid rgba(220, 38, 38, 0.4)",
                    borderRadius: "8px",
                    fontSize: "12px",
                    fontWeight: 600,
                    textTransform: "uppercase",
                  }}
                >
                  {usageLoading
                    ? "Loading..."
                    : usageError
                    ? "—"
                    : usageData?.planId
                    ? `${usageData.planId} Plan`
                    : "—"}
                </div>

                {/* Upgrade button removed */}
              </div>

              {/* Error message under usage stats */}
              {/* Only show Admin Dashboard button for actual admins. No fallback for non-admins. */}
              {usageError && (
                <button
                  style={{
                    marginTop: "8px",
                    background: "rgba(220, 38, 38, 0.15)",
                    border: "1px solid #ef4444",
                    color: "#ef4444",
                    borderRadius: "6px",
                    padding: "6px 16px",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                  disabled
                  title={usageError}
                >
                  {usageError}
                </button>
              )}
            </div>

            {/* Right side actions */}
<div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
  {/* Settings & Billing button, always visible to logged-in users */}
  <button
    onClick={() => nav("/settings/billing")}
    style={{
      fontSize: "13px",
      padding: "8px 16px",
      background: "rgba(255,255,255,0.05)",
      border: "1px solid rgba(255,255,255,0.2)",
      color: "#fff",
      borderRadius: "8px",
      fontWeight: 600,
      cursor: "pointer",
      whiteSpace: "nowrap",
      transition: "all 0.3s ease",
    }}
    onMouseEnter={e => {
      e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
      e.currentTarget.style.borderColor = 'rgba(34,197,94,0.6)';
    }}
    onMouseLeave={e => {
      e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
    }}
  >
    ⚙️ Settings & Billing
  </button>

  {/* Admin Dashboard button (admin only) */}
  {!adminLoading && isAdmin === true && (
    <button
      onClick={() => nav("/admin/dashboard")}
      style={{
        fontSize: "13px",
        padding: "8px 16px",
        background: "rgba(220, 38, 38, 0.15)",
        border: "1px solid rgba(220, 38, 38, 0.5)",
        borderRadius: "8px",
        color: "#ef4444",
        cursor: "pointer",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      🛠 Admin Dashboard
    </button>
  )}

  {/* My Content button */}
  <button
    onClick={() => setShowEditingModal(true)}
    style={{
      fontSize: "13px",
      padding: "8px 16px",
      background: "rgba(220, 38, 38, 0.1)",
      border: "1px solid rgba(220, 38, 38, 0.4)",
      borderRadius: "8px",
      color: "#ef4444",
      cursor: "pointer",
      whiteSpace: "nowrap",
      transition: "all 0.3s ease",
      fontWeight: 500,
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.background = "rgba(220, 38, 38, 0.2)";
      e.currentTarget.style.borderColor = "rgba(220, 38, 38, 0.8)";
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = "rgba(220, 38, 38, 0.1)";
      e.currentTarget.style.borderColor = "rgba(220, 38, 38, 0.4)";
    }}
  >
    🎬 My Content
  </button>
</div>

              
      </div>
    </div>
  )}


      <div
        style={{
          position: "relative",
          zIndex: 10,
          width: "100%",
          maxWidth: "480px",
          marginTop: isParticipant ? "0px" : "80px",
        }}
      >
        {/* LOGO */}
        <div style={{ marginBottom: "32px", textAlign: "center" }}>
          <img
            src="/logo.png"
            alt="StreamLine Logo"
            style={{
              width: "320px",
              height: "320px",
              margin: "0 auto",
              filter: "drop-shadow(0 0 25px rgba(220, 38, 38, 0.5))",
            }}
          />
        </div>

        {/* WELCOME MESSAGE */}
        {user && (
          <div style={{ marginBottom: "32px", textAlign: "center" }}>
            <h2
              style={{
                fontSize: "28px",
                fontWeight: 700,
                marginBottom: "8px",
                background: "linear-gradient(to right, #ffffff, #fecaca, #ffffff)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Welcome back, {user.displayName || user.email}! 👋
            </h2>
            {user.defaultResolution && (
              <p style={{ fontSize: "14px", color: "#6b7280" }}>
                Default resolution: {user.defaultResolution}
              </p>
            )}
          </div>
        )}

        {!user && (
          <div style={{ marginBottom: "32px", textAlign: "center" }}>
            <h1
              style={{
                fontSize: "32px",
                fontWeight: 700,
                marginBottom: "8px",
                background: "linear-gradient(to right, #ffffff, #fecaca, #ffffff)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Create or Join Room
            </h1>
            <p style={{ fontSize: "16px", color: "#9ca3af" }}>
              Start streaming in seconds
            </p>
          </div>
        )}

        {/* FORM CONTAINER */}
        <div
          style={{
            background: "rgba(15, 15, 15, 0.7)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            borderRadius: "20px",
            padding: "32px",
            marginBottom: "24px",
          }}
        >
          <form onSubmit={handleSubmit}>
            {/* DISPLAY NAME */}
            <div style={{ marginBottom: "20px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "#9ca3af",
                  marginBottom: "8px",
                }}
              >
                Your Name
              </label>
              <input
                type="text"
                placeholder="Enter your display name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                style={{
                  width: "100%",
                  padding: "14px 16px",
                  background: "rgba(0, 0, 0, 0.4)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "12px",
                  color: "#ffffff",
                  fontSize: "15px",
                  outline: "none",
                }}
              />
            </div>

            {/* ROOM NAME */}
            {!searchParams.get("room") && (
              <div style={{ marginBottom: "24px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "#9ca3af",
                    marginBottom: "8px",
                  }}
                >
                  Room Name
                </label>
                <input
                  type="text"
                  placeholder="Enter room name"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  required
                  style={{
                    width: "100%",
                    padding: "14px 16px",
                    background: "rgba(0, 0, 0, 0.4)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: "12px",
                    color: "#ffffff",
                    fontSize: "15px",
                    outline: "none",
                  }}
                />
              </div>
            )}

            {/* SUBMIT BUTTON */}
            <button
              type="submit"
              style={{
                width: "100%",
                padding: "16px",
                background: "linear-gradient(to right, #dc2626, #ef4444)",
                color: "#ffffff",
                border: "none",
                borderRadius: "12px",
                fontSize: "16px",
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 8px 32px rgba(220, 38, 38, 0.3)",
                transition: "all 0.3s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background =
                  "linear-gradient(to right, #ef4444, #f87171)";
                e.currentTarget.style.transform = "translateY(-2px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background =
                  "linear-gradient(to right, #dc2626, #ef4444)";
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              Enter Room
            </button>
          </form>
        </div>

        {/* LOGOUT BUTTON */}
        <div style={{ textAlign: "center" }}>
          <button
            onClick={() => {
              localStorage.removeItem("sl_displayName");
              window.location.href = "/";
            }}
            style={{
              fontSize: "13px",
              padding: "8px 16px",
              border: "1px solid rgba(220, 38, 38, 0.5)",
              background: "transparent",
              color: "#ef4444",
              borderRadius: "8px",
              cursor: "pointer",
              transition: "all 0.3s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(220, 38, 38, 0.2)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Editing Suite Coming Soon Modal */}
      {showEditingModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            backdropFilter: "blur(8px)",
          }}
          onClick={() => setShowEditingModal(false)}
        >
          <div
            style={{
              background:
                "linear-gradient(135deg, rgba(20, 20, 30, 0.95), rgba(30, 30, 40, 0.95))",
              border: "1px solid rgba(220, 38, 38, 0.3)",
              borderRadius: "16px",
              padding: "2rem",
              maxWidth: "400px",
              width: "90%",
              textAlign: "center",
              backdropFilter: "blur(16px)",
              boxShadow:
                "0 25px 50px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1) inset",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🎬</div>
            <h2
              style={{
                fontSize: "1.5rem",
                fontWeight: "bold",
                marginBottom: "1rem",
                background: "linear-gradient(135deg, #ffffff, #f0f0f0)",
                backgroundClip: "text",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Editing Suite
            </h2>
            <p
              style={{
                color: "rgba(255, 255, 255, 0.8)",
                marginBottom: "1.5rem",
                lineHeight: "1.6",
              }}
            >
              Our powerful video editing suite is coming soon! For now, you can
              stream and download your recordings.
            </p>
            <button
              onClick={() => setShowEditingModal(false)}
              style={{
                padding: "0.75rem 1.5rem",
                background: "linear-gradient(135deg, #dc2626, #ef4444)",
                border: "none",
                borderRadius: "8px",
                color: "#ffffff",
                fontWeight: "600",
                cursor: "pointer",
                transition: "all 0.3s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background =
                  "linear-gradient(135deg, #b91c1c, #dc2626)";
                e.currentTarget.style.transform = "translateY(-2px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background =
                  "linear-gradient(135deg, #dc2626, #ef4444)";
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              Got it!
            </button>
          </div>
        </div>
      )}

      {/* CSS ANIMATIONS */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.15; transform: scale(1); }
          50% { opacity: 0.25; transform: scale(1.05); }
        }
      `}</style>
    </div>
  );
}
