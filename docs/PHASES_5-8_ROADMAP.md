# Implementation Roadmap: Phases 5-8

## Phase 5: Role-Based Layout Routing (Est. 2-3 days)

### Objective
Create dynamic room layouts that adapt based on user permissions and role.

### Components to Create

#### 5.1 RoomLayoutRouter.tsx (200 lines)
**Purpose**: Main routing component that selects layout based on permissions

```typescript
// Pseudo-code structure
export const RoomLayoutRouter = ({ roomId }) => {
  const { permissions, roleMeta } = usePermissions();

  const role = getEffectiveRole(permissions);
  
  return (
    <div className="h-screen flex">
      <MainLayout 
        role={role}
        topBar={<PermissionAwareTopBar />}
        sidebar={<PermissionAwareSidebar />}
        main={getLayoutContent(role, roomId)}
      />
    </div>
  );
};

// Role detection logic
const getEffectiveRole = (permissions) => {
  if (isHost(permissions)) return 'host';
  if (isCohost(permissions)) return 'cohost';
  if (isModerator(permissions)) return 'moderator';
  if (isParticipant(permissions)) return 'participant';
  return 'viewer';
};
```

**Features**:
- Detects effective role from permission flags
- Returns appropriate layout for role
- Renders different toolbars/sidebars
- Hides/shows controls based on permissions

#### 5.2 HostLayout.tsx (250 lines)
**For room hosts with full permissions**

**Includes**:
- Full stream controls toolbar
- Advanced settings panel
- Participant management sidebar
- Analytics dashboard
- Permission editor
- Recording controls

#### 5.3 CoHostLayout.tsx (200 lines)
**For cohosts with most permissions**

**Includes**:
- Stream controls (no settings)
- Participant list with mute/kick
- Recording indicators
- Limited permission editing

#### 5.4 ModeratorLayout.tsx (180 lines)
**For moderators with moderation permissions**

**Includes**:
- Moderation toolbar (mute, disable camera)
- Participant list
- Chat management
- Limited stream controls

#### 5.5 ParticipantLayout.tsx (150 lines)
**For standard participants**

**Includes**:
- Basic media controls
- Participant list (names only)
- Chat access
- Screen share button

#### 5.6 ViewerLayout.tsx (100 lines)
**For viewers with watch-only access**

**Includes**:
- Stream display only
- Chat (read-only)
- Participant count
- No controls

### Sidebar Components

#### PermissionAwareSidebar.tsx (180 lines)
**Dynamic sidebar based on role**

```typescript
// Navigation options change per role
const ROLE_NAV = {
  host: [
    { icon: Users, label: 'Participants', action: 'participants' },
    { icon: Settings, label: 'Settings', action: 'settings' },
    { icon: BarChart, label: 'Analytics', action: 'analytics' },
    { icon: Lock, label: 'Permissions', action: 'permissions' },
  ],
  cohost: [
    { icon: Users, label: 'Participants', action: 'participants' },
    { icon: BarChart, label: 'Analytics', action: 'analytics' },
  ],
  moderator: [
    { icon: Users, label: 'Participants', action: 'participants' },
  ],
  participant: [],
  viewer: [],
};
```

### Toolbar Components

#### PermissionAwareToolbar.tsx (200 lines)
**Dynamic toolbar with permission-gated buttons**

```typescript
// Button availability based on permissions
<ToolbarButton
  icon={Mic}
  label="Mute All"
  onClick={muteAll}
  disabled={!hasPermission('MUTE_OTHER_AUDIO')}
/>
```

### Styling Strategy

**Responsive Design**:
- Desktop: Sidebar + Main + Right panel
- Tablet: Sidebar + Main (collapsible panels)
- Mobile: Full-width with bottom sheet controls

**Consistent Glass Morphism**:
- Toolbars: `bg-white/5 backdrop-blur-sm border-white/10`
- Sidebars: `bg-white/5 backdrop-blur-sm`
- Panels: `bg-white/10 backdrop-blur-md`

### Testing Checklist
- [ ] All 5 layouts render correctly
- [ ] Permission checks work as expected
- [ ] Navigation items show/hide per role
- [ ] Controls are enabled/disabled properly
- [ ] Responsive design works on all breakpoints
- [ ] Sidebar can collapse/expand
- [ ] Toolbar buttons have proper tooltips

---

## Phase 6: LiveKit Integration (Est. 2-3 days)

### Objective
Map permissions to LiveKit token claims and implement permission guards on stream actions.

### Backend Work

#### 6.1 LiveKit Token Generation (120 lines)
**File**: `server/lib/livekitToken.ts`

```typescript
import { AccessToken } from 'livekit-server-sdk';

export const generateLiveKitToken = (
  roomId: string,
  userId: string,
  permissions: StreamPermissions,
  roleMeta: RoleMeta
) => {
  const token = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET
  );

  token.identity = userId;
  token.name = roleMeta.label;

  // Grant room join
  token.addGrant({
    roomJoin: true,
    room: roomId,
    canPublish: permissions.UNMUTE_AUDIO,
    canPublishData: true,
    canSubscribe: true,
  });

  // Store permissions in metadata
  token.metadata = JSON.stringify({
    permissions,
    role: roleMeta.label,
    userId,
    roomId,
  });

  return token.toJwt();
};
```

#### 6.2 Update Room Token Endpoint (80 lines)
**Modify**: `streamline-server/routes/roomGuestAccess.ts` (current source of truth: `POST /api/rooms/:roomId/token`)

```typescript
router.post('/', async (req, res) => {
  try {
    const { userId, roomId } = req.body;

    // Get user's permissions
    const permissionsDoc = await db
      .collection('rooms')
      .doc(roomId)
      .collection('participants')
      .doc(userId)
      .get();

    const { permissions, roleMeta } = permissionsDoc.data();

    // Generate LiveKit token with permissions
    const token = generateLiveKitToken(
      roomId,
      userId,
      permissions,
      roleMeta
    );

    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate token' });
  }
});
```

### Frontend Work

#### 6.3 LiveKit Client Setup (150 lines)
**Modify**: `src/lib/livekitClient.ts`

```typescript
import { LiveKitRoom, VideoConference } from '@livekit/components-react';
import { usePermissions } from '@/contexts/PermissionsContext';

export const StreamContainer = ({ roomId }) => {
  const { userId, permissions } = usePermissions();
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const getToken = async () => {
      const response = await fetch('/api/rooms/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('sl_token')}`,
        },
        body: JSON.stringify({ userId, roomId }),
      });

      const { token } = await response.json();
      setToken(token);
    };

    getToken();
  }, [userId, roomId]);

  if (!token) return <LoadingSpinner />;

  return (
    <LiveKitRoom
      video={permissions.ENABLE_CAMERA}
      audio={permissions.UNMUTE_AUDIO}
      token={token}
      serverUrl={process.env.LIVEKIT_URL}
    >
      <VideoConference />
      <PermissionGuards />
    </LiveKitRoom>
  );
};
```

#### 6.4 Permission Guards Hook (180 lines)
**File**: `src/hooks/usePermissionGuards.ts`

```typescript
export const usePermissionGuards = (roomId: string) => {
  const { permissions, userId } = usePermissions();
  const { room } = useRoomContext();

  return {
    // Stream action guards
    canUnmute: () => permissions.UNMUTE_AUDIO,
    canEnableCamera: () => permissions.ENABLE_CAMERA,
    canScreenShare: () => permissions.SCREEN_SHARE,
    canRecord: () => permissions.RECORD_STREAM,
    canUseEffects: () => permissions.USE_EFFECTS,

    // Moderation action guards
    canMuteOther: (userId: string) => {
      return permissions.MUTE_OTHER_AUDIO && 
             !isHost(room.participants[userId]);
    },
    canDisableOtherCamera: (userId: string) => {
      return permissions.DISABLE_OTHER_CAMERA && 
             !isHost(room.participants[userId]);
    },
    canEndOtherStream: (userId: string) => {
      return permissions.END_OTHER_STREAM && 
             !isHost(room.participants[userId]);
    },

    // Control guards
    canControlLayout: () => permissions.CONTROL_LAYOUT,
    canManagePermissions: () => permissions.MANAGE_PERMISSIONS,

    // Access guards
    canAccessChat: () => permissions.ACCESS_CHAT,
    canDownloadRecording: () => permissions.DOWNLOAD_RECORDING,
  };
};
```

#### 6.5 Stream Action Handlers (200 lines)
**File**: `src/lib/streamActions.ts`

```typescript
export class StreamActionHandler {
  private guard: ReturnType<typeof usePermissionGuards>;
  private room: LiveKitRoom;

  constructor(guard, room) {
    this.guard = guard;
    this.room = room;
  }

  async muteUser(userId: string) {
    if (!this.guard.canMuteOther(userId)) {
      throw new Error('Permission denied: Cannot mute other users');
    }

    // Send command via LiveKit
    await this.room.localParticipant.publishData(
      JSON.stringify({
        type: 'mute',
        target: userId,
        timestamp: Date.now(),
      }),
      DataPacket_Kind.LOSSY
    );

    // Log action for audit
    await logAuditEvent('mute_user', {
      actor: this.room.localParticipant.identity,
      target: userId,
      action: 'mute',
    });
  }

  async disableCamera(userId: string) {
    if (!this.guard.canDisableOtherCamera(userId)) {
      throw new Error('Permission denied: Cannot disable cameras');
    }
    // Similar implementation
  }

  async endStream(userId: string) {
    if (!this.guard.canEndOtherStream(userId)) {
      throw new Error('Permission denied: Cannot end streams');
    }
    // Similar implementation
  }
}
```

#### 6.6 Real-Time Permission Sync (120 lines)
**File**: `src/hooks/useRealtimePermissions.ts`

```typescript
export const useRealtimePermissions = (roomId: string, userId: string) => {
  const { setPermissions } = usePermissions();

  useEffect(() => {
    // Listen to permission changes in real-time
    const unsubscribe = onSnapshot(
      doc(
        db,
        `rooms/${roomId}/participants/${userId}`
      ),
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          const { permissions, roleMeta } = docSnapshot.data();
          
          // Update global context
          setPermissions(permissions);
          
          // Show notification if permissions changed
          if (permissionsChanged(permissions)) {
            showNotification(
              'Your permissions have been updated',
              'info'
            );
          }
        }
      }
    );

    return unsubscribe;
  }, [roomId, userId]);
};
```

### Testing Checklist
- [ ] Token generation includes all permission flags
- [ ] LiveKit correctly receives token
- [ ] Permission guards block unauthorized actions
- [ ] Audit logging captures all moderation actions
- [ ] Real-time sync updates UI on permission changes
- [ ] Error messages shown for denied actions

---

## Phase 7: Testing (Inline - 90%+ Coverage)

### Unit Tests (~30 test suites)

#### Permission Tests
```typescript
describe('Permission System', () => {
  it('checks UNMUTE_AUDIO flag correctly', () => {
    const perms = { UNMUTE_AUDIO: true };
    expect(hasPermission(perms, 'UNMUTE_AUDIO')).toBe(true);
  });

  it('prevents escalation', () => {
    const hostPerms = { MANAGE_PERMISSIONS: true };
    const elevated = { MANAGE_PERMISSIONS: false, /* ... */ };
    expect(checkEscalation(elevated, hostPerms)).toBe(false);
  });
});
```

#### Component Tests
```typescript
describe('InvitesDashboard', () => {
  it('filters invites by type', async () => {
    const { getByText } = render(
      <InvitesDashboard roomId="room-123" />
    );
    await userEvent.click(getByText('Elevated'));
    expect(getByRole('list')).toHaveLength(1);
  });
});
```

### Integration Tests (~15 test suites)

#### API Flow Tests
```typescript
describe('Invite Lifecycle', () => {
  it('creates, uses, and deletes invite', async () => {
    // Create
    const invite = await createInvite(...);
    expect(invite.inviteId).toBeDefined();

    // Use
    const result = await useInvite(invite.inviteId);
    expect(result.success).toBe(true);

    // Delete
    await deleteInvite(invite.inviteId);
  });
});
```

### E2E Tests (~10 test suites)

#### User Flow Tests (Cypress)
```typescript
describe('User Creates and Uses Invite', () => {
  it('host can create and guest can join', () => {
    cy.login('host');
    cy.visit('/room/room-123/settings');
    
    cy.contains('Create Invite').click();
    cy.get('input[placeholder="Label"]').type('Speaker');
    cy.contains('Create').click();
    
    cy.contains('Copied').should('be.visible');
  });
});
```

### Test Coverage Targets

- **Middleware**: 100% (auth.ts, validatePermissions.ts)
- **Routes**: 95% (invites.ts, roomGuestAccess.ts)
- **Components**: 90% (PermissionPickerModal, Dashboard, etc.)
- **Hooks**: 90% (usePermissions, usePermissionGuards)
- **Overall**: 90%+

---

## Phase 8: Production Hardening (Est. 2-3 days)

### 8.1 Migration Script (180 lines)
**File**: `scripts/migrate-legacy-invites.ts`

```typescript
/**
 * Migrates old invite format to new permission-based format
 * 
 * Old format: { type: 'guest', maxUses: 10 }
 * New format: { 
 *   type: 'participant',
 *   permissions: { UNMUTE_AUDIO: true, ... },
 *   roleMeta: { label: 'Participant', ... }
 * }
 */

export const migrateInvites = async (roomId: string) => {
  const oldInvites = await db
    .collection('rooms')
    .doc(roomId)
    .collection('legacyInvites')
    .get();

  const migrations = oldInvites.docs.map((doc) => {
    const old = doc.data();
    const preset = getPreset(old.type);

    return {
      ...old,
      permissions: preset.permissions,
      roleMeta: {
        label: getLabel(old.type),
        color: getColor(old.type),
        description: getDescription(old.type),
      },
      migratedAt: serverTimestamp(),
    };
  });

  // Batch write migrations
  const batch = db.batch();
  migrations.forEach((migration) => {
    batch.set(
      db.collection('rooms').doc(roomId)
        .collection('invites').doc(),
      migration
    );
  });
  await batch.commit();

  console.log(`Migrated ${migrations.length} invites for room ${roomId}`);
};
```

### 8.2 Feature Flag System (150 lines)
**File**: `src/hooks/useFeatureFlags.ts`

```typescript
export const useFeatureFlags = () => {
  const [flags, setFlags] = useState<FeatureFlags>({
    NEW_INVITE_SYSTEM: true,
    PERMISSION_PICKER: true,
    BULK_INVITES: true,
    REAL_TIME_SYNC: false, // Gradual rollout
  });

  return {
    isEnabled: (flag: string) => flags[flag],
    
    // Gradual rollout: x% of users
    isEnabledForUser: (flag: string, userId: string) => {
      if (!flags[flag]) return false;
      
      const hash = hashUserId(userId);
      const rollout = getRolloutPercentage(flag);
      return hash % 100 < rollout;
    },
  };
};
```

### 8.3 Analytics Integration (200 lines)
**File**: `src/lib/analytics.ts`

```typescript
export const trackInviteEvent = (
  action: 'create' | 'use' | 'delete' | 'copy',
  metadata: {
    inviteType: string;
    roomId: string;
    userId: string;
    permissions?: Record<string, boolean>;
  }
) => {
  // Segment.io tracking
  analytics.track('Invite Action', {
    action,
    ...metadata,
    timestamp: new Date().toISOString(),
  });

  // Local analytics (for offline support)
  const event = {
    type: 'invite_event',
    action,
    ...metadata,
    createdAt: Date.now(),
  };
  
  db.collection('analytics')
    .doc(metadata.roomId)
    .collection('events')
    .add(event);
};

// Dashboard queries
export const getInviteMetrics = (roomId: string) => {
  return db.collection('analytics')
    .doc(roomId)
    .collection('events')
    .where('type', '==', 'invite_event')
    .where('createdAt', '>', Date.now() - 30 * 24 * 60 * 60 * 1000) // 30 days
    .get()
    .then(snapshot => {
      const data = snapshot.docs.map(doc => doc.data());
      
      return {
        totalCreated: data.filter(d => d.action === 'create').length,
        totalUsed: data.filter(d => d.action === 'use').length,
        averageTimeToUse: calculateAverageTime(data),
        mostUsedPreset: getMostFrequent(data, 'preset'),
      };
    });
};
```

### 8.4 Error Tracking (Sentry) (100 lines)
**File**: `src/lib/sentry.ts`

```typescript
import * as Sentry from '@sentry/react';

// Initialize Sentry
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  integrations: [
    new Sentry.Replay({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
});

// Capture invite-specific errors
export const captureInviteError = (
  error: Error,
  context: {
    action: 'create' | 'use' | 'list' | 'delete';
    roomId: string;
    userId: string;
  }
) => {
  Sentry.captureException(error, {
    contexts: {
      invite: context,
    },
    tags: {
      action: context.action,
      feature: 'invite_system',
    },
  });
};
```

### 8.5 Performance Monitoring (120 lines)
**File**: `src/lib/performance.ts`

```typescript
import { getCLS, getFID, getFCP, getLCP, getTTFB } from 'web-vitals';

export const initPerformanceTracking = () => {
  // Core Web Vitals
  getCLS(metric => trackMetric('CLS', metric.value));
  getFID(metric => trackMetric('FID', metric.value));
  getFCP(metric => trackMetric('FCP', metric.value));
  getLCP(metric => trackMetric('LCP', metric.value));
  getTTFB(metric => trackMetric('TTFB', metric.value));

  // Custom metrics
  trackInviteLoadTime();
  trackPermissionEvaluationTime();
};

const trackMetric = (name: string, value: number) => {
  if (window.gtag) {
    window.gtag('event', name, { value, event_category: 'web_vitals' });
  }
};
```

### 8.6 Documentation Finalization (500+ lines)

**Files to create**:
- `docs/API.md` - Complete API reference
- `docs/ARCHITECTURE.md` - System design
- `docs/PERMISSIONS.md` - Permission flag reference
- `docs/DEPLOYMENT.md` - Deployment guide
- `docs/TROUBLESHOOTING.md` - Common issues
- `docs/CONTRIBUTING.md` - Contribution guidelines

### Deployment Checklist

- [ ] All tests passing (90%+ coverage)
- [ ] Performance metrics under target
- [ ] Security audit completed
- [ ] Error tracking configured (Sentry)
- [ ] Analytics configured (Segment)
- [ ] Feature flags set correctly
- [ ] Database backups configured
- [ ] Monitoring dashboards created
- [ ] Runbooks written
- [ ] Team trained on new system

### Production Ready Verification

- [ ] Zero unhandled promise rejections
- [ ] All API errors logged with context
- [ ] Rate limiting enforced
- [ ] Database indexes created
- [ ] Cache strategy implemented
- [ ] CORS configured properly
- [ ] Secrets managed via environment
- [ ] Logging aggregated (ELK/Datadog)
- [ ] Alerts configured
- [ ] Incident response plan written

---

## Timeline Summary

| Phase | Duration | Status | Key Deliverables |
|-------|----------|--------|-------------------|
| 0-4 | Complete | ✅ DONE | 4 components, 5 APIs, security hardening |
| 5 | 2-3 days | ⏳ TODO | 5 layouts, role-based routing, sidebar/toolbar |
| 6 | 2-3 days | ⏳ TODO | LiveKit tokens, permission guards, real-time sync |
| 7 | 2-3 days | ⏳ TODO | 55+ tests, 90%+ coverage, E2E flows |
| 8 | 2-3 days | ⏳ TODO | Migration, analytics, Sentry, docs |

**Total estimated remaining**: 8-12 days
**Overall project**: ~2-3 weeks for complete implementation

---

## Success Criteria

### Phase 5: Layout Routing
- ✓ All 5 layouts render without errors
- ✓ Permission checks work correctly
- ✓ Responsive design on all breakpoints
- ✓ Sidebar navigation shows/hides per role

### Phase 6: LiveKit Integration
- ✓ Tokens generated with permission claims
- ✓ Permission guards enforce restrictions
- ✓ Real-time sync updates permissions
- ✓ Audit logs all moderation actions

### Phase 7: Testing
- ✓ 90%+ code coverage
- ✓ All unit tests passing
- ✓ Integration tests validate flows
- ✓ E2E tests verify user journeys

### Phase 8: Production
- ✓ Migration script migrates legacy data
- ✓ Analytics tracks all events
- ✓ Sentry captures all errors
- ✓ Performance meets targets
- ✓ Documentation complete
- ✓ Deployment checklist verified

---

**Ready to proceed?** Start Phase 5 or begin Phase 7 testing for comprehensive coverage.
