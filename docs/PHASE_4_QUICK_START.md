# Phase 4 Quick Start Guide

## Overview

Phase 4 delivers **4 complete React components** for a professional invite management system with glass morphism design and full API integration.

## Components Available

### 1. QuickInviteButtons ⚡
**Fastest Way to Create Invites**

```tsx
import { QuickInviteButtons } from '@/components/invites';

export const MyComponent = () => {
  return (
    <QuickInviteButtons 
      roomId="room-123"
      onInviteCreated={(type, url) => {
        console.log(`Created ${type} invite:`, url);
      }}
    />
  );
};
```

**Features**:
- 3 buttons: Participant, Moderator, Viewer
- Auto-copy to clipboard
- Toast notifications
- Loading states

---

### 2. PermissionPickerModal 🎯
**Advanced 5-Step Wizard**

```tsx
import { PermissionPickerModal } from '@/components/invites';
import { useState } from 'react';

export const MyComponent = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)}>
        Create Custom Invite
      </button>

      <PermissionPickerModal
        isOpen={open}
        onClose={() => setOpen(false)}
        roomId="room-123"
        onInviteCreated={(invite) => {
          console.log('Invite created:', invite);
          setOpen(false);
        }}
      />
    </>
  );
};
```

**Features**:
- Step 1: Choose type (Participant, Elevated, Viewer)
- Step 2: Name the role
- Step 3: Choose preset (Moderator, Cohost, Producer)
- Step 4: Fine-tune 16 permission flags
- Step 5: Copy invite link

---

### 3. InvitesDashboard 📊
**Main Management Interface**

```tsx
import { InvitesDashboard } from '@/components/invites';

export const RoomSettings = () => {
  return (
    <InvitesDashboard roomId="room-123" />
  );
};
```

**Features**:
- List all active invites
- Search by label
- Filter by type
- Copy, edit, delete actions
- Real-time sync ready
- Pagination support
- Status indicators (Expired, Used Up)

---

### 4. BulkInviteModal 📦
**Batch Create Multiple Invites**

```tsx
import { BulkInviteModal } from '@/components/invites';
import { useState } from 'react';

export const MyComponent = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)}>
        Bulk Create
      </button>

      <BulkInviteModal
        isOpen={open}
        onClose={() => setOpen(false)}
        roomId="room-123"
      />
    </>
  );
};
```

**Features**:
- Create 1-100 invites at once
- Customizable label prefix
- Choose type and preset
- View all created links
- Copy all at once
- Download as CSV

---

## Common Patterns

### Pattern 1: Permission Gating

```tsx
import { usePermissions } from '@/contexts/PermissionsContext';
import { InvitesDashboard } from '@/components/invites';

export const RoomAdmin = () => {
  const { hasPermission } = usePermissions();

  // Only show to users with MANAGE_INVITES permission
  if (!hasPermission('MANAGE_INVITES')) {
    return <AccessDenied />;
  }

  return <InvitesDashboard roomId="room-123" />;
};
```

### Pattern 2: Conditional Rendering

```tsx
export const RoomHeader = () => {
  const { canDo } = usePermissions();

  return (
    <header>
      <h1>Room</h1>
      {canDo('INVITE_USERS') && (
        <QuickInviteButtons roomId="room-123" />
      )}
    </header>
  );
};
```

### Pattern 3: Combined UI

```tsx
import { QuickInviteButtons, InvitesDashboard } from '@/components/invites';

export const CompleteInviteManager = () => {
  return (
    <div className="space-y-6">
      {/* Quick actions */}
      <section>
        <h2>Quick Invite</h2>
        <QuickInviteButtons roomId="room-123" />
      </section>

      {/* Full management */}
      <section>
        <InvitesDashboard roomId="room-123" />
      </section>
    </div>
  );
};
```

### Pattern 4: Modal Stack

```tsx
import {
  QuickInviteButtons,
  PermissionPickerModal,
  BulkInviteModal,
} from '@/components/invites';
import { useState } from 'react';

export const InviteManager = () => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showBulk, setShowBulk] = useState(false);

  return (
    <>
      <QuickInviteButtons roomId="room-123" />
      
      <div className="space-x-2 mt-4">
        <button onClick={() => setShowAdvanced(true)}>
          Advanced
        </button>
        <button onClick={() => setShowBulk(true)}>
          Bulk Create
        </button>
      </div>

      <PermissionPickerModal
        isOpen={showAdvanced}
        onClose={() => setShowAdvanced(false)}
        roomId="room-123"
        onInviteCreated={() => setShowAdvanced(false)}
      />

      <BulkInviteModal
        isOpen={showBulk}
        onClose={() => setShowBulk(false)}
        roomId="room-123"
      />
    </>
  );
};
```

---

## API Reference

All components use these backend endpoints:

### Create Invite
```
POST /api/rooms/:roomId/invites
Headers: Authorization: Bearer <token>
Body: {
  type: 'participant' | 'elevated' | 'viewer',
  label?: string,
  basePreset?: 'moderator' | 'cohost' | 'producer',
  permissions?: { [flag: string]: boolean },
  maxUses?: number,
  expiresIn?: number
}
```

### List Invites
```
GET /api/rooms/:roomId/invites?limit=50&cursor=...
Headers: Authorization: Bearer <token>
Response: { invites: [], nextCursor: null }
```

### Update Invite
```
PATCH /api/rooms/:roomId/invites/:inviteId
Headers: Authorization: Bearer <token>
Body: { label?, maxUses?, expiresAt? }
```

### Delete Invite
```
DELETE /api/rooms/:roomId/invites/:inviteId
Headers: Authorization: Bearer <token>
```

### Use Invite (Join)
```
POST /api/rooms/:roomId/invites/:inviteId/use
Headers: Authorization: Bearer <token>
Body: { userId: string }
```

---

## Permission Flags

Use these flags for fine-tuning permissions:

**Media Controls** (5):
- `UNMUTE_AUDIO` - Control own audio
- `ENABLE_CAMERA` - Control own camera
- `SCREEN_SHARE` - Share screen
- `RECORD_STREAM` - Record stream
- `USE_EFFECTS` - Use video effects

**Stream Controls** (5):
- `MUTE_OTHER_AUDIO` - Mute others
- `DISABLE_OTHER_CAMERA` - Disable other cameras
- `END_OTHER_STREAM` - End other streams
- `CONTROL_LAYOUT` - Change layout
- `MANAGE_PERMISSIONS` - Change permissions

**Platform Access** (6):
- `INVITE_USERS` - Invite people
- `MANAGE_INVITES` - Manage invites
- `VIEW_ANALYTICS` - See stats
- `ACCESS_CHAT` - Use chat
- `DOWNLOAD_RECORDING` - Download files
- `BROADCAST_AUDIO` - Broadcast audio

---

## Presets Reference

**Participant**:
- UNMUTE_AUDIO
- ENABLE_CAMERA
- SCREEN_SHARE
- ACCESS_CHAT

**Viewer**:
- (no permissions - watch only)

**Moderator**:
- All participant permissions
- MUTE_OTHER_AUDIO
- DISABLE_OTHER_CAMERA

**Cohost**:
- All moderator permissions
- RECORD_STREAM
- CONTROL_LAYOUT

**Producer**:
- All cohost permissions
- MANAGE_PERMISSIONS
- VIEW_ANALYTICS

---

## Styling & Customization

All components use Tailwind CSS with glass morphism design:

```css
/* Glass morphism base */
bg-white/10 backdrop-blur-md border-white/20

/* Hover effects */
hover:bg-white/5 hover:border-white/30

/* Gradients for headers */
bg-gradient-to-r from-primary-400 to-primary-600

/* Color schemes */
primary, info, success, warning, danger
```

To customize colors, override Tailwind theme in `tailwind.config.js`:

```js
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: {
          400: '#your-color',
          500: '#your-color',
          600: '#your-color',
        }
      }
    }
  }
}
```

---

## Hooks Used

### usePermissions()
```tsx
const { 
  permissions,      // Current permissions
  roleMeta,         // Role label, color, description
  isLoading,        // Loading state
  error,            // Error message
  hasPermission,    // Check single flag
  canDo,            // Alias for hasPermission
  updatePermissions // Fetch fresh data
} = usePermissions();
```

### usePermissionsListener()
```tsx
const { unsubscribe } = usePermissionsListener(roomId, userId);

// Auto-syncs permissions from Firestore
// Call unsubscribe to cleanup
```

---

## Error Handling

All components handle errors gracefully:

```tsx
// Network errors
try {
  const response = await fetch('/api/rooms/:roomId/invites', { ... });
  if (!response.ok) {
    throw new Error(data.error || 'Failed to create invite');
  }
} catch (error) {
  setError(error.message);
  // Show error to user
}
```

Components display user-friendly error messages:
- "Failed to load invites"
- "Failed to delete invite: ..."
- "Failed to create invite: Invalid permissions"

---

## Testing

### Testing QuickInviteButtons
```tsx
it('copies invite link on success', async () => {
  const { getByText } = render(
    <QuickInviteButtons roomId="room-123" />
  );
  
  await userEvent.click(getByText('Invite Participant'));
  
  // Wait for copy to happen
  await waitFor(() => {
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });
});
```

### Testing InvitesDashboard
```tsx
it('filters invites by type', async () => {
  const { getByText, getByRole } = render(
    <InvitesDashboard roomId="room-123" />
  );
  
  // Click filter button
  await userEvent.click(getByText('Elevated'));
  
  // Only elevated invites should show
  const invites = getByRole('list').children;
  expect(invites.length).toBe(1);
});
```

---

## Troubleshooting

### "Module not found" error
```
Make sure components are properly exported:
✓ import { Component } from '@/components/invites';
✗ import { Component } from '@/components/invites/Component';
```

### "Bearer token missing"
```
Ensure usePermissions() provides the token:
const token = localStorage.getItem('sl_token');
Authorization: `Bearer ${token}`
```

### "Permission denied" error
```
Check that current user has MANAGE_INVITES permission:
const { hasPermission } = usePermissions();
if (!hasPermission('MANAGE_INVITES')) {
  return <AccessDenied />;
}
```

---

## Next Steps

1. **Integrate into Room Page**: Add components to existing room UI
2. **Test Flows**: Verify invite creation, usage, deletion
3. **Real-Time Sync**: Implement Firestore listener for live updates
4. **Analytics**: Track invite usage metrics
5. **Mobile**: Optimize for mobile view (already responsive)
6. **Phase 5**: Implement role-based layout routing

---

**Status**: Ready for production integration
**Build**: ✅ Compiles successfully
**Tests**: Ready to write unit/integration tests
**Docs**: Complete with examples and API reference
