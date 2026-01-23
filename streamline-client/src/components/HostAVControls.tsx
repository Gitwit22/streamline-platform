import { useLocalParticipant } from "@livekit/components-react";

type GuestStatus = "viewing_join" | "entered_room" | null;

export function HostAVControls({ guestStatus }: { guestStatus?: GuestStatus }) {
  const { localParticipant } = useLocalParticipant();

  if (!localParticipant) return null;

  const micOn = localParticipant.isMicrophoneEnabled;
  const camOn = localParticipant.isCameraEnabled;

  const perms: any = (localParticipant as any).permissions || (localParticipant as any).participant?.permissions;
  const sources: string[] = Array.isArray(perms?.canPublishSources) ? perms.canPublishSources : [];
  const canPublish = perms?.canPublish !== false;

  const canMic = canPublish && (sources.length === 0 || sources.includes("microphone"));
  const canCam = canPublish && (sources.length === 0 || sources.includes("camera"));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 8 }}>
      <button
        onClick={() => {
          if (!canMic) return;
          localParticipant.setMicrophoneEnabled(!micOn);
        }}
        style={{
          padding: "0.5rem 1.2rem",
          borderRadius: "0.5rem",
          background: !canMic ? "#1f2933" : micOn ? "#dc2626" : "#374151",
          color: "#fff",
          border: "none",
          fontWeight: 600,
          cursor: canMic ? "pointer" : "not-allowed",
          opacity: canMic ? 1 : 0.5,
          transition: "all 0.2s"
        }}
        disabled={!canMic}
        title={!canMic ? "Role restriction: mic not allowed" : undefined}
      >
        {micOn ? "Mute Mic" : "Unmute Mic"}
      </button>
      <button
        onClick={() => {
          if (!canCam) return;
          localParticipant.setCameraEnabled(!camOn);
        }}
        style={{
          padding: "0.5rem 1.2rem",
          borderRadius: "0.5rem",
          background: !canCam ? "#1f2933" : camOn ? "#dc2626" : "#374151",
          color: "#fff",
          border: "none",
          fontWeight: 600,
          cursor: canCam ? "pointer" : "not-allowed",
          opacity: canCam ? 1 : 0.5,
          border: "none",
          transition: "all 0.2s"
        }}
        disabled={!canCam}
        title={!canCam ? "Role restriction: cam not allowed" : undefined}
      >
        {camOn ? "Cam Off" : "Cam On"}
      </button>
      </div>
      {guestStatus === "viewing_join" && (
        <div
          style={{
            fontSize: 12,
            color: "#e5e7eb",
            opacity: 0.9,
          }}
        >
          Guest has opened the invite link and is on the join page.
        </div>
      )}
    </div>
  );
}
