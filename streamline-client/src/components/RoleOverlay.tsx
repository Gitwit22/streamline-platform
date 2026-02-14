import React from "react";
import { useParticipants, useLocalParticipant, useRoomContext } from "@livekit/components-react";
import { normalizeUiRolePresetId } from "../lib/roles";
import { apiFetchAuth } from "../lib/api";
import { encodeReconnectMediaMessage, reconnectMedia } from "../lib/mediaRecovery";

// Normalize API base to avoid trailing slashes that cause "//api/..." URLs
const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

type Role = "host" | "participant" | "moderator";
type RolePresetId = "participant" | "cohost";

function extractRolePresetId(rawParticipant: any): RolePresetId | null {
  // Preferred: explicit parsed identity metadata (some parts of the app attach this).
  const identityMeta = rawParticipant?.identityMetadata;
  if (identityMeta && typeof identityMeta === "object") {
    const v = (identityMeta as any)?.rolePresetId;
    if (v === "cohost" || v === "participant") return v;
  }

  // LiveKit's `metadata` is typically a JSON string. Some wrappers may already
  // parse it into an object, so support both.
  const meta = rawParticipant?.metadata;
  if (meta && typeof meta === "object") {
    const v = (meta as any)?.rolePresetId;
    if (v === "cohost" || v === "participant") return v;
  }
  if (typeof meta === "string" && meta.trim()) {
    try {
      const parsed = JSON.parse(meta);
      const v = parsed?.rolePresetId;
      if (v === "cohost" || v === "participant") return v;
    } catch {
      // ignore
    }
  }

  return null;
}

export default function RoleOverlay({
  open,
  onClose,
  role,
  roomName,
  roomId,
  roomAccessToken,
  canMuteGuests,
  canRemoveGuests,
  canModerate,
  advancedRolesEnabled,
  greenroomEnabled,
  overlaysEnabled,
}: {
  open: boolean;
  onClose: () => void;
  role: Role;
  roomName: string;
  roomId: string;
  roomAccessToken: string;
  canMuteGuests?: boolean;
  canRemoveGuests?: boolean;
  canModerate?: boolean;
  advancedRolesEnabled?: boolean;
  greenroomEnabled?: boolean;
  overlaysEnabled?: boolean;
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
        width: '420px',
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
          {(role === "host" || role === "moderator") && (
            <HostPanel
              roomName={roomName}
              roomId={roomId}
              roomAccessToken={roomAccessToken}
              canMuteGuests={canMuteGuests}
              canRemoveGuests={canRemoveGuests}
              canModerate={canModerate}
              advancedRolesEnabled={advancedRolesEnabled}
              greenroomEnabled={greenroomEnabled}
              overlaysEnabled={overlaysEnabled}
            />
          )}
          {role === "participant" && (
            <ParticipantPanel roomName={roomName} roomId={roomId} roomAccessToken={roomAccessToken} />
          )}
        </div>
      </div>
    </div>
  );

}

function HostPanel({
  roomName,
  roomId,
  roomAccessToken,
  canMuteGuests,
  canRemoveGuests,
  canModerate,
  advancedRolesEnabled,
  greenroomEnabled,
  overlaysEnabled,
}: {
  roomName: string;
  roomId: string;
  roomAccessToken: string;
  canMuteGuests?: boolean;
  canRemoveGuests?: boolean;
  canModerate?: boolean;
  advancedRolesEnabled?: boolean;
  greenroomEnabled?: boolean;
  overlaysEnabled?: boolean;
}) {
  const parts = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  const [muteLock, setMuteLock] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [mediaBusy, setMediaBusy] = React.useState(false);
  const [roleToast, setRoleToast] = React.useState<string | null>(null);
  const roleToastTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [roleByIdentity, setRoleByIdentity] = React.useState<Record<string, RolePresetId>>({});
  const [roleStatus, setRoleStatus] = React.useState<Record<string, "saving" | "saved">>({});

  const [deviceModalOpen, setDeviceModalOpen] = React.useState(false);
  const [audioInputs, setAudioInputs] = React.useState<Array<{ deviceId: string; label: string }>>([]);
  const [videoInputs, setVideoInputs] = React.useState<Array<{ deviceId: string; label: string }>>([]);
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = React.useState<string>("");
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = React.useState<string>("");

  const localDisplayName = React.useMemo(() => {
    const lkName = (localParticipant as any)?.name as string | undefined;
    const n = typeof lkName === "string" ? lkName.trim() : "";
    if (n) return n;
    try {
      const cached = localStorage.getItem("sl_displayName");
      const c = typeof cached === "string" ? cached.trim() : "";
      if (c) return c;
    } catch {
      // ignore
    }
    return "";
  }, [localParticipant]);

  const loadDevices = React.useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    const mics = all
      .filter((d) => d.kind === "audioinput")
      .map((d) => ({ deviceId: d.deviceId, label: d.label || "Microphone" }));
    const cams = all
      .filter((d) => d.kind === "videoinput")
      .map((d) => ({ deviceId: d.deviceId, label: d.label || "Camera" }));
    setAudioInputs(mics);
    setVideoInputs(cams);
    if (!selectedAudioDeviceId && mics[0]?.deviceId) setSelectedAudioDeviceId(mics[0].deviceId);
    if (!selectedVideoDeviceId && cams[0]?.deviceId) setSelectedVideoDeviceId(cams[0].deviceId);
  }, [selectedAudioDeviceId, selectedVideoDeviceId]);

  const handleReconnectSelf = async () => {
    if (!room) return;
    setMediaBusy(true);
    try {
      await reconnectMedia(room);
    } finally {
      setMediaBusy(false);
    }
  };

  const handleOpenDeviceModal = async () => {
    try {
      await loadDevices();
    } catch {
      // ignore
    }
    setDeviceModalOpen(true);
  };

  const handleReconnectWithDevices = async () => {
    if (!room) return;
    setMediaBusy(true);
    try {
      await reconnectMedia(room, {
        audioDeviceId: selectedAudioDeviceId || undefined,
        videoDeviceId: selectedVideoDeviceId || undefined,
      });
      setDeviceModalOpen(false);
    } finally {
      setMediaBusy(false);
    }
  };

  const handleReconnectGuest = async (identity: string) => {
    try {
      const lp: any = room?.localParticipant || localParticipant;
      if (!lp?.publishData) return;
      const data = encodeReconnectMediaMessage();
      await lp.publishData(data, { reliable: true, destinationIdentities: [identity] });
    } catch {
      // ignore
    }
  };

  // Load initial muteLock state for this room
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetchAuth(`${API_BASE}/api/roomSettings/${encodeURIComponent(roomName)}`, {}, { allowNonOk: true });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setMuteLock(!!data.muteLock);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomName]);

  const handleMuteAllExceptHost = async () => {
    if (!roomName || !roomAccessToken) return;
    setBusy(true);
    try {
      await apiMuteAll(roomName, true, roomAccessToken);
      const hostId = localParticipant?.identity;
      if (hostId) {
        await apiMute(roomName, hostId, false, roomAccessToken);
      }
    } catch (e) {
      console.error("mute-all-except-host failed", e);
      alert("Failed to mute all participants");
    } finally {
      setBusy(false);
    }
  };

  const handleToggleMuteLock = async () => {
    const next = !muteLock;
    setBusy(true);
    try {
      if (next) {
        // When enabling lock, first mute everyone except host
        await handleMuteAllExceptHost();
      }
      const hostId = localParticipant?.identity;
      if (!roomAccessToken) return;
      const res = await apiSetMuteLock(roomName, next, hostId, roomAccessToken);
      setMuteLock(!!res.muteLock);
    } catch (e) {
      console.error("mute-lock toggle failed", e);
      alert("Failed to update mute lock");
    } finally {
      setBusy(false);
    }
  };

  const handleChangeRole = async (identity: string, presetId: RolePresetId) => {
    if (!roomId || !roomAccessToken) return;

    setRoleStatus((prev) => ({ ...prev, [identity]: "saving" }));

    try {
      const result = await apiSetRole(roomId, roomAccessToken, identity, presetId);

      const nextRole =
        result && result.roleId && (result.roleId === "participant" || result.roleId === "cohost")
          ? (result.roleId as RolePresetId)
          : presetId;

      setRoleByIdentity((prev) => ({ ...prev, [identity]: nextRole }));
      setRoleStatus((prev) => ({ ...prev, [identity]: "saved" }));

      // Show a small global toast inside the dashboard for extra feedback.
      setRoleToast("Role updated");
      if (roleToastTimeoutRef.current) {
        clearTimeout(roleToastTimeoutRef.current);
      }
      roleToastTimeoutRef.current = setTimeout(() => {
        setRoleToast(null);
        roleToastTimeoutRef.current = null;
      }, 2000);

      // Clear the "Saved" label after a short delay; underlying metadata will reflect the change.
      setTimeout(() => {
        setRoleStatus((prev) => {
          const next = { ...prev };
          if (next[identity] === "saved") {
            delete next[identity];
          }
          return next;
        });
      }, 1500);
    } catch (e: any) {
      console.error("role change failed", e);
      alert(e?.message || "Role change failed");
      setRoleStatus((prev) => {
        const next = { ...prev };
        delete next[identity];
        return next;
      });
    }
  };
  return (
    <>
      <Section title="Audio & Video">
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={handleReconnectSelf}
            disabled={mediaBusy}
            style={{
              flex: 1,
              borderRadius: '0.375rem',
              border: '1px solid rgba(220, 38, 38, 0.6)',
              padding: '0.35rem 0.75rem',
              fontSize: '0.75rem',
              background: mediaBusy ? 'rgba(220, 38, 38, 0.4)' : 'linear-gradient(135deg, #dc2626, #b91c1c)',
              color: '#ffffff',
              cursor: mediaBusy ? 'not-allowed' : 'pointer',
              fontWeight: 700,
            }}
            title="Stops and re-acquires your mic/cam (manual control)"
          >
            {mediaBusy ? 'Reconnecting…' : 'Reconnect media'}
          </button>
          <button
            onClick={handleOpenDeviceModal}
            disabled={mediaBusy}
            style={{
              borderRadius: '0.375rem',
              border: '1px solid rgba(148, 163, 184, 0.6)',
              padding: '0.35rem 0.75rem',
              fontSize: '0.75rem',
              background: 'rgba(31, 41, 55, 0.9)',
              color: '#e5e7eb',
              cursor: mediaBusy ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              opacity: mediaBusy ? 0.6 : 1,
            }}
          >
            Choose device
          </button>
        </div>
        <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'rgba(248, 250, 252, 0.7)', lineHeight: 1.45 }}>
          Manual-only. No room overlays or banners.
        </p>
      </Section>

      <Section title="Live Participants">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', gap: '0.5rem' }}>
          <button
            onClick={handleMuteAllExceptHost}
            disabled={busy}
            style={{
              flex: 1,
              borderRadius: '0.375rem',
              border: '1px solid rgba(220, 38, 38, 0.6)',
              padding: '0.25rem 0.5rem',
              fontSize: '0.75rem',
              background: busy ? 'rgba(220, 38, 38, 0.4)' : 'linear-gradient(135deg, #dc2626, #b91c1c)',
              color: '#ffffff',
              cursor: busy ? 'not-allowed' : 'pointer',
              fontWeight: 600
            }}
          >
            {busy ? "Muting..." : "Mute All Except Host"}
          </button>
          <button
            onClick={handleToggleMuteLock}
            disabled={busy}
            style={{
              borderRadius: '9999px',
              border: muteLock ? '1px solid rgba(220, 38, 38, 0.9)' : '1px solid rgba(148, 163, 184, 0.7)',
              padding: '0.25rem 0.75rem',
              fontSize: '0.7rem',
              background: muteLock ? 'rgba(220, 38, 38, 0.2)' : 'rgba(31, 41, 55, 0.5)',
              color: muteLock ? '#fecaca' : '#e5e7eb',
              cursor: busy ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem'
            }}
          >
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '9999px',
              background: muteLock ? '#ef4444' : '#9ca3af'
            }} />
            {muteLock ? 'Mute Lock On' : 'Mute Lock Off'}
          </button>
        </div>
        <ParticipantList
          participants={parts}
          onRemove={(id) => apiRemove(roomName, id, roomAccessToken)}
          onMute={(id, muted) => apiMute(roomName, id, muted, roomAccessToken)}
          onReconnectGuest={handleReconnectGuest}
          canModerate={!!canModerate}
          muteLock={muteLock}
          localIdentity={localParticipant?.identity || null}
          canMuteGuests={canMuteGuests}
          canRemoveGuests={canRemoveGuests}
          canChangeRoles={!!roomId && !!roomAccessToken}
          onChangeRole={handleChangeRole}
          roleByIdentity={roleByIdentity}
          roleStatus={roleStatus}
        />

        {muteLock && (
          <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'rgba(248, 250, 252, 0.7)' }}>
            🔒 Mute lock is on. Participants stay muted until you turn this off.
          </p>
        )}
      </Section>

        <ChatPanel
          roomId={roomId}
          roomAccessToken={roomAccessToken}
          displayName={localDisplayName}
          allowEndSession={true}
        />

      {roleToast && (
        <div
          style={{
            marginTop: '0.75rem',
            fontSize: '0.75rem',
            borderRadius: '9999px',
            padding: '0.35rem 0.75rem',
            alignSelf: 'flex-start',
            background: 'rgba(22, 163, 74, 0.12)',
            border: '1px solid rgba(22, 163, 74, 0.6)',
            color: '#bbf7d0',
          }}
        >
          {roleToast}
        </div>
      )}

      {greenroomEnabled && (
        <Section title="Greenroom (Coming Soon)">
          <p style={{ fontSize: '0.875rem', opacity: 0.7, color: 'rgba(255, 255, 255, 0.7)', lineHeight: 1.5 }}>
            Admit/Reject guests from a separate lobby room.
          </p>
        </Section>
      )}

      {overlaysEnabled && (
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
      )}

      {deviceModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setDeviceModalOpen(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 560,
              borderRadius: 14,
              background: 'rgba(17,24,39,0.96)',
              border: '1px solid rgba(255,255,255,0.12)',
              padding: 14,
              color: '#fff',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: '0.9rem', fontWeight: 800, marginBottom: 10, color: '#ef4444' }}>
              Choose device
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ fontSize: '0.75rem', opacity: 0.8, marginBottom: 6 }}>Microphone</div>
                <select
                  value={selectedAudioDeviceId}
                  onChange={(e) => setSelectedAudioDeviceId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.14)',
                    background: 'rgba(0,0,0,0.35)',
                    color: '#fff',
                    fontSize: 12,
                  }}
                >
                  {audioInputs.length === 0 && <option value="">(No microphones found)</option>}
                  {audioInputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div style={{ fontSize: '0.75rem', opacity: 0.8, marginBottom: 6 }}>Camera</div>
                <select
                  value={selectedVideoDeviceId}
                  onChange={(e) => setSelectedVideoDeviceId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.14)',
                    background: 'rgba(0,0,0,0.35)',
                    color: '#fff',
                    fontSize: 12,
                  }}
                >
                  {videoInputs.length === 0 && <option value="">(No cameras found)</option>}
                  {videoInputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button
                onClick={() => setDeviceModalOpen(false)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.14)',
                  background: 'rgba(255,255,255,0.06)',
                  color: 'rgba(255,255,255,0.9)',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleReconnectWithDevices}
                disabled={mediaBusy}
                style={{
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(59,130,246,0.25)',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: mediaBusy ? 'not-allowed' : 'pointer',
                }}
              >
                {mediaBusy ? 'Reconnecting…' : 'Use selected & reconnect'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ParticipantPanel({
  roomName,
  roomId,
  roomAccessToken,
}: {
  roomName: string;
  roomId: string;
  roomAccessToken: string;
}) {
  const { localParticipant } = useLocalParticipant();
  const localDisplayName = React.useMemo(() => {
    const lkName = (localParticipant as any)?.name;
    const n = typeof lkName === "string" ? lkName.trim() : "";
    if (n) return n;
    try {
      const cached = localStorage.getItem("sl_displayName");
      const c = typeof cached === "string" ? cached.trim() : "";
      if (c) return c;
    } catch {
      // ignore
    }
    return "";
  }, [localParticipant]);
  const roleLabel = (() => {
    const raw = extractRolePresetId(localParticipant as any);
    const name = normalizeUiRolePresetId(raw);
    if (name === "cohost") return "You are a Co-host";
    if (name === "participant") return "You are a Participant";
    return null;
  })();
  return (
    <>
      <Section title="Info">
        <p style={{ fontSize: '0.875rem', opacity: 0.8, color: 'rgba(255, 255, 255, 0.8)', lineHeight: 1.5 }}>
          You're in <b>{roomName}</b>. Use the control bar to toggle mic/cam or
          share your screen.
        </p>
        {roleLabel && (
          <p style={{ marginTop: '0.35rem', fontSize: '0.8rem', color: 'rgba(248, 250, 252, 0.85)' }}>
            {roleLabel}
          </p>
        )}
      </Section>

      <ChatPanel
        roomId={roomId}
        roomAccessToken={roomAccessToken}
        displayName={localDisplayName}
        allowEndSession={false}
      />

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

function ChatPanel({
  roomId,
  roomAccessToken,
  displayName,
  allowEndSession,
}: {
  roomId: string;
  roomAccessToken: string;
  displayName?: string;
  allowEndSession: boolean;
}) {
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<
    Array<{ id: string; text: string; createdAtMs: number | null; sender?: { name?: string | null; role?: string | null } }>
  >([]);
  const [draft, setDraft] = React.useState("");
  const bottomRef = React.useRef<HTMLDivElement | null>(null);
  const eventSourceRef = React.useRef<EventSource | null>(null);
  const seenIdsRef = React.useRef<Set<string>>(new Set());

  const loadSessionAndHistory = React.useCallback(async () => {
    if (!roomId || !roomAccessToken) return;
    setLoading(true);
    setError(null);
    try {
      const sessionRes = await apiFetchAuth(
        `${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/chat/session`,
        {
          method: "GET",
          headers: {
            ...(roomAccessToken ? { "x-room-access-token": roomAccessToken } : {}),
          },
        },
        { allowNonOk: true }
      );
      const sessionText = await sessionRes.text();
      const sessionData = sessionText ? JSON.parse(sessionText) : {};
      if (!sessionRes.ok) {
        setError(sessionData?.error || "Failed to load chat session");
        setSessionId(null);
        setMessages([]);
        return;
      }
      const sid = typeof sessionData?.sessionId === "string" ? sessionData.sessionId : null;
      setSessionId(sid);

      if (!sid) {
        setMessages([]);
        return;
      }

      const msgRes = await apiFetchAuth(
        `${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/chat/messages?sessionId=${encodeURIComponent(sid)}&limit=200`,
        {
          method: "GET",
          headers: {
            ...(roomAccessToken ? { "x-room-access-token": roomAccessToken } : {}),
          },
        },
        { allowNonOk: true }
      );
      const msgText = await msgRes.text();
      const msgData = msgText ? JSON.parse(msgText) : {};
      if (!msgRes.ok) {
        setError(msgData?.error || "Failed to load chat messages");
        setMessages([]);
        return;
      }

      const rows = Array.isArray(msgData?.messages) ? msgData.messages : [];
      const next = rows
        .map((m: any) => ({
          id: String(m?.id || ""),
          text: typeof m?.text === "string" ? m.text : "",
          createdAtMs: typeof m?.createdAtMs === "number" ? m.createdAtMs : null,
          sender: m?.sender || undefined,
        }))
        .filter((m: any) => !!m.id);
      setMessages(next);
      const seen = new Set<string>();
      next.forEach((m) => seen.add(m.id));
      seenIdsRef.current = seen;
    } catch (e: any) {
      setError(e?.message || "Failed to load chat");
      setSessionId(null);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [roomId, roomAccessToken]);

  const connectStream = React.useCallback(
    (sid: string) => {
      try {
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }

        // EventSource can't send headers, so we pass the room access token via query param `t`.
        const url = `${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/chat/stream?sessionId=${encodeURIComponent(sid)}&t=${encodeURIComponent(roomAccessToken)}`;
        const es = new EventSource(url);
        eventSourceRef.current = es;

        es.addEventListener("message", (ev: any) => {
          try {
            const payload = JSON.parse(ev?.data || "{}");
            const id = typeof payload?.id === "string" ? payload.id : "";
            if (!id) return;
            if (seenIdsRef.current.has(id)) return;
            seenIdsRef.current.add(id);

            const nextMsg = {
              id,
              text: typeof payload?.text === "string" ? payload.text : "",
              createdAtMs: typeof payload?.createdAtMs === "number" ? payload.createdAtMs : null,
              sender: payload?.sender || undefined,
            };

            setMessages((prev) => prev.concat([nextMsg]));
          } catch {
            // ignore
          }
        });
      } catch {
        // ignore
      }
    },
    [roomId, roomAccessToken]
  );

  const sendMessage = React.useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setError(null);
    try {
      const res = await apiFetchAuth(
        `${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/chat/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(roomAccessToken ? { "x-room-access-token": roomAccessToken } : {}),
          },
          body: JSON.stringify({ text, displayName: displayName || undefined }),
        },
        { allowNonOk: true }
      );
      const raw = await res.text();
      const data = raw ? JSON.parse(raw) : {};
      if (!res.ok) {
        setError(data?.error || "Failed to send message");
        return;
      }
      const sid = typeof data?.sessionId === "string" ? data.sessionId : null;
      if (sid && sid !== sessionId) {
        setSessionId(sid);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to send message");
    }
  }, [draft, roomId, roomAccessToken, displayName, sessionId]);

  const endSession = React.useCallback(async () => {
    if (!allowEndSession) return;
    setError(null);
    try {
      const res = await apiFetchAuth(
        `${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/chat/session/end`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(roomAccessToken ? { "x-room-access-token": roomAccessToken } : {}),
          },
          body: JSON.stringify({}),
        },
        { allowNonOk: true }
      );

      // Only clear local state if server successfully ended the session
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const errorMsg = `Couldn't end chat session. ${res.status} ${text}`;
        setError(errorMsg);
        console.error("[RoleOverlay] endSession failed:", errorMsg);
        return;
      }

      setSessionId(null);
      setMessages([]);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    } catch (e: any) {
      const errorMsg = e?.message || "Failed to end session";
      setError(errorMsg);
      console.error("[RoleOverlay] endSession error:", e);
    }
  }, [allowEndSession, roomId, roomAccessToken]);

  React.useEffect(() => {
    void loadSessionAndHistory();
    return () => {
      try {
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
      } catch {
        // ignore
      }
    };
  }, [loadSessionAndHistory]);

  React.useEffect(() => {
    if (!sessionId) return;
    connectStream(sessionId);
    return () => {
      try {
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
      } catch {
        // ignore
      }
    };
  }, [sessionId, connectStream]);

  React.useEffect(() => {
    try {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    } catch {
      // ignore
    }
  }, [messages.length]);

  return (
    <Section title="Chat">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
            {loading ? "Loading…" : sessionId ? "Session chat" : "Chat not started"}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => void loadSessionAndHistory()}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(255,255,255,0.06)",
                color: "rgba(255,255,255,0.9)",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Refresh
            </button>
            {allowEndSession && (
              <button
                type="button"
                onClick={() => void endSession()}
                style={{
                  padding: "6px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(220,38,38,0.35)",
                  background: "rgba(220,38,38,0.12)",
                  color: "rgba(248,113,113,0.95)",
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                End session
              </button>
            )}
          </div>
        </div>

        {error && <div style={{ fontSize: 12, color: "rgba(248,113,113,0.95)" }}>{String(error)}</div>}

        <div
          style={{
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(15,23,42,0.35)",
            borderRadius: 12,
            padding: 10,
            maxHeight: 180,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {messages.length === 0 ? (
            <div style={{ fontSize: 12, opacity: 0.7 }}>No messages yet.</div>
          ) : (
            messages.map((m) => (
              <div key={m.id} style={{ fontSize: 12, lineHeight: 1.35 }}>
                <span style={{ color: "rgba(255,255,255,0.75)", fontWeight: 700 }}>
                  {(m.sender?.name || m.sender?.role || "Someone") + ": "}
                </span>
                <span style={{ color: "rgba(255,255,255,0.92)" }}>{m.text}</span>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendMessage();
              }
            }}
            placeholder={sessionId ? "Type a message…" : "Chat will start when you send"}
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.06)",
              color: "rgba(255,255,255,0.9)",
              outline: "none",
              fontSize: 13,
            }}
          />
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={!draft.trim()}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(59,130,246,0.20)",
              background: !draft.trim() ? "rgba(59,130,246,0.08)" : "rgba(59,130,246,0.18)",
              color: "rgba(255,255,255,0.95)",
              fontSize: 13,
              fontWeight: 900,
              cursor: !draft.trim() ? "not-allowed" : "pointer",
              opacity: !draft.trim() ? 0.6 : 1,
            }}
          >
            Send
          </button>
        </div>
      </div>
    </Section>
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
  onRemove,
  onMute,
  onReconnectGuest,
  muteLock,
  localIdentity,
  canMuteGuests,
  canRemoveGuests,
  canChangeRoles,
  onChangeRole,
  roleByIdentity,
  roleStatus,
}: {
  participants: ReturnType<typeof useParticipants>;
  canModerate?: boolean;
  onRemove?: (identity: string) => void;
  onMute?: (identity: string, muted: boolean) => void;
  onReconnectGuest?: (identity: string) => void;
  muteLock?: boolean;
  localIdentity?: string | null;
  canMuteGuests?: boolean;
  canRemoveGuests?: boolean;
  canChangeRoles?: boolean;
  onChangeRole?: (identity: string, presetId: RolePresetId) => void;
  roleByIdentity?: Record<string, RolePresetId>;
  roleStatus?: Record<string, "saving" | "saved">;
}) {
  if (!participants?.length) {
    return <p style={{ fontSize: '0.875rem', opacity: 0.7, color: 'rgba(255, 255, 255, 0.7)' }}>No one here yet.</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {participants.map((p) => (
        (() => {
          const stableRole = roleByIdentity && roleByIdentity[p.identity];
          const metaRoleRaw = extractRolePresetId(p as any);
          const metaRole = metaRoleRaw ? normalizeUiRolePresetId(metaRoleRaw) : undefined;
          const currentRole: RolePresetId = (stableRole || metaRole || "participant") as RolePresetId;

          return (
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
          <div style={{ fontSize: '0.875rem', flex: 1 }}>
            <div style={{ fontWeight: '600', color: '#ffffff' }}>{p.name || "Guest"}</div>
            {canModerate && (
              <div
                style={{
                  opacity: 0.6,
                  fontSize: '0.75rem',
                  wordBreak: 'break-all',
                  color: 'rgba(255, 255, 255, 0.6)',
                }}
              >
                {p.identity}
              </div>
            )}
          </div>
          {canModerate && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.25rem',
                alignItems: 'flex-end',
                justifyContent: 'center',
              }}
            >
                {localIdentity && p.identity !== localIdentity && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.15rem' }}>
                    <select
                      className="sl-role-select"
                      value={currentRole}
                      disabled={!canChangeRoles || !onChangeRole}
                      onChange={(e) => {
                        if (!canChangeRoles || !onChangeRole) return;
                        onChangeRole(p.identity, e.target.value as RolePresetId);
                      }}
                      style={{
                        borderRadius: '9999px',
                        border: '1px solid rgba(148, 163, 184, 0.75)',
                        padding: '0.2rem 0.7rem',
                        fontSize: '0.7rem',
                        background: 'radial-gradient(circle at top left, rgba(30, 64, 175, 0.5), rgba(15, 23, 42, 0.95))',
                        color: '#e5e7eb',
                        cursor: !canChangeRoles || !onChangeRole ? 'not-allowed' : 'pointer',
                        opacity: !canChangeRoles || !onChangeRole ? 0.6 : 1,
                        minWidth: '7.5rem',
                      }}
                    >
                      <option value="participant">Participant</option>
                      <option value="cohost">Co-host</option>
                    </select>
                    {roleStatus && roleStatus[p.identity] === 'saving' && (
                      <span style={{ fontSize: '0.65rem', color: 'rgba(148, 163, 184, 0.9)' }}>Saving…</span>
                    )}
                    {roleStatus && roleStatus[p.identity] === 'saved' && (
                      <span style={{ fontSize: '0.65rem', color: 'rgba(34, 197, 94, 0.9)' }}>Saved</span>
                    )}
                  </div>
                )}
              <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'flex-end' }}>
                {onReconnectGuest && localIdentity && p.identity !== localIdentity && (
                  <button
                    style={{
                      borderRadius: '0.25rem',
                      border: '1px solid rgba(148, 163, 184, 0.6)',
                      padding: '0.25rem 0.5rem',
                      fontSize: '0.7rem',
                      background: 'rgba(17, 24, 39, 0.6)',
                      color: '#e5e7eb',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      fontWeight: '600',
                    }}
                    onClick={() => onReconnectGuest(p.identity)}
                    title="Asks this guest to re-acquire their devices"
                  >
                    Reconnect
                  </button>
                )}
                {canMuteGuests !== false && (() => {
                  const micEnabled = (p as any).isMicrophoneEnabled as boolean | undefined;
                  const isMuted = micEnabled === false;
                  const nextMuted = !isMuted; // true to mute, false to unmute

                  return (
                    <button
                      style={{
                        borderRadius: '0.25rem',
                        border: '1px solid rgba(148, 163, 184, 0.6)',
                        padding: '0.25rem 0.5rem',
                        fontSize: '0.7rem',
                        background: muteLock ? 'rgba(55, 65, 81, 0.6)' : 'rgba(31, 41, 55, 0.9)',
                        color: '#e5e7eb',
                        cursor: muteLock ? 'not-allowed' : 'pointer',
                        transition: 'all 0.3s ease',
                        fontWeight: '600',
                        opacity: muteLock ? 0.6 : 1
                      }}
                      disabled={muteLock}
                      onClick={() => {
                        if (muteLock) return;
                        onMute?.(p.identity, nextMuted);
                      }}
                    >
                      {isMuted ? 'Unmute' : 'Mute'}
                    </button>
                  );
                })()}
                {canRemoveGuests !== false && (
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
                )}
              </div>
            </div>
          )}
        </div>
          );
        })()
      ))}
    </div>
  );
}

async function apiRemove(room: string, identity: string, roomAccessToken: string) {
  try {
    const res = await apiFetchAuth(
      `${API_BASE}/api/roomModeration/remove`,
      {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-room-access-token": roomAccessToken,
      },
      body: JSON.stringify({ room, identity }),
      },
      { allowNonOk: true }
    );

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

async function apiMute(_room: string, identity: string, muted: boolean, roomAccessToken: string) {
  try {
    const res = await apiFetchAuth(
      `${API_BASE}/api/roomModeration/mute`,
      {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-room-access-token": roomAccessToken,
      },
      body: JSON.stringify({ room: _room, identity, muted }),
      },
      { allowNonOk: true }
    );

    const data = await res.json().catch(() => null);
    if (!res.ok || (data && data.error)) {
      console.error("mute failed", { status: res.status, data });
      alert((data && data.error) || `Mute failed (HTTP ${res.status})`);
      return;
    }
  } catch (e) {
    console.error("mute failed (network)", e);
    alert("Mute request failed (network error)");
  }
}

async function apiMuteAll(_room: string, muted: boolean, roomAccessToken: string) {
  try {
    const res = await apiFetchAuth(
      `${API_BASE}/api/roomModeration/mute-all`,
      {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-room-access-token": roomAccessToken,
      },
      body: JSON.stringify({ room: _room, muted }),
      },
      { allowNonOk: true }
    );

    const data = await res.json().catch(() => null);
    if (!res.ok || (data && data.error)) {
      console.error("mute-all failed", { status: res.status, data });
      alert((data && data.error) || `Mute-all failed (HTTP ${res.status})`);
      return;
    }
  } catch (e) {
    console.error("mute-all failed (network)", e);
    alert("Mute-all request failed (network error)");
  }
}

async function apiSetMuteLock(
  _room: string,
  muteLock: boolean,
  hostIdentity: string | null,
  roomAccessToken: string,
): Promise<{ muteLock: boolean }> {
  const res = await apiFetchAuth(
    `${API_BASE}/api/roomModeration/mute-lock`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-room-access-token": roomAccessToken,
      },
      body: JSON.stringify({ room: _room, muteLock, hostIdentity }),
    },
    { allowNonOk: true }
  );

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    console.error("mute-lock failed", { status: res.status, data });
    throw new Error(data.error || `Mute-lock failed (HTTP ${res.status})`);
  }
  return { muteLock: !!data.muteLock };
}

async function apiSetRole(
  roomId: string,
  roomAccessToken: string,
  identity: string,
  role: RolePresetId,
): Promise<{ roleId?: string } | null> {
  const res = await apiFetchAuth(
    `${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/participants/${encodeURIComponent(identity)}/permissions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-room-access-token": roomAccessToken,
      },
      body: JSON.stringify({ roleId: role }),
    },
    { allowNonOk: true }
  );

  const data = await res.json().catch(() => null);
  if (!res.ok || (data && (data as any).error)) {
    console.error("set-role failed", { status: res.status, data });
    throw new Error(((data as any) && (data as any).error) || `Role change failed (HTTP ${res.status})`);
  }

  if (data && typeof (data as any).roleId === "string") {
    return { roleId: (data as any).roleId as string };
  }

  return null;
}
