# HLS Endpoint Separation Guide

## Security Pattern: Separate /room and /watch Middleware

### Overview
When implementing HLS watch-only routes, use **separate middleware** from RTC `/room/*` routes to prevent token/role confusion attacks.

---

## Middleware Rules

### `/room/*` Routes (RTC Participants)
**Purpose:** Real-time video conferencing with mic/cam publishing

**Role Mapping:**
- `guest` → RTC guest with mic/cam
- `participant` → RTC participant with mic/cam
- `viewer` (legacy) → **Map to `guest`** (backward compatibility)
- `host` → Full permissions
- Unknown roles → **Reject with 401/403**

**Middleware:** `requireGuestSession()` or `requireAuth()`

**Example:**
```typescript
router.post('/room/:roomId/join', requireGuestSession, async (req, res) => {
  const role = req.guestSession?.role; // "guest" | "participant"
  // Grant canPublish: true for mic/cam
});
```

---

### `/watch/*` Routes (HLS Viewers) - **Future Implementation**
**Purpose:** Watch-only streaming (no mic/cam, subscribe-only)

**Role Mapping:**
- `viewer` → **Keep as `viewer`** (subscribe-only, no publish)
- `guest` → **Block or downgrade** (RTC token shouldn't access HLS)
- `participant` → **Block or downgrade**
- `host` → Allow (hosts can watch their own stream)
- Unknown roles → **Reject with 401/403**

**Middleware:** `requireHLSSession()` (new, separate from guest session)

**Example:**
```typescript
router.get('/watch/:roomId/playlist.m3u8', requireHLSSession, async (req, res) => {
  const role = req.hlsSession?.role; // "viewer" | "host"
  // Grant canSubscribe: true, canPublish: false
  // Do NOT allow RTC guest tokens here
});
```

---

## Why Separate Middleware?

### Security Risks of Reusing Same Middleware
1. **Token Confusion:** RTC guest token could access HLS endpoints (or vice versa)
2. **Permission Escalation:** HLS viewer token could gain RTC publish permissions
3. **Role Ambiguity:** Same role name means different things in different contexts

### Defense Pattern
```typescript
// ❌ WRONG - Reusing guest session for HLS
router.get('/watch/:roomId', requireGuestSession, (req, res) => {
  // RTC guest token now accesses HLS route!
});

// ✅ CORRECT - Separate HLS session middleware
router.get('/watch/:roomId', requireHLSSession, (req, res) => {
  if (req.hlsSession?.role !== 'viewer' && req.hlsSession?.role !== 'host') {
    return res.status(403).json({ error: 'HLS_ONLY' });
  }
  // Only viewer/host tokens can access
});
```

---

## Implementation Checklist

When adding HLS routes:
- [ ] Create `middleware/hlsSession.ts` (separate from `guestSession.ts`)
- [ ] HLS JWT must have distinct `type: 'hls'` claim (not `type: 'guest'`)
- [ ] `/watch/*` routes use `requireHLSSession()` middleware only
- [ ] `/room/*` routes reject `type: 'hls'` tokens
- [ ] `roleToParticipantPermission()` handles `viewer` as `canPublish: false`
- [ ] Test: RTC guest token → 403 on `/watch/*`
- [ ] Test: HLS viewer token → 403 on `/room/*`

---

## Current State (Feb 2026)

**Status:** HLS not yet implemented  
**Rationale:** This doc exists to prevent future security mistakes

**What's Ready:**
- ✅ `roleToParticipantPermission()` already defines `viewer` as subscribe-only
- ✅ `/room/*` middleware maps legacy `viewer` → `guest` for backward compat
- ✅ Role validation rejects unknown/corrupted roles

**What's Needed:**
- ⏳ `middleware/hlsSession.ts` (new middleware for HLS tokens)
- ⏳ `/watch/*` routes (HLS playlist/segment serving)
- ⏳ Token type discrimination (`type: 'guest'` vs `type: 'hls'`)

---

## Example: Full Separation

### RTC Guest Join (Current)
```typescript
// POST /room/:roomId/join
middleware: requireGuestSession
token claim: { type: 'guest', role: 'guest', roomId: '...' }
LiveKit grant: canPublish: true, canPublishSources: ["microphone", "camera"]
```

### HLS Watch (Future)
```typescript
// GET /watch/:roomId/playlist.m3u8
middleware: requireHLSSession
token claim: { type: 'hls', role: 'viewer', roomId: '...' }
LiveKit grant: canSubscribe: true, canPublish: false, canPublishSources: []
```

**Key Difference:** `type` field discriminates token purpose, preventing cross-context abuse.

---

## Ship Checklist (Pre-Deployment)

Before deploying any HLS changes:
1. **Old invite test:** Click old invite link → lands as `guest` → mic/cam works
2. **In-app browser:** Click invite in FB Messenger → permission banner appears
3. **Host moderation:** Host can still mute/kick guests
4. **Token isolation:** RTC token cannot access `/watch/*` (403)
5. **HLS isolation:** HLS token cannot access `/room/*` (403)

If all 5 pass, deployment is safe.
