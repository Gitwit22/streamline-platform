import { useState } from "react";

type InviteRole = "guest" | "moderator" | "cohost";

interface ModeratorPermissions {
  canMute: boolean;
  canRemove: boolean;
  canMuteAll: boolean;
  isVisible: boolean;
}

interface InviteMenuProps {
  roomName: string;
}

export default function InviteMenu({ roomName }: InviteMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);
  const [permissions, setPermissions] = useState<ModeratorPermissions>({
    canMute: true,
    canRemove: false,
    canMuteAll: true,
    isVisible: true
  });

  const generateInviteUrl = (role: InviteRole) => {
    const baseUrl = `${window.location.origin}/join?room=${encodeURIComponent(roomName)}`;
    
    if (role === "guest") {
      return baseUrl;
    }
    
    if (role === "moderator") {
      // Encode permissions in URL
      const perms = [
        permissions.canMute ? 'mute' : '',
        permissions.canRemove ? 'remove' : '',
        permissions.canMuteAll ? 'muteall' : '',
        permissions.isVisible ? 'visible' : 'invisible'
      ].filter(Boolean).join(',');
      
      return `${baseUrl}&role=${role}&perms=${encodeURIComponent(perms)}`;
    }
    
    return `${baseUrl}&role=${role}`;
  };

  const copyInviteLink = (role: InviteRole) => {
    if (role === "moderator") {
      setShowPermissions(true);
      return;
    }
    
    const inviteUrl = generateInviteUrl(role);
    navigator.clipboard.writeText(inviteUrl);
    
    const roleLabels = {
      guest: "Guest",
      moderator: "Moderator", 
      cohost: "Co-Host"
    };
    
    alert(`${roleLabels[role]} invite link copied to clipboard!\n${inviteUrl}`);
    setIsOpen(false);
  };

  const createModeratorInvite = () => {
    const inviteUrl = generateInviteUrl("moderator");
    navigator.clipboard.writeText(inviteUrl);
    
    const permsList = [
      permissions.canMute ? "Mute users" : "",
      permissions.canRemove ? "Remove users" : "",
      permissions.canMuteAll ? "Mute all" : "",
      permissions.isVisible ? "Visible" : "Invisible"
    ].filter(Boolean).join(", ");
    
    alert(`Moderator invite link copied!\nPermissions: ${permsList}\n${inviteUrl}`);
    setShowPermissions(false);
    setIsOpen(false);
  };

  const buttonStyle = {
    fontSize: '0.75rem',
    padding: '0.5rem 0.75rem',
    border: '1px solid rgba(34, 197, 94, 0.4)',
    borderRadius: '0.375rem',
    background: 'rgba(34, 197, 94, 0.05)',
    color: '#22c55e',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    backdropFilter: 'blur(10px)',
    fontWeight: '500' as const,
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem'
  };

  const menuStyle = {
    position: 'absolute' as const,
    top: '100%',
    right: '0',
    marginTop: '0.5rem',
    background: 'rgba(20, 20, 20, 0.95)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '0.5rem',
    backdropFilter: 'blur(20px)',
    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
    zIndex: 1000,
    minWidth: '180px'
  };

  const menuItemStyle = {
    display: 'block',
    width: '100%',
    padding: '0.75rem 1rem',
    background: 'transparent',
    border: 'none',
    color: '#ffffff',
    cursor: 'pointer',
    fontSize: '0.875rem',
    textAlign: 'left' as const,
    transition: 'all 0.2s ease',
    borderRadius: '0'
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={buttonStyle}
        onMouseEnter={(e) => {
          const target = e.target as HTMLButtonElement;
          target.style.background = 'rgba(34, 197, 94, 0.15)';
          target.style.borderColor = 'rgba(34, 197, 94, 0.8)';
          target.style.boxShadow = '0 0 12px rgba(34, 197, 94, 0.3)';
        }}
        onMouseLeave={(e) => {
          const target = e.target as HTMLButtonElement;
          target.style.background = 'rgba(34, 197, 94, 0.05)';
          target.style.borderColor = 'rgba(34, 197, 94, 0.4)';
          target.style.boxShadow = 'none';
        }}
        title="Create invite links"
      >
        🔗 Invite
        <span style={{ fontSize: '0.6rem' }}>{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <>
          {/* Backdrop to close menu when clicking outside */}
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 999
            }}
            onClick={() => setIsOpen(false)}
          />
          
          {/* Menu */}
          <div style={menuStyle}>
            <button
              style={{
                ...menuItemStyle,
                borderRadius: '0.5rem 0.5rem 0 0'
              }}
              onClick={() => copyInviteLink("guest")}
              onMouseEnter={(e) => {
                const target = e.target as HTMLButtonElement;
                target.style.background = 'rgba(34, 197, 94, 0.1)';
              }}
              onMouseLeave={(e) => {
                const target = e.target as HTMLButtonElement;
                target.style.background = 'transparent';
              }}
            >
              👥 Invite Guest
            </button>
            
            <button
              style={menuItemStyle}
              onClick={() => copyInviteLink("moderator")}
              onMouseEnter={(e) => {
                const target = e.target as HTMLButtonElement;
                target.style.background = 'rgba(34, 197, 94, 0.1)';
              }}
              onMouseLeave={(e) => {
                const target = e.target as HTMLButtonElement;
                target.style.background = 'transparent';
              }}
            >
              🛡️ Invite Moderator
            </button>
            
            <button
              style={{
                ...menuItemStyle,
                borderRadius: '0 0 0.5rem 0.5rem'
              }}
              onClick={() => copyInviteLink("cohost")}
              onMouseEnter={(e) => {
                const target = e.target as HTMLButtonElement;
                target.style.background = 'rgba(34, 197, 94, 0.1)';
              }}
              onMouseLeave={(e) => {
                const target = e.target as HTMLButtonElement;
                target.style.background = 'transparent';
              }}
            >
              👑 Invite Co-Host
            </button>
          </div>
        </>
      )}
    </div>
  );
}