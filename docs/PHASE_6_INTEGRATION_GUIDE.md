# Phase 6 Integration Guide - LiveKit Tokens & Permission Guards

## Overview

Phase 6 adds three critical systems to the StreamLine platform:

1. **LiveKit Token Generation** - Secure room access with permission-based grants
2. **Permission Guards** - Frontend enforcement of permission checks
3. **Stream Actions** - Permission-validated handlers for moderation actions
4. **Real-Time Sync** - Live permission updates from Firestore

---

## File Structure

```
Backend:
server/
├── lib/
│   └── livekitToken.ts          ← Token generation, grant mapping
└── routes/
    └── tokens.ts                 ← POST /api/rooms/:roomId/token endpoints

Frontend:
streamline-client/src/
├── hooks/
│   ├── usePermissionGuards.ts    ← 10 permission check functions
│   ├── useLiveKitToken.ts        ← Token lifecycle (fetch, refresh)
│   └── usePermissionSync.ts      ← Real-time Firestore listeners
├── lib/
│   └── streamActions.ts          ← 6 permission-guarded actions
└── components/layouts/toolbars/
    └── HostToolbar.tsx           ← Updated with action handlers
```

---

## Integration Points with Existing Code

### 1. PermissionsContext (Phase 3)
**File**: `src/contexts/PermissionsContext.tsx`

**What's New**:
- Provides `userId` and `permissions` to child components
- Used by usePermissionGuards to check current user's permissions
- Used by useLiveKitToken to fetch token for current user

**Export**:
```tsx
const { userId, permissions } = usePermissions();
```

**Phase 6 Dependencies**:
- usePermissionGuards calls usePermissions internally
- useLiveKitToken uses userId from context
- usePermissionSync uses userId for Firestore listeners

---

### 2. RoomLayoutRouter (Phase 5)
**File**: `src/components/RoomLayoutRouter.tsx`

**What's New**:
- Role detection (Host, CoHost, Moderator, Participant, Viewer)
- Already uses StreamPermissions to determine role
- Phase 6 toolbars now validate specific actions within each layout

**Integration**:
```tsx
// RoomLayoutRouter renders the appropriate layout
// Each layout contains updated toolbar with Phase 6 guards

const RoomLayoutRouter = ({ roomId }) => {
  const { permissions } = usePermissions();
  const role = detectRole(permissions);
  
  return role === 'host' ? (
    <HostLayout roomId={roomId} /> // Now has permission-guarded actions
  ) : ...
};
```

---

### 3. HostToolbar (Phase 5, Updated Phase 6)
**File**: `src/components/layouts/toolbars/HostToolbar.tsx`

**Changes in Phase 6**:
```tsx
// OLD: Static buttons
<Button onClick={() => setIsRecording(!isRecording)}>
  Record
</Button>

// NEW: Permission-guarded with error handling
const { canStartRecording } = usePermissionGuards();
const handleToggleRecording = async () => {
  const result = await toggleRecording(
    { roomId, userId, permissions },
    !isRecording
  );
  if (result.success) setIsRecording(!isRecording);
  else setError(result.error);
};

<Button
  onClick={handleToggleRecording}
  disabled={!canStartRecording()}
>
  Record
</Button>
```

**What's Imported**:
- `usePermissionGuards` - For canStartRecording check
- `toggleRecording` - Action handler from streamActions.ts
- `usePermissions` - For userId from context

---

### 4. Firestore Collections
**Database Structure** (already in Phase 3):

```
rooms/
├── {roomId}/
│   ├── (room metadata)
│   └── participants/
│       └── {userId}/
│           ├── name
│           ├── joinedAt
│           ├── role
│           └── permissions (StreamPermissions object)
│               ├── canPublishAudio
│               ├── canPublishVideo
│               ├── canKickParticipants
│               ├── canMuteOthers
│               ├── canStartStopRecording
│               ├── ... (16 total flags)
```

**Phase 6 Listeners**:
- `useRealTimePermissions` - Listens to current user's permissions
- `usePermissionRevocationListener` - Detects permission loss
- `useRoomParticipantPermissions` - Listens to all participants

---

### 5. Audit Logging (Phase 0)
**File**: `server/lib/auditLog.ts`

**Phase 6 Integration**:
```tsx
// Every stream action logs an audit event
await logAuditEvent(
  roomId,
  'participant_muted', // action
  userId,              // who did it
  targetUserId,        // who it affected
  {
    action: 'mute',
    success: true,
  }
);
```

**Logged Events**:
- participant_muted
- camera_disabled
- stream_ended
- participant_kicked
- recording_toggled
- layout_changed

---

## Data Flow Examples

### Example 1: Host Records Stream

```
1. User clicks "Record" button in HostToolbar
   
2. HostToolbar.handleToggleRecording() called
   
3. Check permission: usePermissionGuards.canStartRecording()
   → Checks permissions.canStartStopRecording
   
4. IF allowed, call: streamActions.toggleRecording()
   → validateActionPermission() checks permission again
   → Calls logAuditEvent() → logs to Firestore
   
5. setIsRecording(true) → Button shows "Recording"

6. Parallel: useLiveKitToken auto-refreshes token
   → POST /api/rooms/:roomId/token
   → Returns: {token, url, expiresIn}
   → Auto-refresh scheduled for 5 min before expiry
```

---

### Example 2: Host Removes Recording Permission

```
1. Host opens PermissionPickerModal
   → Sets user's canStartStopRecording = false
   → Updates Firestore: rooms/{roomId}/participants/{userId}/permissions
   
2. Parallel listeners in other user's session:
   
   a) useRealTimePermissions detects change
      → Updates local permissions state
      → usePermissionGuards.canStartRecording() returns false
      → Recording button disables
      
   b) usePermissionRevocationListener detects loss
      → Calls onRevoked(['canStartStopRecording'])
      → Toast: "Recording permission revoked"
      
   c) usePermissionStateChange detects change
      → Calls onStateChange('lost', ['canStartStopRecording'])
      → Can trigger UI updates
   
3. If recording was active:
   → usePermissionSync triggers handler
   → Recording stops automatically
```

---

### Example 3: Participant Cannot Kick User

```
1. Participant clicks "Kick" on another user

2. ParticipantToolbar.handleKick() called
   
3. Check permission: usePermissionGuards.canKickUser(targetUserId)
   → Checks permissions.canKickParticipants
   → Returns FALSE (participant doesn't have permission)
   
4. Button remains disabled (never shows for participants)
   → Guard prevents action execution
   
5. Permission-based UI:
   - Participant layout doesn't render kick button (Phase 5)
   - usePermissionGuards guard returns false anyway (defense in depth)
```

---

### Example 4: Moderator Mutes Another User

```
1. Moderator clicks "Mute" on participant

2. ModeratorToolbar.handleMute() called

3. Check permission: usePermissionGuards.canMuteOther(targetUserId)
   → Checks permissions.canMuteOthers
   → Validates targetUserId !== userId (can't self-mute)
   → Returns TRUE

4. Call: streamActions.muteParticipant(options, true)
   → validateActionPermission() double-checks
   → Logs to Firestore via logAuditEvent()
   → Returns {success: true, message: "Participant muted"}

5. UI updates:
   → ParticipantCard shows muted state
   → Real-time listeners notify target user
   → Audit log available in Phase 8 analytics
```

---

## Hook Usage Patterns

### Pattern 1: Conditional Rendering
```tsx
import { usePermissionGuards } from '../hooks/usePermissionGuards';

export const ToolbarActions = () => {
  const { 
    canMuteOther,
    canKickUser,
    canStartRecording,
  } = usePermissionGuards();

  return (
    <>
      {canStartRecording() && <RecordButton />}
      {canMuteOther() && <MuteAllButton />}
      {canKickUser(targetId) && <KickButton />}
    </>
  );
};
```

### Pattern 2: Token Fetching
```tsx
import { useLiveKitToken } from '../hooks/useLiveKitToken';

export const LiveKitRoom = ({ roomId }) => {
  const { token, url, isLoading, error, refresh } = useLiveKitToken(roomId);

  useEffect(() => {
    if (error) {
      // Retry token fetch
      refresh();
    }
  }, [error, refresh]);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner>{error}</ErrorBanner>;

  return <LiveKitRoomComponent token={token} serverUrl={url} />;
};
```

### Pattern 3: Real-Time Sync
```tsx
import { useRealTimePermissions } from '../hooks/usePermissionSync';

export const PermissionAwareComponent = ({ roomId, userId }) => {
  const { permissions, isLoading, error } = useRealTimePermissions(
    roomId,
    userId
  );

  // Component automatically re-renders when permissions change in Firestore
  if (!permissions) return <Skeleton />;

  return (
    <>
      {permissions.canPublishAudio && <AudioIcon />}
      {permissions.canPublishVideo && <VideoIcon />}
    </>
  );
};
```

### Pattern 4: Revocation Detection
```tsx
import { usePermissionRevocationListener } from '../hooks/usePermissionSync';

export const PermissionMonitor = ({ roomId, userId }) => {
  const { revokedPermissions } = usePermissionRevocationListener(
    roomId,
    userId,
    (revoked) => {
      console.log('Lost permissions:', revoked);
      if (revoked.includes('canStartStopRecording')) {
        stopRecording();
        showToast('Recording permission revoked');
      }
    }
  );

  return revokedPermissions.length > 0 && (
    <Alert>Permission changes detected</Alert>
  );
};
```

---

## API Contract

### POST /api/rooms/:roomId/token

**Request**:
```
Headers:
  Authorization: Bearer <Firebase Auth JWT>
  Content-Type: application/json

Body: {} (empty)
```

**Success Response (200)**:
```json
{
  "token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "url": "wss://livekit.example.com",
  "expiresIn": 3600
}
```

**Error Response (403)**:
```json
{
  "error": "User not found in room participants"
}
```

---

### POST /api/rooms/:roomId/token/validate

**Request**:
```
Headers:
  Authorization: Bearer <Firebase Auth JWT>
  Content-Type: application/json

Body:
{
  "action": "kick" | "mute" | "record" | "changeLayout" | "endStream"
}
```

**Success Response (200)**:
```json
{
  "allowed": true,
  "action": "kick",
  "userId": "user-123",
  "roomId": "room-456"
}
```

---

## Permission Check Precedence

**Three levels of defense**:

1. **UI Guard** (Frontend, Phase 6)
   ```tsx
   if (canMuteOther(targetId)) {
     // Button shows
   }
   ```
   
2. **Action Handler Guard** (Frontend, Phase 6)
   ```tsx
   const validation = validateActionPermission(
     permissions,
     'mute',
     targetId,
     userId
   );
   ```
   
3. **Backend Guard** (Backend, Phase 2)
   ```
   POST /api/rooms/:roomId/participants/:userId/permissions
   → requireAuth middleware checks user is host
   → Validates permission values
   ```

All three must pass for action to succeed.

---

## Common Integration Mistakes

### ❌ DON'T: Forget to check permission before action
```tsx
// WRONG - No permission check
const handleMute = async () => {
  await muteParticipant(options, true);
};
```

### ✅ DO: Use guard before action
```tsx
// RIGHT - Permission checked
const { canMuteOther } = usePermissionGuards();
const handleMute = async () => {
  if (!canMuteOther(targetId)) return;
  await muteParticipant(options, true);
};
```

---

### ❌ DON'T: Hardcode user role
```tsx
// WRONG - Role hardcoded, doesn't sync
const role = 'host';
if (role === 'host') { /* show button */ }
```

### ✅ DO: Use permission hooks
```tsx
// RIGHT - Syncs in real-time
const { canKickParticipants } = usePermissionGuards();
if (canKickParticipants) { /* show button */ }
```

---

### ❌ DON'T: Forget error handling
```tsx
// WRONG - No error feedback
const result = await toggleRecording(options, true);
setIsRecording(true); // What if failed?
```

### ✅ DO: Handle all outcomes
```tsx
// RIGHT - Error handling
const result = await toggleRecording(options, true);
if (result.success) {
  setIsRecording(true);
} else {
  setError(result.error);
}
```

---

## Testing Checklist

- [ ] Permission guard prevents unpermitted user from seeing button
- [ ] Permission guard prevents unpermitted user from calling action
- [ ] Backend validates permission on API call
- [ ] Audit log records successful action
- [ ] Audit log records failed action with reason
- [ ] Real-time sync updates permissions when changed
- [ ] Revocation listener detects permission loss
- [ ] Token auto-refreshes 5 min before expiry
- [ ] Token endpoint requires authentication
- [ ] Token includes correct VideoGrant properties

---

## Deployment Considerations

### Prerequisites for Phase 6
- ✅ Firestore permissions structure (Phase 3)
- ✅ Audit logging system (Phase 0)
- ✅ Firebase Auth setup (Phase 0)
- ✅ Permission types and presets (Phase 1)
- ✅ LiveKit SDK installed (package.json)

### Migration Path
1. Deploy Phase 6 backend (tokens.ts routes)
2. Deploy Phase 6 frontend (hooks, streamActions)
3. Enable feature flag: USE_PERMISSION_GUARDS
4. Update existing invite system to use Phase 6 token endpoints
5. Monitor audit logs for any errors

### Rollback
- Revert to Phase 5 (role-based layouts still work)
- Token generation can be disabled per-route
- No database migrations needed (uses existing structure)

---

## Performance Considerations

### Token Caching
- useLiveKitToken caches token in localStorage
- Auto-refresh scheduled for 5 min before expiry
- Reduces number of token requests

### Real-Time Listeners
- useRealTimePermissions uses onSnapshot (not polling)
- Automatically unsubscribes on unmount
- Only one listener per roomId+userId pair

### Permission Guards
- usePermissionGuards uses useCallback (memoized)
- Prevents unnecessary re-renders
- Efficient permission lookups

---

## Next Integration: Phase 7 (Testing)

### Unit Tests Needed
- [ ] Permission guard returns correct boolean
- [ ] validateActionPermission catches self-actions
- [ ] Stream action handlers validate before execution
- [ ] Real-time listeners unsubscribe on unmount

### Integration Tests Needed
- [ ] Token request → response flow
- [ ] Permission change → UI update → audit log
- [ ] Action with insufficient permission → error
- [ ] Multiple users with different permissions

### E2E Tests Needed
- [ ] Host can record, participant cannot
- [ ] Permission revoked → button disables → recording stops
- [ ] Token refresh happens automatically
- [ ] Audit log entries created for all actions

---

## Update: Plan Entitlements & Moderator Gate (Jan 2026)

- **Entitlements endpoint:** `/api/usage/entitlements` returns plan features (recording, dualRecording, rtmpMultistream) and limits (maxGuests, maxDestinations, participantMinutes). The Room UI now shows these near stream/record controls and inside Settings → Usage so hosts know what is enabled.
- **Moderator issuance guard:** Moderator tokens require an admin grant. The client sends `roomAdmin: true` when requesting moderator; the server downgrades the role if admin is missing. Moderator invite copy calls out the potential downgrade.

