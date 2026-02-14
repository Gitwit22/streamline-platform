import { useNavigate } from "react-router-dom";

export default function MyContentDisabled() {
  const nav = useNavigate();

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0f0f0f 0%, #1a0a0a 100%)",
        color: "#fff",
        padding: "2rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          maxWidth: 720,
          width: "100%",
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(0,0,0,0.35)",
          padding: 24,
        }}
      >
        <h1 style={{ margin: 0, marginBottom: 8, fontSize: 22, fontWeight: 800 }}>My Content isn’t enabled</h1>
        <p style={{ margin: 0, color: "rgba(255,255,255,0.8)", lineHeight: 1.5 }}>
          This area is currently disabled on this platform. If you expected to see recordings here, an admin needs to
          enable the My Content feature flags.
        </p>

        <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
          <button
            onClick={() => nav("/join")}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(255,255,255,0.06)",
              color: "#fff",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            ← Back to Join
          </button>
          <button
            onClick={() => nav("/settings/billing")}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "none",
              background: "linear-gradient(135deg, #dc2626, #ef4444)",
              color: "#fff",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            Open Settings
          </button>
        </div>

        <div style={{ marginTop: 16, fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
          Tip: Enable `featureFlags/myContentEnabled` and `featureFlags/myContentRecordingsEnabled` in Firestore.
        </div>
      </div>
    </div>
  );
}
