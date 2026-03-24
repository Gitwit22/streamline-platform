# StreamLine Room System — Pre-Release Audit Report

**Auditor:** Codebase Analyst (automated)
**Date:** 2025-07-15
**Scope:** Full server-side and client-side room system
**Status:** ⚠️ CONDITIONAL PASS — 3 release-blocking issues, 5 high-priority, 8 medium

---

## Executive Summary

The StreamLine Room System is a well-architected, multi-layered real-time collaboration platform built on **LiveKit** (WebRTC), **Firebase/Firestore** (persistence + real-time), and **Express** (API). The system supports authenticated hosts, authenticated participants, unauthenticated invite-based guests, and direct-link guests. Permissions are enforced server-side at multiple layers. However, **three release-blocking issues** were found that must be addressed before launch.

---

## 1. ROOM CREATION

### Files
- `streamline-server/routes/roomsCreate.ts` (93 lines)
- `streamline-server/services/rooms.ts` (217 lines)

### Flow
1. `POST /api/rooms/create` — requires Firebase auth (`requireAuth`)
2. Generates a Firestore document ID as `roomId`
3. Validates `roomType` (rtc/hls), `visibility` (public/unlisted/private), `requiresAuth`, `requiresPayment`
4. Sanitizes `livekitRoomName` via `sanitizeDisplayName()`
5. Seeds `roomLayout` from user's `mediaPrefs.defaultRoomLayout`
6. Calls `ensureRoomDoc()` which creates/merges the Firestore room document

### Validations Present ✅
- Auth required (line 19: `requireAuth`)
- UID check (line 21)
- Room type whitelisting to "rtc" | "hls" (line 23)
- Visibility enum validation (lines 32-35)
- Boolean type checks for `requiresAuth`/`requiresPayment` (lines 36-37)
- Display name sanitization (line 39)
- Layout normalization (line 60)

### Secure Defaults ✅
- `ensureRoomDoc` defaults: `visibility: "unlisted"`, `requiresAuth: true`, `requiresPayment: false` (lines 89-94 of rooms.ts)

### Findings
- **[LOW]** No rate limiting on room creation. A malicious user could create thousands of empty room documents.
- **[INFO]** Room names are optional — will fallback to roomId, which is adequate.

---

## 2. ROOM JOIN FLOWS

### Overview of Join Paths

There are **five distinct join paths**, each with different auth requirements:

| Path | Endpoint | Auth Required | Role Granted |
|------|----------|--------------|--------------|
| Host join | `POST /api/rooms/:roomId/token` | Firebase auth OR guest session | `host` (owner) or `participant` |
| Authenticated guest | `POST /api/rooms/:roomId/token` | Firebase auth | `participant` |
| Invite-based join | `POST /api/invites/:inviteId/join-now` | **None** | `guest` |
| Direct link join | `POST /api/rooms/:roomId/join-guest` | **None** | `guest` |
| Token refresh | `POST /api/rooms/:roomId/token` | Auth OR guest session | Same role |

### Files
- `streamline-server/routes/roomToken.ts` (1,185 lines) — Legacy host & authenticated guest token minting (DEAD CODE - not mounted)
- `streamline-server/routes/roomGuestAccess.ts` (~1,400 lines) — All active token minting flows
- `streamline-server/middleware/roomAccessToken.ts` (131 lines) — Room-scoped JWT middleware
- `streamline-server/middleware/guestSession.ts` (89 lines) — Guest session JWT

### 🔴 RELEASE BLOCKER: `roomTokenRoute` imported but never mounted

**File:** `streamline-server/index.ts`, line 16

```typescript
import roomTokenRoute from "./routes/roomToken";
```

The import exists but `roomTokenRoute` is **never passed to `app.use()`**. This means:
- `POST /api/roomToken` (legacy host join) — **DEAD CODE, not mounted**
- `POST /api/roomToken/guest` (legacy authenticated guest join) — **DEAD CODE, not mounted**

The equivalent functionality exists in `roomGuestAccess.ts` at:
- `POST /api/rooms/:roomId/token` (line 843) — token minting for both host and guest
- `POST /api/invites/:inviteId/join-now` (line 446) — invite-based join

**Impact assessment:** The client-side `Room.tsx` fetches tokens from `/api/rooms/${roomId}/token`, which IS mounted via `roomGuestAccessRoutes`. The legacy `/api/roomToken` path in `roomToken.ts` appears to be a **dead legacy route that was superseded** but never removed.

**Verdict:** NOT a functional blocker if clients use `/api/rooms/:roomId/token`. But the 1,185-line dead route file should be either removed or explicitly deprecated. It creates confusion and maintenance risk.

**Recommendation:** Verify client does not call `/api/roomToken` anywhere, then delete the file.

---

## 3. HOST VS GUEST PERMISSIONS

### Server-Side Enforcement ✅

Permissions are enforced at **three layers**:

#### Layer 1: LiveKit Token Grant (at join time)
**File:** `streamline-server/lib/livekitPermissions.ts`

| Role | canPublish | canPublishData | canPublishSources |
|------|-----------|---------------|-------------------|
| `viewer` | ❌ | ❌ | `[]` |
| `guest`/`participant` | ✅ | ✅ | `["microphone", "camera"]` |
| `cohost`/`host` | ✅ | ✅ | `["microphone", "camera", "screen_share", "screen_share_audio"]` |

**Key finding:** Guests/participants CANNOT screen-share at the LiveKit level. Only host/cohost can. This is enforced at token mint time (server-side), not UI-only.

#### Layer 2: Room Access Token (JWT)
**File:** `streamline-server/middleware/roomAccessToken.ts`

After LiveKit token, a separate `roomAccessToken` JWT is signed with:
- `role`: host/participant/cohost/viewer/guest
- `permissions`: object with granular flags (canStream, canRecord, canModerate, canMuteGuests, etc.)
- `identity`: participant identity
- `roomId`/`livekitRoomName`

This token is verified server-side on every room API call via `requireRoomAccessToken` middleware.

#### Layer 3: Per-Endpoint Role Checks
Every room control endpoint checks role:
- Layout change: `isHost(access.role)` — host only (`roomsLayout.ts:56`)
- Program state: `isHostOrCohost(access.role)` — host or cohost (`roomsProgramState.ts:120`)
- Room policy: `isHost(access.role)` — host only (`roomsPolicy.ts:58`)
- Controls: `isHostOrCohost(access.role)` — host only (`roomControls.ts:252`)
- Chat session end: host or cohost (`roomChat.ts:183`)

### Host Role Enforcement ✅
**File:** `roomGuestAccess.ts`, lines 983-990

Critical: The server **always** derives the host role from room ownership, never from client request:
```typescript
const lkRole: "guest" | "participant" | "host" = user
  ? (isOwner ? "host" : "participant")
  : guest?.role === "participant"
    ? "participant"
    : "guest";
```

### 🟡 HIGH PRIORITY: `isHostOrCohost` in roomControls.ts actually only checks for host

**File:** `streamline-server/routes/roomControls.ts`, line 225-229
```typescript
function isHostOrCohost(role?: string): boolean {
  const r = String(role || "").toLowerCase();
  // Updated policy: only hosts can modify room controls or presets.
  return r === "host";
}
```

The function name says "HostOrCohost" but the implementation only checks for "host". The comment explains this is intentional. However, this creates confusion when reading code. Should be renamed to `isHost()` for clarity.

### Unauthenticated Guest Permission Restrictions ✅

Join-now guests get:
```typescript
permissions: {
  canStream: false, canRecord: false, canDestinations: false,
  canModerate: false, canLayout: false, canScreenShare: false,
  canInvite: false, canAnalytics: false, canMuteGuests: false,
  canRemoveGuests: false,
}
```

All control permissions are `false`. Guests can only publish mic/camera (via LiveKit grant) and chat (via `canPublishData: true`).

### 🔴 RELEASE BLOCKER: join-now accepts invites with `role: "host"` and silently downgrades

**File:** `streamline-server/routes/roomGuestAccess.ts`, lines 548-558, 660-663

In the `join-now` transaction, the code validates invite roles:
```typescript
if (inviteRole === "host") {
  role = "host"; // ← invite stores "host"
}
```

But later at LiveKit token minting (line 662-663):
```typescript
const mintedRole: "guest" | "participant" | "host" =
  inviteRole === "host" ? "guest" : inviteRole;
```

The **LiveKit** token is correctly downgraded to "guest" for unauthenticated callers. The security guard works — even if someone somehow creates an invite with role "host", the join-now endpoint downgrades it to "guest". However, the invite creation endpoint (`roomInvites.ts`, line 63) hardcodes `role: "guest"`, so this should not happen in practice.

**Why this is a blocker:** Silent role downgrades mask potential bugs. If an attacker or coding error creates a host-role invite, the system should reject rather than silently accept.

**Recommendation:** Return a 401/403 error for invites with `role: "host"` at the join-now endpoint rather than silently downgrading.

---

## 4. INVITE-BASED JOIN

### Architecture

There are **two invite systems** running in parallel:

#### System 1: Legacy JWT Invites
- **Create:** `POST /api/invites/create` (`invites.ts:263`) — signs a JWT with room/role claims
- **Resolve:** `POST /api/invites/legacy/resolve` — converts legacy JWT → Firestore invite ID
- **Landing:** `InviteLanding.tsx` — resolves and redirects to `/invite/:inviteId`

#### System 2: Firestore-backed Invites (Current)
- **Create:** `POST /api/rooms/:roomId/invites` (`roomInvites.ts:26`)
- **Info:** `GET /api/invites/:inviteId/info` (`roomGuestAccess.ts:1175`) — public, read-only
- **Redeem:** `POST /api/invites/:inviteId/redeem` (`roomGuestAccess.ts:358`)
- **Join-Now:** `POST /api/invites/:inviteId/join-now` (`roomGuestAccess.ts:446`) — combined redeem + token mint
- **Landing:** `InviteRedeem.tsx` — pre-join page with display name input

### Invite Validation ✅

The `join-now` endpoint validates inside a Firestore transaction:
1. Invite exists (line 496)
2. Room ID present (line 502)
3. Not revoked (line 508)
4. Not expired — checks `expiresAt` timestamp (line 513-517)
5. Not max-used — atomic increment of `useCount` (lines 524-536)
6. Role validation — explicit role parsing, unknown roles rejected (lines 547-558)

### Rate Limiting ✅

Three independent rate limiters protect invite redemption:
1. **IP-based:** 12 requests per 60s per IP (`roomGuestAccess.ts:282-296`)
2. **Per-invite:** 20 joins per 30s per invite ID (`roomGuestAccess.ts:300-314`)
3. **Idempotency cache:** 10s dedup for same invite+device fingerprint (`roomGuestAccess.ts:317-350`)

### ⚠️ Rate Limiters Are In-Memory Only
**File:** `roomGuestAccess.ts:280-297`

All rate limiters use `Map<string, ...>` — they reset on server restart and don't work across multiple server instances. In a multi-instance deployment, effective rate limit is multiplied by instance count.

**Recommendation:** Accept for launch (adequate for single-instance Render deployment), but add Redis-backed rate limiting before scaling.

### Guest Session Cookie ✅

After invite redemption, an HttpOnly cookie `sl_guest` is set:
```typescript
res.cookie("sl_guest", sessionJwt, {
  httpOnly: true,
  sameSite: isProduction ? "none" : "lax",
  secure: isProduction,
  path: "/",
  maxAge: 2 * 60 * 60 * 1000, // 2 hours
});
```

- `SameSite=None` + `Secure=true` in production for cross-site compatibility (FB/IG in-app browsers)
- `httpOnly: true` prevents JS access
- 2-hour TTL exceeds LiveKit token TTL (30 min), enabling token refresh

---

## 5. DIRECT-LINK JOIN

### Endpoint
`POST /api/rooms/:roomId/join-guest` (`roomGuestAccess.ts:1235`)

### Flow
1. No auth required
2. Validates room exists and `allowGuests !== false`
3. Room must be "live" (unless `ALLOW_GUEST_DIRECT_JOIN_IDLE=1`)
4. Enforces capacity limit
5. Mints LiveKit token with `guest` role (30m TTL)
6. Creates synthetic guest session: `inviteId: "direct:${roomId}:${identity}"`
7. Sets HttpOnly cookie, returns all connection data

### Validations ✅
- Display name required and sanitized (line 1241-1243)
- IP rate limiting (line 1248)
- Room existence check (line 1253)
- `allowGuests` policy check (line 1264)
- Room status check (line 1270)
- Capacity enforcement (line 1275)

### Finding
- **[MEDIUM]** Direct-link join creates a guest with `inviteId: "direct:..."`. This bypasses the invite use-count tracking. There's no limit on how many times a direct-link can be used apart from capacity. This is by design (shared link), but should be documented.

---

## 6. PRE-JOIN / DEVICE SELECTION FLOW

### File
- `streamline-client/src/creator/pages/InviteRedeem.tsx` (324 lines)

### Flow
1. On mount, fetches `GET /api/invites/:inviteId/info` (read-only, no useCount burn)
2. Validates invite is still valid (not revoked, not expired, not max-used)
3. Shows room name, host name, live status badge
4. **In-app browser detection** with warning and "Copy link" button
5. Display name input (prefilled from localStorage `sl_displayName` or profile)
6. "Join Room" button calls `POST /api/invites/:inviteId/join-now`
7. Caches LiveKit token in `sessionStorage` for immediate Room.tsx use
8. Navigates to `/room/:roomId?gst=<token>`

### In-App Browser Detection ✅
**File:** `streamline-client/src/lib/detectInAppBrowser.ts`

Detects: Facebook, Instagram, TikTok, Twitter, LinkedIn, Snapchat, Pinterest, WhatsApp, WeChat, Line

Shows warning with platform-specific instructions (e.g., "Tap ⋯ (menu) → Open in browser" for Facebook/Instagram).

Provides "Copy link to open in browser" button.

### Display Name Preservation ✅
**File:** `streamline-client/src/lib/displayNameUtils.ts`

- `resolveDisplayName()`: Priority order: profile name → localStorage → empty
- `persistDisplayName()`: Saves to localStorage under `sl_displayName`
- `sanitizeDisplayName()`: Strips non-safe characters, max 50 chars
- On successful join, `persistDisplayName(name)` is called before navigation

### 🟡 HIGH PRIORITY: No device selection / preview before joining

There is **no pre-join device selection screen**. The InviteRedeem page shows a name input and "Join Room" button, but no camera/mic preview or device picker. The user goes directly from the invite page into the LiveKit room.

This is a poor UX for first-time users who may not know which device is selected, or whose mic/camera may be off. LiveKit Components React provides `<PreJoin>` component for this purpose.

**Recommendation:** Add a device preview step before connecting to LiveKit, especially for guest users who have no account setup.

---

## 7. PARTICIPANT PRESENCE AND RECONNECTION

### Presence Modes
**File:** `streamline-server/lib/presenceMode.ts`

Two modes:
- `normal`: Full publish, visible in roster
- `invisible`: Cannot publish, hidden from roster, can still subscribe and moderate

Legacy "silent" mode maps to "invisible" automatically.

### Presence Enforcement ✅
- Server-side: `applyPresenceModeToGrant()` strips publish capabilities from LiveKit token
- Metadata: `buildPresenceMetadata()` embeds `presenceMode` + `isVisibleInRoster` in LiveKit participant metadata
- Plan gating: Invisible host requires `invisibleHost` plan entitlement (`roomGuestAccess.ts:973-981`)

### Reconnection
**File:** `streamline-client/src/pages/Room.tsx`
**File:** `streamline-client/src/lib/mediaRecovery.ts`

- LiveKit handles WebRTC reconnection natively
- Custom `reconnectMedia()` function for media recovery on reconnect
- `RECONNECT_MEDIA_MESSAGE_TYPE` data channel message for cross-participant recovery signaling
- Guest session token stored in both `sessionStorage` and `localStorage` for resilience (InviteRedeem.tsx:98-101)

### Token Refresh for Guests ✅
**File:** `roomGuestAccess.ts:843-1133` (`POST /api/rooms/:roomId/token`)

Guests with pre-existing sessions (from join-now) can refresh LiveKit tokens without:
- The `ALLOW_GUEST_RTC_JOIN` env-var gate
- Room being "live"

This prevents disconnections during brief room status changes.

---

## 8. CAMERA/MIC/SCREEN-SHARE PUBLISHING

### LiveKit Grant-Based Control ✅

Publishing capabilities are controlled at two levels:

1. **Token-level grants** (at join time):
   - Guest/participant: `["microphone", "camera"]`
   - Host/cohost: `["microphone", "camera", "screen_share", "screen_share_audio"]`

2. **Runtime controls** via `PATCH /api/rooms/:roomId/controls/:identity`:
   - `canPublishAudio`, `canPublishVideo`, `canScreenShare`
   - `forcedMute`, `forcedVideoOff`
   - Applied via LiveKit `RoomServiceClient.updateParticipant()`

### Screen Share Configuration
**File:** `streamline-client/src/pages/Room.tsx`, lines 48-63

```typescript
const ROOM_OPTIONS: RoomOptions = {
  screenShareCaptureDefaults: {
    audio: {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
      channelCount: 2,
      sampleRate: 48000,
    },
    selfBrowserSurface: "include",
    systemAudio: "include",
    surfaceSwitching: "include",
  },
};
```

Stereo capture at 48kHz with no processing — optimized for system/tab audio quality.

---

## 9. LAYOUT SWITCHING

### Server-Side Layout State
**File:** `streamline-server/routes/roomsLayout.ts` (82 lines)
**File:** `streamline-server/lib/roomLayout.ts` (118 lines)

Layout modes: `grid`, `speaker`, `carousel`, `pip`
Output formats: `landscape_16x9`, `vertical_9x16`, `square_1x1`

- `GET /api/rooms/:roomId/layout` — any room participant (roomAccessToken)
- `PATCH /api/rooms/:roomId/layout` — host-only (Firebase auth + roomAccessToken)

### Studio Layout System
**File:** `streamline-server/routes/roomsStudioLayout.ts`
**File:** `streamline-server/lib/studioLayout.ts`

Separate system for controlling the compositor output layout with named presets and slot positions.

### Layout Persistence ✅
Layouts are persisted to Firestore `rooms/{roomId}.roomLayout` and applied to recordings/egress via `resolveCompositeLayoutFromRoom()`.

---

## 10. OUTPUT/PROGRAM STATE SYNCHRONIZATION

### Architecture
**File:** `streamline-server/routes/roomsProgramState.ts` (177 lines)
**File:** `streamline-server/lib/programState.ts` (154 lines)

Program state is the single source of truth for the composed output (RTMP/HLS/recording):

```typescript
type ProgramState = {
  programLayout: StudioLayoutPresetId | "custom" | null;
  programSlots: LayoutSlot[];
  programParticipants: string[];
  programMode: "standard" | "interview" | "screen-share" | "stacked" | "grid";
  programAspect: "landscape" | "portrait-instagram";
  screenShareIdentity: string | null;
  featuredParticipantIds: string[];
  updatedAt: string | null;
};
```

### Sync Mechanism (Dual-Write) ✅
When host updates program state:
1. **Firestore write** — `rooms/{roomId}.programState` (persistent)
2. **LiveKit room metadata broadcast** — fire-and-forget (real-time)

```typescript
// roomsProgramState.ts:159-166
await roomRef.set(
  { programState: merged, updatedAt: serverTimestamp },
  { merge: true },
);
// Fire-and-forget
broadcastProgramState(livekitRoomName, merged).catch(() => {});
```

### 🔴 RELEASE BLOCKER: Program state can drift between Firestore and LiveKit

**File:** `streamline-server/routes/roomsProgramState.ts`, line 165

The LiveKit metadata broadcast is fire-and-forget:
```typescript
broadcastProgramState(livekitRoomName, merged).catch(() => {});
```

If the LiveKit broadcast fails (network issue, room doesn't exist yet in LiveKit), Firestore has the state but LiveKit participants don't. There is no retry mechanism or reconciliation.

**Impact:** The compositor (egress template `program-compositor.html`) reads from LiveKit room metadata. If it misses an update, the output will render stale state until the next update succeeds.

**Recommendation:**
1. Add retry with exponential backoff (3 attempts, 1s/2s/4s)
2. Or: Have the compositor poll Firestore as a fallback
3. Or: Add a reconciliation check on compositor connect

---

## 11. SSE/EVENT STREAM/CONTROL STREAM DEPENDENCIES

### SSE Endpoints Found

| Endpoint | File | Auth | Purpose |
|----------|------|------|---------|
| `GET /api/rooms/:roomId/controls/stream` | `roomControls.ts:735` | `requireRoomAccessToken` | Real-time control updates |
| `GET /api/rooms/:roomId/chat/stream` | `roomChat.ts:367` | `requireRoomAccessToken` | Real-time chat messages |

### SSE Security ✅

Both SSE endpoints:
1. Require `roomAccessToken` (verified server-side)
2. Validate `access.roomId === req.params.roomId`
3. Use Firestore `onSnapshot` for real-time updates
4. Clean up listeners on `req.on("close")`
5. Send periodic heartbeats (20s chat, 25s controls)

### SSE Token Delivery for EventSource

Since `EventSource` cannot set custom headers, the room access token is passed via query parameter:
```typescript
// roomAccessToken.ts:86-88
const fromQuery = (req.query as any)?.t as string | undefined;
if (typeof fromQuery === "string" && fromQuery.trim()) {
  return fromQuery.trim();
}
```

This is documented as a known limitation and is scoped to a single-room token.

### 🟡 HIGH PRIORITY: SSE query param token in URL may be logged

**File:** `streamline-server/middleware/roomAccessToken.ts`, lines 85-89

The room access token passed via `?t=<token>` will appear in:
- Server access logs
- CDN/proxy logs
- Browser history

The token has a 12-hour TTL and is room-scoped, limiting damage. But this should be documented as a known risk.

**Recommendation:** Rotate tokens more aggressively (e.g., 1-hour TTL for SSE-delivered tokens) and ensure access logs don't persist beyond retention policy.

---

## 12. MOBILE/BROWSER EDGE CASES

### In-App Browser Detection ✅
**File:** `streamline-client/src/lib/detectInAppBrowser.ts` (55 lines)

Comprehensive detection of 10+ in-app browsers with:
- Warning banner on invite page
- Platform-specific instructions
- "Copy link" button for easy browser switch

### Invite Link Reliability Across Platforms

The invite flow is designed for cross-platform reliability:
1. **URL format:** `/invite/:inviteId` — simple, no special characters
2. **No auth required** for info fetch or redeem
3. **HttpOnly cookie with SameSite=None** — works in cross-site contexts
4. **Guest session token also in response body** — client stores in sessionStorage/localStorage as fallback
5. **Query param fallback** — `?gst=<token>` for browsers that strip cookies

### 🟡 HIGH PRIORITY: Cookie may not persist in some in-app browsers

**File:** `roomGuestAccess.ts:412-424`

Despite `SameSite=None; Secure`, some in-app browsers (notably Instagram's WebView on iOS) aggressively clear cookies between navigations. The fallback chain is:
1. HttpOnly cookie `sl_guest`
2. `sessionStorage` key `sl_guest_session:{roomId}`
3. `localStorage` key `sl_guestSessionToken`
4. Query param `?gst=<token>`

This multi-layer approach is thorough, but the query param fallback puts the JWT in the URL.

### 🟡 HIGH PRIORITY: Display name may revert to "Guest" on token refresh

**File:** `roomGuestAccess.ts:959`
```typescript
const displayName = sanitizeDisplayName(
  String(req.body?.displayName || req.body?.identity || "Guest")
).trim() || "Guest";
```

On token refresh (`POST /api/rooms/:roomId/token`), if the client doesn't re-send `displayName` in the body, the LiveKit participant name reverts to "Guest". The persisted display name is only in the client's localStorage — the server has no memory of it.

**Impact:** After a LiveKit reconnection, a guest's name could change from "John" to "Guest" for all other participants.

**Recommendation:** Store the display name in the guest session JWT claims or in the Firestore controls doc, and use it as a fallback during token refresh.

---

## ADDITIONAL FINDINGS

### Passcode Check Is Plaintext Comparison
**File:** `roomToken.ts:444-446`
```typescript
if (data.requirePasscode) {
  if (!passcode || passcode !== data.requirePasscode) {
    return { ok: false, reason: "passcode_required" } as const;
  }
}
```
Passcodes are stored and compared in plaintext. For viewer invite passcodes this is acceptable (low-security gate), but should be noted.

### Viewer Invite System is Separate from Room Invite System
**File:** `roomToken.ts:399-468`

There's a `viewerInvites` Firestore collection separate from `roomInvites`. The viewer invite system tracks sessions in arrays and has its own validation logic. This creates two parallel invite systems (three counting legacy JWT invites).

### Capacity Lock Has 10s TTL
**File:** `roomToken.ts:284`, `roomGuestAccess.ts:135`

The Firestore-based capacity lock has a 10-second TTL. If a join request takes >10s (slow LiveKit response), another request could slip through during the same slot, potentially exceeding capacity by 1.

### Test Coverage
Found test files:
- `streamline-server/lib/livekitPermissions.test.ts` — 4 tests for presence mode grants
- `streamline-server/lib/roomGuestAccessInvite.test.ts` — invite validation tests
- `streamline-server/lib/studioLayout.test.ts`
- `streamline-server/lib/verticalLayouts.test.ts`
- `streamline-client/src/lib/__tests__/studioLayout.test.ts`
- `streamline-client/src/lib/__tests__/verticalLayouts.test.ts`

**Missing:** No integration tests for the full join flow, no tests for token minting, no tests for role enforcement.

---

## VERIFICATION SUMMARY

### ✅ Users can join without login where intended
- Invite-based: `POST /api/invites/:inviteId/join-now` — no auth
- Direct link: `POST /api/rooms/:roomId/join-guest` — no auth
- Both correctly mint guest-level tokens

### ⚠️ Display names are preserved — with a gap
- Persisted to localStorage on client
- Passed to LiveKit token `name` field on join
- **Gap:** Not preserved across token refresh (reverts to "Guest")

### ✅ Invite links work across email/text/social wrappers
- In-app browser detected and warned
- Cookie + sessionStorage + localStorage + query param fallback chain
- Simple `/invite/:id` URL format

### ⚠️ Room state and output state can drift
- Firestore write is persistent and reliable
- LiveKit metadata broadcast is fire-and-forget with no retry
- Drift possible on transient network failures

### ✅ Permissions are enforced server-side
- LiveKit token grants enforce publish capabilities
- Room access token carries role + permissions
- Every mutation endpoint checks role server-side
- Host role derived from ownership, never client request
- Non-owner requesting "host" is silently downgraded to "participant"

---

## RELEASE BLOCKERS (Must Fix)

| # | Issue | File | Line | Severity |
|---|-------|------|------|----------|
| 1 | Dead `roomTokenRoute` import — verify client doesn't use `/api/roomToken` and remove | `index.ts` | 16 | 🔴 Cleanup/verify |
| 2 | join-now accepts `role: "host"` on invite — should reject instead of silently downgrade | `roomGuestAccess.ts` | 548-558, 662 | 🔴 Security hardening |
| 3 | Program state LiveKit broadcast has no retry — compositor can render stale output | `roomsProgramState.ts` | 165 | 🔴 Functional |

## HIGH PRIORITY (Should Fix Before Launch)

| # | Issue | File | Severity |
|---|-------|------|----------|
| 4 | Display name reverts to "Guest" on token refresh | `roomGuestAccess.ts:959` | 🟡 |
| 5 | SSE token in URL querystring logged | `roomAccessToken.ts:85-89` | 🟡 |
| 6 | No pre-join device preview for guests | `InviteRedeem.tsx` | 🟡 |
| 7 | `isHostOrCohost()` misleading name (only checks host) | `roomControls.ts:225` | 🟡 |
| 8 | In-memory rate limiters don't work in multi-instance | `roomGuestAccess.ts:282` | 🟡 |

## MEDIUM PRIORITY

| # | Issue | File | Severity |
|---|-------|------|----------|
| 9 | No rate limiting on room creation | `roomsCreate.ts` | 🟠 |
| 10 | Direct-link join bypasses invite use-count tracking | `roomGuestAccess.ts:1235` | 🟠 |
| 11 | Three parallel invite systems (legacy JWT, Firestore roomInvites, viewerInvites) | Multiple | 🟠 |
| 12 | Capacity lock 10s TTL may allow off-by-one overflow | `roomToken.ts:284` | 🟠 |
| 13 | Passcode stored/compared in plaintext | `roomToken.ts:444` | 🟠 |
| 14 | No integration tests for join flows | — | 🟠 |
| 15 | Cookie-less guests on in-app browsers rely on URL token | `roomGuestAccess.ts` | 🟠 |
| 16 | `roomToken.ts` (1,185 lines) is dead code — remove entirely | `roomToken.ts` | 🟠 |
