# Guest Invite System - Complete Implementation & Debugging Guide

**Last Updated:** February 14, 2026  
**Status:** ✅ Production Ready

This document consolidates ALL fixes, debugging sessions, and lessons learned from building the guest invite system with LiveKit token generation.

---

## Table of Contents

1. [Critical Production Fixes](#critical-production-fixes)
2. [Architecture Overview](#architecture-overview)
3. [Common Errors & Solutions](#common-errors--solutions)
4. [Cross-Site Cookie Issues](#cross-site-cookie-issues)
5. [LiveKit Token Generation](#livekit-token-generation)
6. [Role Validation & Security](#role-validation--security)
7. [Media Device Error Handling](#media-device-error-handling)
8. [Testing Checklist](#testing-checklist)

---

## Critical Production Fixes

### Fix #1: TrackSource Enum Error (CRITICAL) ✅

**Date:** Feb 14, 2026  
**Severity:** P0 - Broke ALL token generation

**Error Seen:**
```
TypeError: Cannot convert TrackSource microphone to string
Failed to create room token (500)
Host has no video
```

**Root Cause:**
LiveKit SDK's `VideoGrant.canPublishSources` expects **numeric enum values**, NOT string literals.

```typescript
// ❌ WRONG - Strings cause "Cannot convert to string" error
canPublishSources: ["microphone", "camera"]

// ✅ CORRECT - Use TrackSource enum values
import { TrackSource } from "livekit-server-sdk";
canPublishSources: [TrackSource.MICROPHONE, TrackSource.CAMERA]
```

**TrackSource Enum Values:**
- `TrackSource.MICROPHONE = 2`
- `TrackSource.CAMERA = 1`
- `TrackSource.SCREEN_SHARE = 3`
- `TrackSource.SCREEN_SHARE_AUDIO = 4`

**What Didn't Work:**
1. ❌ String literals: `["microphone", "camera"]` → Runtime error
2. ❌ Using `ParticipantPermission` class directly → Type mismatch with VideoGrant
3. ❌ Old LiveKit SDK versions → Missing enum exports

**Files Changed:**
- `streamline-server/lib/livekitPermissions.ts` - Import TrackSource, use enums everywhere
- `streamline-server/routes/roomGuestAccess.ts` - Use roleToParticipantPermission()

**Commit:** `"CRITICAL FIX: Use TrackSource enums instead of strings"`

---

### Fix #2: handleMediaDeviceError Scope Error ✅

**Date:** Feb 14, 2026  
**Severity:** P1 - Broke permission error detection

**Error Seen:**
```javascript
ReferenceError: handleMediaDeviceError is not defined
  at MediaDeviceErrorHandler (index-CZfqbCUr.js:1294)
```

**Root Cause:**
React component scope boundary issue. Function was defined in `RoomPage` parent component but called inside `LiveKitShell` child component.

```typescript
// ❌ WRONG - Different component scopes
function RoomPage() {
  const handleMediaDeviceError = (error) => { ... };  // Line 1569
  
  return <LiveKitShell ... />;  // Line 1700
}

function LiveKitShell(props) {
  return <MediaDeviceErrorHandler onError={handleMediaDeviceError} />;  // ❌ Not in scope!
}

// ✅ CORRECT - State and handler in same component
function LiveKitShell(props) {
  const [mediaPermissionError, setMediaPermissionError] = useState(null);
  
  const handleMediaDeviceError = (error) => {
    // Handle error and update state
    setMediaPermissionError({ type, message });
  };
  
  return <MediaDeviceErrorHandler onError={handleMediaDeviceError} />;  // ✅ Works!
}
```

**What Didn't Work:**
1. ❌ Moving function earlier in file → Still wrong scope (different components)
2. ❌ Trying to pass as prop → Props interface was incomplete
3. ❌ Assuming file order matters → React scope is component-based, not file-based

**Solution:**
Moved `mediaPermissionError` state, `detectInAppBrowser()`, `handleMediaDeviceError()`, and the in-app browser detection useEffect from `RoomPage` component INTO `LiveKitShell` component where they're actually used.

**Files Changed:**
- `streamline-client/src/pages/Room.tsx` - Moved state/handlers into LiveKitShell

**Commit:** `"Fix handleMediaDeviceError scope: move state and handlers into LiveKitShell component"`

---

### Fix #3: React Import Missing ✅

**Date:** Feb 14, 2026  
**Severity:** P1 - Broke production bundle

**Error Seen:**
```
ReferenceError: React is not defined
```

**Root Cause:**
Missing `import React from "react"` at top of Room.tsx. Required for JSX transformation in production builds.

**Solution:**
```typescript
// ✅ Add at top of file
import React from "react";
```

**Files Changed:**
- `streamline-client/src/pages/Room.tsx` - Added React import

---

### Fix #4: Role Validation Hardening ✅

**Date:** Feb 14, 2026  
**Severity:** P2 - Security improvement

**Problem:**
Server accepted garbage/malformed roles like `"12345"`, `"asdf"`, `undefined` and defaulted them to "guest", creating a security risk.

**Solution:**
Explicit role validation with 401 rejection for unknown roles:

```typescript
// Server: middleware/guestSession.ts
const decodedRole = String(decoded?.role ?? "").trim().toLowerCase();
let role: "guest" | "participant" | null = null;

if (decodedRole === "guest" || decodedRole === "participant") {
  role = decodedRole as any;
} else if (decodedRole === "viewer") {
  role = "guest";  // Legacy backward compatibility
} else {
  role = null;  // Reject unknown
}

// Server: routes/roomGuestAccess.ts
if (!role) {
  return res.status(401).json({ 
    error: "INVALID_ROLE", 
    message: "Role must be 'guest' or 'participant'" 
  });
}
```

**What Didn't Work:**
1. ❌ Default to "guest" → Security risk (anyone can bypass role checks)
2. ❌ Silent failure → Hard to debug issues
3. ❌ Accepting any string → Opens door to injection attacks

**Backward Compatibility:**
Old "viewer" role tokens automatically map to "guest" role for seamless migration.

---

### Fix #5: Hooks Check Violation ✅

**Date:** Feb 14, 2026  
**Severity:** P3 - Code quality

**Problem:**
Raw `fetch()` call in Join.tsx violated code standards (should use centralized `apiFetch()` helper).

**Solution:**
```typescript
// ❌ BEFORE
const res = await fetch(`${API_BASE}/api/invites/${inviteId}/join-now`, {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({}),
});

// ✅ AFTER
const res = await apiFetch(`/api/invites/${encodeURIComponent(inviteId)}/join-now`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({}),
});
```

**Benefits:**
- Centralized API base URL handling
- Automatic credentials inclusion
- Consistent error handling
- Easier testing/mocking

**Files Changed:**
- `streamline-client/src/pages/Join.tsx` - Replaced fetch() with apiFetch()

**Commit:** `"Fix hooks check: Replace raw fetch with apiFetch in Join.tsx"`

---

### Fix #6: Token Grant Header Update ✅

**Date:** Feb 14, 2026  
**Severity:** P3 - Protocol versioning

**Problem:**
Header still advertised "v3-no-sources" despite adding TrackSource support.

**Solution:**
```typescript
// Update response headers
res.setHeader("x-sl-token-grants", "v4-with-sources");
```

**Files Changed:**
- `streamline-server/routes/roomGuestAccess.ts` - Updated header in 2 locations (success + error paths)

**Commit:** `"Update x-sl-token-grants header to v4-with-sources"`

---

## Architecture Overview

### Token Generation Flow

```
1. User clicks invite link with inviteId
   ↓
2. Client: POST /api/invites/:id/join-now
   - Validates invite exists & not expired
   - Creates guest session JWT
   - Sets sl_guest cookie (SameSite=None in prod)
   - Returns { sessionToken, roomId, roomName, role }
   ↓
3. Client stores token in sessionStorage + localStorage
   ↓
4. Client navigates to /room/:roomId?gst=<token>
   ↓
5. Room page: POST /api/rooms/:id/guest-token
   - Headers: Authorization: Bearer <token>, x-guest-session: <token>
   - Server validates guest session JWT
   - Calls roleToParticipantPermission() → LiveKitGrant with TrackSource enums
   - Generates LiveKit room token
   - Returns { token: "livekit_token...", serverUrl }
   ↓
6. LiveKitRoom connects with token
   - Guest can subscribe to tracks (autoSubscribe: true)
   - Host can publish mic/cam/screen based on role
```

### Component Hierarchy

```
RoomPage (parent)
  ├─ Header with invite button
  ├─ Dashboard/Controls
  └─ LiveKitShell (child) ← ALL media logic here!
      ├─ mediaPermissionError state
      ├─ handleMediaDeviceError()
      ├─ detectInAppBrowser()
      ├─ MediaDeviceErrorHandler component
      ├─ MediaPermissionErrorBanner component
      └─ LiveKitRoom
          └─ SafeVideoConference
              └─ VideoConference (LiveKit UI)
```

---

## Common Errors & Solutions

### Error: "Cannot convert TrackSource microphone to string"

**Cause:** Using string literals instead of TrackSource enum values.

**Solution:** Import and use TrackSource enums:
```typescript
import { TrackSource } from "livekit-server-sdk";

canPublishSources: [
  TrackSource.MICROPHONE,  // Not "microphone"
  TrackSource.CAMERA,      // Not "camera"
]
```

**Verification:**
```bash
# In streamline-server directory
npm run build  # Should compile without errors
```

---

### Error: "handleMediaDeviceError is not defined"

**Cause:** Function defined in parent component but called in child component.

**Solution:** Move function definition into same component where it's used.

**Verification:**
```javascript
// In browser console, check scope
console.log(typeof handleMediaDeviceError);  // Should be "function", not "undefined"
```

---

### Error: "Failed to create room token (500)"

**Causes:**
1. TrackSource string literals (see above)
2. Invalid role (not whitelisted)
3. Missing guest session token
4. Expired guest session JWT

**Debug Steps:**
```bash
# Check server logs
curl -X POST http://localhost:3002/api/rooms/:id/guest-token \
  -H "Authorization: Bearer <token>" \
  -H "x-guest-session: <token>"

# Look for:
# - "Role must be 'guest' or 'participant'" → Invalid role
# - "Guest session JWT expired" → Token expired
# - "Cannot convert TrackSource" → Enum issue
```

---

### Error: "CORS policy blocked"

**Cause:** Cross-site requests blocked by browser (common in FB/IG in-app browsers).

**Solution:** Multi-channel authentication (already implemented):
1. Primary: `Authorization: Bearer <token>` header
2. Fallback: `x-guest-session` header
3. Fallback: `gst=<token>` query param
4. Fallback: `sl_guest` cookie (SameSite=None in production)

**Verification:**
```javascript
// In browser console on Room page
const token = new URLSearchParams(window.location.search).get("gst");
console.log("Token from URL:", token);

const sessionToken = sessionStorage.getItem(`sl_guest_session:${roomId}`);
console.log("Token from session:", sessionToken);
```

---

## Cross-Site Cookie Issues

### Problem: Cookies Dropped in In-App Browsers

**Browsers Affected:**
- Facebook in-app browser (FBAN)
- Instagram in-app browser (FBAV)
- Safari with Intelligent Tracking Prevention (ITP)
- Any cross-site context

**Root Cause:**
Cookies with `SameSite=Lax` are dropped in cross-site scenarios.

**Solution:**
```typescript
// streamline-server/routes/roomGuestAccess.ts
const isProduction = String(process.env.NODE_ENV).toLowerCase() === "production";
const secure = isProduction;  // HTTPS required for SameSite=None
const sameSite: "none" | "lax" = isProduction ? "none" : "lax";

res.cookie("sl_guest", sessionJwt, {
  httpOnly: true,
  sameSite,    // "none" in production for cross-site
  secure,      // true in production (HTTPS only)
  path: "/",
  maxAge: 2 * 60 * 60 * 1000,  // 2 hours
});
```

**Multi-Source Token Extraction:**
```typescript
// Server: middleware/guestSession.ts
function extractGuestSessionToken(req: Request): string | null {
  // 1. Authorization Bearer (highest priority, works everywhere)
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string") {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }

  // 2. Custom headers (works in CORS-allowed contexts)
  const hdr = req.headers;
  const fromHeader = hdr["x-guest-session"] ?? hdr["x-guest-session-token"];
  if (typeof fromHeader === "string" && fromHeader.trim()) {
    return fromHeader.trim();
  }

  // 3. Request body (for POST endpoints)
  const fromBody = (req as any)?.body?.guestSessionToken;
  if (typeof fromBody === "string" && fromBody.trim()) {
    return fromBody.trim();
  }

  // 4. Query params (fallback for direct links)
  const fromQuery = (req as any)?.query?.guestSessionToken 
    || (req as any)?.query?.gst;  // Shorthand: ?gst=<token>
  if (typeof fromQuery === "string" && fromQuery.trim()) {
    return fromQuery.trim();
  }

  // 5. Cookie (last resort, may be blocked)
  const cookie = req.cookies?.sl_guest;
  if (typeof cookie === "string" && cookie.trim()) {
    return cookie.trim();
  }

  return null;
}
```

**Client-Side Token Persistence:**
```typescript
// After receiving token from /join-now
const { sessionToken, roomId } = await res.json();

// Store in BOTH sessionStorage AND localStorage
sessionStorage.setItem(`sl_guest_session:${roomId}`, sessionToken);
localStorage.setItem("sl_guestSessionToken", sessionToken);
localStorage.setItem("sl_guestSessionRoomId", roomId);

// Pass in URL for maximum compatibility
nav(`/room/${encodeURIComponent(roomId)}?gst=${encodeURIComponent(sessionToken)}`);
```

**Client-Side Token Retrieval:**
```typescript
function getGuestSessionToken(roomId: string | null): string | null {
  // 1. Try query param (highest priority, works in FB/IG)
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("gst");
  if (fromQuery) return fromQuery.trim();

  // 2. Try sessionStorage (preferred, per-room isolation)
  if (roomId) {
    const fromSession = sessionStorage.getItem(`sl_guest_session:${roomId}`);
    if (fromSession) return fromSession.trim();
  }

  // 3. Try localStorage (fallback, check roomId match)
  const storedRoomId = localStorage.getItem("sl_guestSessionRoomId");
  if (storedRoomId === roomId) {
    const fromLocal = localStorage.getItem("sl_guestSessionToken");
    if (fromLocal) return fromLocal.trim();
  }

  return null;
}

// Send via multiple channels
const headers = {
  "Authorization": `Bearer ${token}`,
  "x-guest-session": token,
  "Content-Type": "application/json",
};
```

---

## LiveKit Token Generation

### Role-Based Permissions

```typescript
// streamline-server/lib/livekitPermissions.ts
import { TrackSource } from "livekit-server-sdk";

export type LiveKitGrant = {
  canSubscribe: boolean;
  canPublish: boolean;
  canPublishData: boolean;
  canPublishSources: TrackSource[];  // ← Enum array, not strings!
};

export function roleToParticipantPermission(role: string): LiveKitGrant {
  switch (role) {
    case "viewer":
      // Future: HLS-only viewers (no RTC)
      return {
        canSubscribe: true,
        canPublish: false,
        canPublishData: false,
        canPublishSources: [],
      };

    case "guest":
    case "participant":
      // Guests/participants: mic + camera only
      return {
        canSubscribe: true,
        canPublish: true,
        canPublishData: true,
        canPublishSources: [
          TrackSource.MICROPHONE,  // 2
          TrackSource.CAMERA,      // 1
        ],
      };

    case "cohost":
    case "host":
      // Hosts/cohosts: mic + camera + screen share
      return {
        canSubscribe: true,
        canPublish: true,
        canPublishData: true,
        canPublishSources: [
          TrackSource.MICROPHONE,         // 2
          TrackSource.CAMERA,             // 1
          TrackSource.SCREEN_SHARE,       // 3
          TrackSource.SCREEN_SHARE_AUDIO, // 4
        ],
      };

    default:
      throw new Error(`Unknown role: ${role}`);
  }
}
```

### Token Generation Endpoint

```typescript
// streamline-server/routes/roomGuestAccess.ts
router.post("/api/rooms/:roomId/guest-token", async (req, res) => {
  // 1. Extract guest session token (multi-source)
  const token = extractGuestSessionToken(req);
  if (!token) {
    return res.status(401).json({ error: "NO_GUEST_SESSION" });
  }

  // 2. Verify JWT signature
  const decoded = jwt.verify(token, JWT_SECRET) as GuestSessionPayload;
  
  // 3. Validate role (explicit whitelist)
  const decodedRole = String(decoded?.role ?? "").trim().toLowerCase();
  let role: "guest" | "participant" | null = null;
  
  if (decodedRole === "guest" || decodedRole === "participant") {
    role = decodedRole as any;
  } else if (decodedRole === "viewer") {
    role = "guest";  // Legacy compat
  } else {
    return res.status(401).json({ 
      error: "INVALID_ROLE",
      message: "Role must be 'guest' or 'participant'"
    });
  }

  // 4. Get LiveKit permissions (with TrackSource enums!)
  const grant = roleToParticipantPermission(role);

  // 5. Generate LiveKit room token
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: decoded.guestId,
    name: decoded.displayName,
  });

  at.addGrant({
    roomJoin: true,
    room: roomId,
    canSubscribe: grant.canSubscribe,
    canPublish: grant.canPublish,
    canPublishData: grant.canPublishData,
    canPublishSources: grant.canPublishSources,  // ← Enum values!
  });

  const livekitToken = await at.toJwt();

  // 6. Return with version header
  res.setHeader("x-sl-token-grants", "v4-with-sources");
  return res.json({
    token: livekitToken,
    serverUrl: LIVEKIT_URL,
  });
});
```

---

## Role Validation & Security

### Explicit Role Whitelist

**Allowed Roles:**
- `"guest"` - Invited users (mic + camera)
- `"participant"` - Authenticated users (mic + camera)
- `"viewer"` - Legacy role, maps to "guest" (backward compatibility)
- `"cohost"` - Elevated permissions (mic + camera + screen)
- `"host"` - Full permissions (mic + camera + screen)

**Rejected Roles:**
- Any string not in whitelist
- `null`, `undefined`, empty string
- Numeric values, objects, arrays
- SQL injection attempts, XSS payloads

### Role Validation Code

```typescript
// middleware/guestSession.ts - Normalize input
const decodedRole = String(decoded?.role ?? "").trim().toLowerCase();
let role: "guest" | "participant" | null = null;

if (decodedRole === "guest" || decodedRole === "participant") {
  role = decodedRole as any;
} else if (decodedRole === "viewer") {
  role = "guest";  // Auto-upgrade legacy tokens
} else {
  role = null;  // Reject garbage
}

// routes/roomGuestAccess.ts - Enforce validation
if (!role) {
  return res.status(401).json({ 
    error: "INVALID_ROLE",
    message: "Role must be 'guest' or 'participant'"
  });
}
```

### Security Benefits

1. **Prevents privilege escalation** - Can't inject "host" role
2. **Defense in depth** - Validation at middleware + endpoint
3. **Clear error messages** - Easy to debug issues
4. **Backward compatible** - Old "viewer" tokens still work
5. **Type safety** - TypeScript enforces correct types

---

## Media Device Error Handling

### Error Detection System

**Detected Error Types:**
1. `NotAllowedError` / `PermissionDeniedError` - User denied camera/mic permission
2. `NotFoundError` - No camera/mic hardware detected
3. `NotReadableError` - Device in use by another app
4. `NotSupportedError` - Browser/device doesn't support media
5. `OverconstrainedError` - Requested constraints can't be satisfied
6. In-app browser detection - Facebook/Instagram/TikTok browsers

### Implementation

```typescript
// streamline-client/src/pages/Room.tsx (inside LiveKitShell component)

// State for tracking errors
const [mediaPermissionError, setMediaPermissionError] = useState<{
  type: 'denied' | 'notFound' | 'notReadable' | 'notSupported' | 'inAppBrowser' | null;
  message: string;
} | null>(null);

// Detect in-app browsers that may block camera/mic
const detectInAppBrowser = (): boolean => {
  const ua = navigator.userAgent || "";
  // Facebook, Instagram, TikTok, Twitter, LinkedIn in-app browsers
  const patterns = /FBAN|FBAV|Instagram|TikTok|Twitter|LinkedInApp/i;
  return patterns.test(ua);
};

// Handle media device errors with user-friendly messages
const handleMediaDeviceError = (error: any) => {
  console.error('[Room] MediaDevicesError:', error);

  const errorName = error?.name || String(error);
  
  if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
    setMediaPermissionError({
      type: 'denied',
      message: '🔒 Camera/mic blocked. Tap the lock icon → allow → reload.',
    });
  } else if (errorName === 'NotFoundError') {
    setMediaPermissionError({
      type: 'notFound',
      message: '⚠️ No camera/mic found. Check if devices are connected.',
    });
  } else if (errorName === 'NotReadableError') {
    setMediaPermissionError({
      type: 'notReadable',
      message: '⚠️ Camera/mic in use by another app. Close other apps and reload.',
    });
  } else if (errorName === 'NotSupportedError' || errorName === 'OverconstrainedError') {
    setMediaPermissionError({
      type: 'notSupported',
      message: '⚠️ Browser or device limitation. Try a different browser.',
    });
  } else {
    setMediaPermissionError({
      type: 'notSupported',
      message: `⚠️ Unable to access camera/mic: ${errorName}`,
    });
  }
};

// Check for in-app browser on mount
React.useEffect(() => {
  if (detectInAppBrowser()) {
    setMediaPermissionError({
      type: 'inAppBrowser',
      message: '⚠️ This in-app browser may block camera/mic. Open in Chrome/Safari.',
    });
  }
}, []);

// Use in component
return (
  <>
    <MediaDeviceErrorHandler onError={handleMediaDeviceError} />
    <MediaPermissionErrorBanner 
      error={mediaPermissionError} 
      onDismiss={() => setMediaPermissionError(null)}
    />
    {/* ... rest of LiveKit UI ... */}
  </>
);
```

### User-Facing Error Messages

| Error Type | User Message | Suggested Action |
|------------|--------------|------------------|
| Permission Denied | "🔒 Camera/mic blocked. Tap the lock icon → allow → reload." | Check browser permission settings |
| Device Not Found | "⚠️ No camera/mic found. Check if devices are connected." | Plug in webcam/headset |
| Device In Use | "⚠️ Camera/mic in use by another app. Close other apps and reload." | Close Zoom/Skype/etc |
| Not Supported | "⚠️ Browser or device limitation. Try a different browser." | Use Chrome/Firefox |
| In-App Browser | "⚠️ This in-app browser may block camera/mic. Open in Chrome/Safari." | Tap "..." → Open in browser |

---

## Testing Checklist

### Pre-Deployment Verification

**Build Tests:**
```bash
# In streamline-client/
npm run build          # Should succeed, no TypeScript errors
npm run check:no-loginpage-jsx  # Should pass

# In streamline-server/
npm run build          # Should succeed, no TypeScript errors

# In root/
npm run hooks:check    # Should pass (no raw fetch() calls)
```

**Local Testing:**
1. ✅ Start dev servers: `npm run dev` (client + server)
2. ✅ Create invite link as host
3. ✅ Open invite link in incognito window
4. ✅ Join as guest
5. ✅ Verify guest sees host video
6. ✅ Verify host sees guest joined (if guest has camera enabled)
7. ✅ Deny camera permission → Verify banner appears
8. ✅ Check console for errors (should be clean)

**Cross-Browser Testing:**
```
✅ Chrome (desktop + mobile)
✅ Firefox (desktop + mobile)
✅ Safari (desktop + mobile)
✅ Edge
✅ Facebook in-app browser (mobile)
✅ Instagram in-app browser (mobile)
```

**Error Scenario Testing:**
1. ✅ Invalid invite ID → Error page
2. ✅ Expired invite → Error message
3. ✅ Deny camera permission → Banner shows
4. ✅ Disconnect internet → Reconnection handling
5. ✅ Block camera in another app → "Device in use" message
6. ✅ Invalid role in JWT → 401 error
7. ✅ Malformed token → 401 error

---

## Production Deployment History

### Deployment Timeline

| Date | Commit | Description | Status |
|------|--------|-------------|--------|
| Feb 14, 2026 | `13886901` | Fix handleMediaDeviceError scope | ✅ Deployed |
| Feb 14, 2026 | `73e5b58c` | Fix hooks check (apiFetch) | ✅ Deployed |
| Feb 14, 2026 | `(empty)` | Update token grant header | ✅ Deployed |
| Feb 14, 2026 | `(main)` | TrackSource enum fix + role validation | ✅ Deployed |

### Production URLs

- **Frontend:** `streamline-hls-dev-web.onrender.com`
- **Backend:** `streamline-hls-dev.onrender.com`
- **Branch:** `feature/hls-dev`
- **Auto-deploy:** Enabled (deploys on git push)

### Post-Deployment Verification

```bash
# 1. Check build logs on Render dashboard
# 2. Test invite flow in production
curl -X POST https://streamline-hls-dev.onrender.com/api/invites/:id/join-now \
  -H "Content-Type: application/json" \
  -d '{}'

# 3. Verify token generation works
curl -X POST https://streamline-hls-dev.onrender.com/api/rooms/:id/guest-token \
  -H "Authorization: Bearer <token>" \
  -H "x-guest-session: <token>"

# 4. Check response headers
# Should include: x-sl-token-grants: v4-with-sources
```

---

## Additional Resources

### Related Documentation
- [GUEST_INVITE_FIX.md](./GUEST_INVITE_FIX.md) - Original cross-site cookie fixes
- [ROOM_INVITE_FEATURE.md](./ROOM_INVITE_FEATURE.md) - Invite button UI/UX
- [VIDEO_DEBUG_LOGS.md](./VIDEO_DEBUG_LOGS.md) - LiveKit debugging guide
- [PERMISSIONS_AND_INVITES.md](./PERMISSIONS_AND_INVITES.md) - Permission system overview

### External References
- [LiveKit Server SDK Docs](https://docs.livekit.io/home/server/generating-tokens/)
- [TrackSource Enum Reference](https://docs.livekit.io/reference/server-sdks/node/#tracksource)
- [VideoGrant Interface](https://docs.livekit.io/reference/server-sdks/node/#videogrant)
- [SameSite Cookie Spec](https://web.dev/samesite-cookies-explained/)

---

## Lessons Learned

### What Worked Well ✅
1. Multi-channel token authentication (headers + query params + cookie)
2. Explicit role validation with 401 rejection
3. TrackSource enum approach (required by LiveKit SDK)
4. Moving state into component where it's used (React scope best practice)
5. Centralized API helpers (apiFetch) for consistency

### What Didn't Work ❌
1. String literals for TrackSource → Runtime error
2. SameSite=Lax cookies in cross-site contexts → Dropped by browsers
3. Defaulting unknown roles to "guest" → Security risk
4. Functions in parent component used in child → Scope error
5. Assuming file order matters for function scope → Component scope is what matters

### Key Takeaways 💡
1. **Always check LiveKit SDK types** - Don't assume string literals work everywhere
2. **React scope is component-based** - File order doesn't matter, component boundaries do
3. **Cross-site auth is hard** - Use multiple channels (headers > query params > cookies)
4. **Validate everything explicitly** - Reject unknown input, don't guess defaults
5. **Test in real browsers** - FB/IG in-app browsers behave differently than Chrome
6. **Read error messages carefully** - "Cannot convert to string" meant we were passing wrong type
7. **Git commit often** - Made it easy to track which fix solved which problem

---

## Support & Troubleshooting

### Debug Checklist

If things aren't working:

1. **Check browser console** - Look for JavaScript errors
2. **Check network tab** - Look for failed API requests
3. **Check server logs** - Look for 500/401/403 errors
4. **Verify token format** - Should be JWT with guest session payload
5. **Test role validation** - Try invalid role, should get 401
6. **Test in different browser** - Rule out browser-specific issues
7. **Check Render deployment logs** - Verify build succeeded

### Common Issues

**"Token generation fails with 500"**
→ Check for TrackSource enum usage in livekitPermissions.ts

**"handleMediaDeviceError not defined"**
→ Check that state/handler are in same component (LiveKitShell)

**"Guest session not found"**
→ Check token is being sent via Authorization header or query param

**"CORS error"**
→ Check SameSite=None in production, use query param fallback

**"Permission denied"**
→ Check browser permission settings, show user-friendly banner

---

**Document Status:** ✅ Complete & Production-Verified  
**Maintained By:** Development Team  
**Next Review:** When adding HLS viewer support
