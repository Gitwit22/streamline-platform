# Permissions & Roles

StreamLine uses a multi-layered permissions system that controls access at the platform level, room level, and participant level.

## Permission Layers

```
Platform Level    → Is the user an admin? What plan are they on?
  │
  ▼
Feature Level     → Does their plan include this feature?
  │
  ▼
Room Level        → Can they access this room? What visibility/policy applies?
  │
  ▼
Participant Level → What role do they have? What can they do in this room?
```

## Platform Roles

| Role | Description | How Assigned |
|---|---|---|
| **Admin** | Full platform access, admin dashboard, all management capabilities | `isAdmin: true` on user Firestore document |
| **User** | Standard authenticated user with plan-based feature access | Default for all registered users |
| **Guest** | Temporary room access via invite, no platform account required | Via invite token redemption |

## Room Roles

Room roles determine what a participant can do within a specific room session.

| Role | Description |
|---|---|
| **Host** | Room owner with full control — start/stop streaming, manage participants, moderate, record |
| **Co-Host** | Elevated participant — manage other participants, moderate chat, publish media |
| **Participant** | Standard attendee — publish audio/video, participate in chat |
| **Guest** | Limited attendee — configurable audio/video publishing, limited interactions |
| **Viewer** | Watch-only — no publishing, may have limited chat access |

### Permission Matrix

| Permission | Host | Co-Host | Participant | Guest | Viewer |
|---|---|---|---|---|---|
| Publish Audio | ✅ | ✅ | ✅ | Configurable | ❌ |
| Publish Video | ✅ | ✅ | ✅ | Configurable | ❌ |
| Screen Share | ✅ | ✅ | Configurable | ❌ | ❌ |
| Mute Others | ✅ | ✅ | ❌ | ❌ | ❌ |
| Remove Participants | ✅ | ✅ | ❌ | ❌ | ❌ |
| Start/Stop Stream | ✅ | ❌ | ❌ | ❌ | ❌ |
| Start/Stop Recording | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manage Invites | ✅ | ❌ | ❌ | ❌ | ❌ |
| Send Chat | ✅ | ✅ | ✅ (normal mode) | Configurable | ❌ |
| Moderate Chat | ✅ | ✅* | ❌ | ❌ | ❌ |

> \* Co-host chat moderation can be disabled via `ROOM_MODERATION_HOST_ONLY=1`

### Permission Encoding

Permissions are encoded into the LiveKit access token at join time:

```typescript
{
  canPublishAudio: boolean,
  canPublishVideo: boolean,
  canScreenShare: boolean,
  canMuteGuests: boolean,
  canRemoveGuests: boolean,
  canStartStopStream: boolean,
  canStartStopRecording: boolean,
  canInviteLinks: boolean
}
```

The server maps roles to permissions via `livekitPermissions.ts` and these are enforced by both the LiveKit server (media permissions) and the StreamLine API (control actions).

## Presence Modes

Presence modes add another layer of access control on top of roles:

| Mode | Visible in Roster | Can Send Chat | Audio/Video |
|---|---|---|---|
| **Normal** | ✅ | ✅ | Based on role |
| **Silent** | ✅ | ❌ | Disabled |
| **Invisible** | ❌ | ❌ | Disabled |

Presence mode is encoded in the LiveKit token metadata (`presenceMode`, `isVisibleInRoster`, `canSendChat`). Client-side filtering uses `extractPresenceMetadata()` from `roles.ts`.

## Feature-Level Permissions (Plan Gating)

Plan-based feature access is enforced at both the API and UI layer:

| Feature | Free | Starter | Pro | Basic |
|---|---|---|---|---|
| Room Creation | ✅ | ✅ | ✅ | ✅ |
| Recording | ❌ | ✅ | ✅ | ✅ |
| HLS Streaming | ❌ | ✅ | ✅ | ❌ |
| Multi-Destination | ❌ | ❌ | ✅ | ❌ |
| Content Library | ❌ | ✅ | ✅ | ✅ |
| Projects | ❌ | ✅ | ✅ | ❌ |
| Video Editor | ❌ | ❌ | ✅ | ❌ |
| Advanced Permissions | ❌ | ❌ | ✅ | ❌ |

Feature flags are stored on plan documents in Firestore and checked via:
- **Server**: `featureAccess.ts` route returns current user's feature flags
- **Client**: `useEffectiveEntitlements()` hook caches entitlements (30s TTL)

## Room Access Policies

Room creators can configure access policies:

| Policy | Description |
|---|---|
| **Public** | Anyone can join without restrictions |
| **Unlisted** | Only accessible via direct link (not discoverable) |
| **Private** | Requires a valid invite token to join |
| **Auth Required** | Visitors must be logged in with a platform account |
| **Payment Required** | Access requires an active subscription or payment |

## Invite Token Security

Invite tokens are JWTs with the following security measures:

- **Expiry required** — Tokens must have an `exp` claim (no perpetual tokens)
- **Algorithm whitelist** — Only `HS256` (configurable via `INVITE_TOKEN_ALGS`)
- **No `alg: none`** — Rejected to prevent token forgery
- **Issuer/audience validation** — Configurable via environment variables
- **Scoped access** — Tokens encode specific `roomId`, `role`, and `identity`

## Token Revocation

Platform-level token revocation is supported:

- **`authRevokedAtMs`** — Timestamp on user document; all tokens issued before this time are rejected
- **Use cases** — Password reset, security incidents, account lockout
- **Immediate effect** — Both Firebase ID tokens and session JWTs are checked against this timestamp

## Managing Permissions

### As a Host

1. **Set room visibility** — Configure during room creation or via room settings
2. **Create invites** — Generate invite links with specific roles and expiry
3. **Modify participants** — Change participant roles in real-time during a session
4. **Moderate** — Mute, remove, or restrict participants as needed

### As an Admin

1. **Set admin flag** — Add `isAdmin: true` to user documents in Firestore
2. **Manage plans** — Configure plan feature flags in plan documents
3. **Review usage** — Monitor usage limits and enforcement via admin dashboard
4. **Token revocation** — Set `authRevokedAtMs` to force re-authentication
