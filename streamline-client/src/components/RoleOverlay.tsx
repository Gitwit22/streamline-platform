import React from "react";
import { useParticipants } from "@livekit/components-react";

const API_BASE = import.meta.env.VITE_API_BASE || "";

type Role = "host" | "moderator" | "participant";

export default function RoleOverlay({
  open,
  onClose,
  role,
  roomName,
}: {
  open: boolean;
  onClose: () => void;
  role: Role;
  roomName: string;
}) {
  if (!open) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '80px',
      left: '20px',
      zIndex: 9999,
      pointerEvents: 'auto'
    }}>
      {/* Floating Menu Card */}
      <div style={{
        background: 'rgba(20, 20, 20, 0.98)',
        borderRadius: '0.75rem',
        border: '1px solid rgba(220, 38, 38, 0.5)',
        backdropFilter: 'blur(20px)',
        boxShadow: '0 20px 60px rgba(220, 38, 38, 0.2)',
        width: '320px',
        maxHeight: '50vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        color: '#ffffff'
      }}>
        {/* Header */}
        <div style={{
          padding: '1rem',
          borderBottom: '2px solid rgba(220, 38, 38, 0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, rgba(220, 38, 38, 0.1), rgba(239, 68, 68, 0.05))'
        }}>
          <div>
            <div style={{ fontWeight: '700', fontSize: '0.95rem', color: '#ef4444', letterSpacing: '0.5px' }}>
              {role === 'host' ? 'DASHBOARD' : role.toUpperCase()}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(220, 38, 38, 0.2)',
              border: '1px solid rgba(220, 38, 38, 0.5)',
              borderRadius: '0.375rem',
              color: '#ef4444',
              padding: '0.4rem 0.6rem',
              cursor: 'pointer',
              fontSize: '1.25rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '32px',
              height: '32px',
              transition: 'all 0.3s ease',
              fontWeight: 'bold'
            }}
            onMouseEnter={(e) => {
              const target = e.target as HTMLButtonElement;
              target.style.background = 'rgba(220, 38, 38, 0.4)';
              target.style.borderColor = 'rgba(220, 38, 38, 0.8)';
              target.style.boxShadow = '0 0 15px rgba(220, 38, 38, 0.3)';
            }}
            onMouseLeave={(e) => {
              const target = e.target as HTMLButtonElement;
              target.style.background = 'rgba(220, 38, 38, 0.2)';
              target.style.borderColor = 'rgba(220, 38, 38, 0.5)';
              target.style.boxShadow = 'none';
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{
          padding: '1rem',
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem'
        }}>
          {role === "host" && <HostPanel roomName={roomName} />}
          {role === "moderator" && <ModeratorPanel roomName={roomName} />}
          {role === "participant" && <ParticipantPanel roomName={roomName} />}
        </div>
      </div>
    </div>
  );

}

function HostPanel({ roomName }: { roomName: string }) {
  const parts = useParticipants();
  return (
    <>
      <Section title="Live Participants">
        <ParticipantList
          participants={parts}
          onRemove={(id) => apiRemove(roomName, id)}
          canModerate
        />

        {/* Removed Mute / Unmute all controls */}
      </Section>

      <Section title="Greenroom (Coming Soon)">
        <p style={{ fontSize: '0.875rem', opacity: 0.7, color: 'rgba(255, 255, 255, 0.7)', lineHeight: 1.5 }}>
          Admit/Reject guests from a separate lobby room.
        </p>
      </Section>

      <Section title="Overlays (MVP)">
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            style={{
              borderRadius: '0.375rem',
              border: '1px solid rgba(220, 38, 38, 0.5)',
              padding: '0.375rem 0.75rem',
              fontSize: '0.75rem',
              background: 'linear-gradient(135deg, #dc2626, #b91c1c)',
              color: '#ffffff',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              fontWeight: '600'
            }}
            onMouseEnter={(e) => {
              const target = e.target as HTMLButtonElement;
              target.style.background = 'linear-gradient(135deg, #b91c1c, #991b1b)';
              target.style.boxShadow = '0 0 10px rgba(220, 38, 38, 0.3)';
            }}
            onMouseLeave={(e) => {
              const target = e.target as HTMLButtonElement;
              target.style.background = 'linear-gradient(135deg, #dc2626, #b91c1c)';
              target.style.boxShadow = 'none';
            }}
            onClick={() => alert("Show lower-third (stub)")}
          >
            Show Lower Third
          </button>
          <button
            style={{
              borderRadius: '0.375rem',
              border: '1px solid rgba(75, 85, 99, 0.5)',
              padding: '0.375rem 0.75rem',
              fontSize: '0.75rem',
              background: 'rgba(75, 85, 99, 0.2)',
              color: '#ffffff',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              fontWeight: '600'
            }}
            onMouseEnter={(e) => {
              const target = e.target as HTMLButtonElement;
              target.style.background = 'rgba(75, 85, 99, 0.4)';
              target.style.borderColor = 'rgba(75, 85, 99, 0.8)';
            }}
            onMouseLeave={(e) => {
              const target = e.target as HTMLButtonElement;
              target.style.background = 'rgba(75, 85, 99, 0.2)';
              target.style.borderColor = 'rgba(75, 85, 99, 0.5)';
            }}
            onClick={() => alert("Hide lower-third (stub)")}
          >
            Hide
          </button>
        </div>
      </Section>
    </>
  );
}

function ModeratorPanel({ roomName }: { roomName: string }) {
  const parts = useParticipants();
  return (
    <>
      <Section title="Moderation">
        <p className="text-sm opacity-70">
          Mute/Remove participants. Host defines permissions.
        </p>
      </Section>
      <Section title="Live Participants">
        <ParticipantList
          participants={parts}
          
          onRemove={(id) => apiRemove(roomName, id)}
          canModerate
        />
      </Section>
    </>
  );
}

function ParticipantPanel({ roomName }: { roomName: string }) {
  return (
    <>
      <Section title="Info">
        <p style={{ fontSize: '0.875rem', opacity: 0.8, color: 'rgba(255, 255, 255, 0.8)', lineHeight: 1.5 }}>
          You're in <b>{roomName}</b>. Use the control bar to toggle mic/cam or
          share your screen.
        </p>
      </Section>
      <Section title="Tips">
        <ul style={{ listStyle: 'disc', paddingLeft: '1.25rem', fontSize: '0.875rem', opacity: 0.8, color: 'rgba(255, 255, 255, 0.8)', lineHeight: 1.6 }}>
          <li>Use headphones to avoid echo.</li>
          <li>Mute when not speaking.</li>
          <li>Use chat for links and quick notes.</li>
        </ul>
      </Section>
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div style={{ fontSize: '0.875rem', fontWeight: '600', marginBottom: '0.5rem', color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{title}</div>
      <div style={{ borderRadius: '0.375rem', border: '1px solid rgba(220, 38, 38, 0.2)', padding: '0.75rem', background: 'rgba(31, 41, 55, 0.3)', color: 'rgba(255, 255, 255, 0.9)' }}>{children}</div>
    </div>
  );
}

function ParticipantList({
  participants,
  canModerate,
  // onMute removed
  onRemove,
}: {
  participants: ReturnType<typeof useParticipants>;
  canModerate?: boolean;
  // onMute removed
  onRemove?: (identity: string) => void;
}) {
  if (!participants?.length) {
    return <p style={{ fontSize: '0.875rem', opacity: 0.7, color: 'rgba(255, 255, 255, 0.7)' }}>No one here yet.</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {participants.map((p) => (
        <div
          key={p.identity}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderRadius: '0.375rem',
            border: '1px solid rgba(75, 85, 99, 0.3)',
            padding: '0.5rem',
            background: 'rgba(31, 41, 55, 0.2)',
            gap: '0.5rem'
          }}
        >
          <div style={{ fontSize: '0.875rem' }}>
            <div style={{ fontWeight: '600', color: '#ffffff' }}>{p.name || p.identity}</div>
            <div style={{ opacity: 0.6, fontSize: '0.75rem', wordBreak: 'break-all', color: 'rgba(255, 255, 255, 0.6)' }}>
              {p.identity}
            </div>
          </div>
          {canModerate && (
            <div style={{ display: 'flex', gap: '0.25rem' }}>
              {/* Mute/Unmute participant buttons removed. Use local controls only. */}
              <button
                style={{
                  borderRadius: '0.25rem',
                  border: '1px solid rgba(220, 38, 38, 0.5)',
                  padding: '0.25rem 0.5rem',
                  fontSize: '0.7rem',
                  background: 'linear-gradient(135deg, #dc2626, #b91c1c)',
                  color: '#ffffff',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  fontWeight: '600'
                }}
                onMouseEnter={(e) => {
                  const target = e.target as HTMLButtonElement;
                  target.style.background = 'linear-gradient(135deg, #b91c1c, #991b1b)';
                  target.style.boxShadow = '0 0 8px rgba(220, 38, 38, 0.3)';
                }}
                onMouseLeave={(e) => {
                  const target = e.target as HTMLButtonElement;
                  target.style.background = 'linear-gradient(135deg, #dc2626, #b91c1c)';
                  target.style.boxShadow = 'none';
                }}
                onClick={() => onRemove?.(p.identity)}
              >
                Remove
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}



async function apiRemove(room: string, identity: string) {
  try {
    const res = await fetch(`${API_BASE}/api/admin/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room, identity }),
    });

    let data: any = null;
    try {
      data = await res.json();
    } catch {
      // ignore JSON parse errors
    }

    if (!res.ok || (data && data.error)) {
      console.error("remove failed", { status: res.status, data });
      alert((data && data.error) || `Remove failed (HTTP ${res.status})`);
      return;
    }

    console.log("remove success", data);
  } catch (e) {
    console.error("remove failed (network)", e);
    alert("Remove request failed (network error)");
  }
}
