import { useLocalParticipant } from "@livekit/components-react";

export function HostAVControls() {
  const { localParticipant } = useLocalParticipant();

  if (!localParticipant) return null;

  const micOn = localParticipant.isMicrophoneEnabled;
  const camOn = localParticipant.isCameraEnabled;

  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
      <button
        onClick={() => localParticipant.setMicrophoneEnabled(!micOn)}
        style={{
          padding: "0.5rem 1.2rem",
          borderRadius: "0.5rem",
          background: micOn ? "#dc2626" : "#374151",
          color: "#fff",
          border: "none",
          fontWeight: 600,
          cursor: "pointer",
          transition: "all 0.2s"
        }}
      >
        {micOn ? "Mute Mic" : "Unmute Mic"}
      </button>
      <button
        onClick={() => localParticipant.setCameraEnabled(!camOn)}
        style={{
          padding: "0.5rem 1.2rem",
          borderRadius: "0.5rem",
          background: camOn ? "#dc2626" : "#374151",
          color: "#fff",
          border: "none",
          fontWeight: 600,
          cursor: "pointer",
          transition: "all 0.2s"
        }}
      >
        {camOn ? "Cam Off" : "Cam On"}
      </button>
    </div>
  );
}
