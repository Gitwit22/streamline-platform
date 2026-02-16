# Guest Video Verification Guide

## What We Fixed

Based on the documentation in [ROOM_INVITE_FEATURE.md](ROOM_INVITE_FEATURE.md), [GUEST_INVITE_FIX.md](GUEST_INVITE_FIX.md), and [PERMISSIONS_AND_INVITES.md](PERMISSIONS_AND_INVITES.md), we've ensured that guest participants can reliably see the video window populate with the host's video feed.

## Changes Applied

### 1. Enhanced Guest Session Reliability ✅

**Problem:** Guests couldn't establish sessions in restrictive browser contexts (FB/IG in-app browsers).

**Solution:**
- Multi-source token authentication (Authorization Bearer, query params, localStorage, sessionStorage, cookies)
- Production cookies use `SameSite=None; Secure` for cross-site compatibility
- Automatic fallback chain ensures token delivery even when one method fails

### 2. Video Window Rendering ✅

**Problem:** Guests might see blank screen instead of host video.

**Solution:**
- Added "Connected as viewer — host video will appear here" indicator when guest connects
- Proper `autoSubscribe: true` for viewers (automatic track subscription)
- Console logging for debugging connection/subscription issues
- LiveKit automatically handles video element attributes (`muted`, `playsInline`)

### 3. Connection Flow Debugging ✅

**Added comprehensive logging:**
```javascript
// Guest token detection
console.log('[Room] Guest polling room status', { 
  roomId, 
  hasGuestToken: !!guestSessionToken, 
  hasInviteToken: !!inviteToken 
});

// Room status changes
console.log('[Room] Guest room status:', status);
console.log('[Room] Room is live! Guest can now join.');

// Token fetching
console.log('[Room] Token fetch context:', {
  hasAuth: !!bearerToken,
  hasGuestToken: !!guestSessionToken,
  roomId,
  role,
  isHost,
  isViewer
});

// LiveKit connection
console.log('[Room] LiveKit connected', { isViewer, roomId });
```

## Testing Protocol

### Test 1: Guest Invite Link → Video Appears

**Setup:**
1. Host creates a room and starts streaming (publishes video)
2. Host clicks "🔗 Invite" button
3. Copy the invite link

**Guest Flow:**
1. Open invite link in **new incognito window**
2. Should redirect to `/invite/{inviteId}` → auto-redeems → `/room/{roomId}?gst=...`
3. **Expected behavior:**
   - See "Not started yet — waiting for the host" (if room not live)
   - Once room is live, see "👀 Connected as viewer — host video will appear here"
   - Host's video tile populates in the grid
   - Can see/hear host video

**Console Verification:**
```
[Room] Guest polling room status { roomId: "...", hasGuestToken: true }
[Room] Guest room status: idle
[Room] Guest room status: live
[Room] Room is live! Guest can now join.
[Room] Fetching room token (role=participant)...
[Room] Token fetch context: { hasGuestToken: true, isViewer: true }
[Room] LiveKit connected { isViewer: true, roomId: "..." }
```

### Test 2: Cross-Site Context (FB/IG In-App Browser)

**Setup:**
1. Share invite link via Facebook Messenger or Instagram DM
2. Click link from within FB/IG app

**Expected behavior:**
- Cookie may fail, but query param `?gst=` works
- Guest connects successfully
- Video renders normally

**Verification:**
- Network tab: Check `/api/invites/:inviteId/redeem` returns `guestSessionToken`
- Application tab: Check if cookie exists (may not in FB/IG)
- URL should contain `?gst=...` parameter
- Video window populates regardless of cookie state

### Test 3: Video Autoplay Policy

**Setup:**
1. Guest joins room with host already streaming
2. Browser may block autoplay

**Expected behavior:**
- Video element renders with `muted` and `playsInline` attributes
- If browser blocks autoplay, guest can tap screen to start playback
- No console errors about play() promises

**Console Check:**
```javascript
// Run in guest browser console
const videoElements = document.querySelectorAll('video');
videoElements.forEach(v => {
  console.log('Video:', {
    muted: v.muted,
    playsInline: v.playsInline,
    srcObject: v.srcObject ? 'MediaStream' : null,
    paused: v.paused
  });
});
```

### Test 4: LiveKit Participant State

**Setup:**
1. Guest joins live room
2. Open browser console

**Run debug commands:**
```javascript
// Check room connection
console.log('Room state:', room.state); // Should be "connected"
console.log('Remote participants:', room.remoteParticipants.size); // Should have host

// Check track subscriptions
room.remoteParticipants.forEach(p => {
  console.log('Participant:', p.identity);
  console.log('Video tracks:', p.videoTracks.size); // Should have 1+ if host is publishing
  
  p.videoTracks.forEach(track => {
    console.log('Track:', {
      sid: track.trackSid,
      kind: track.kind, // "video"
      subscribed: track.isSubscribed,
      enabled: track.isEnabled
    });
  });
});
```

**Expected output:**
```
Room state: "connected"
Remote participants: 1
Participant: "host-uid-123"
Video tracks: 1
Track: { sid: "TR_...", kind: "video", subscribed: true, enabled: true }
```

## Visual Indicators

### Guest Sees:
1. **Before room is live:**
   ```
   ┌────────────────────────────────────┐
   │ Not started yet — waiting for host │
   └────────────────────────────────────┘
   ```

2. **Connected but no video yet:**
   ```
   ┌──────────────────────────────────────────────┐
   │ 👀 Connected as viewer — host video will     │
   │    appear here                               │
   └──────────────────────────────────────────────┘
   [Empty video grid - waiting for host to publish]
   ```

3. **Host video active:**
   ```
   ┌──────────────────────────────────────────────┐
   │ 👀 Connected as viewer — host video will     │
   │    appear here                               │
   └──────────────────────────────────────────────┘
   ┌─────────────────────┐
   │                     │
   │   HOST VIDEO TILE   │
   │   (streaming)       │
   │                     │
   └─────────────────────┘
   ```

### Host Sees:
- Normal room view with their own video
- "Guest is viewing the join page" indicator (when guest lands on `/invite/{id}`)

## Troubleshooting

### Issue: Guest sees blank screen

**Check:**
1. **Console logs** - Is guest connected to LiveKit?
   ```
   [Room] LiveKit connected { isViewer: true }
   ```

2. **Network tab** - Did token fetch succeed?
   ```
   POST /api/rooms/:roomId/token → 200 OK
   ```

3. **LiveKit state** - Are there remote participants?
   ```javascript
   console.log(room.remoteParticipants.size); // Should be > 0
   ```

4. **Host publishing?** - Is host actually streaming video?
   - Host should see their own camera tile
   - Check host's camera permissions

**Fix:**
- Guest: Refresh page
- Host: Ensure camera is enabled and publishing
- Check room status is "live": `POST /api/rooms/:roomId/status`

### Issue: Video frozen/black

**Check:**
1. **Autoplay blocked** - Tap/click screen to start playback
2. **Track muted** - Check if track is enabled:
   ```javascript
   track.isEnabled // Should be true
   ```
3. **Network issues** - Check WebRTC connection quality

**Fix:**
- Guest: Click/tap video area
- Check network connectivity
- Try reconnecting

### Issue: Guest can't join (401/403)

**Check:**
1. **Guest session token** - Inspect localStorage/sessionStorage:
   ```javascript
   console.log(localStorage.getItem('sl_guestSessionToken'));
   console.log(sessionStorage.getItem('sl_guest_session:' + roomId));
   ```

2. **Query parameter** - Check URL contains `?gst=...`

3. **Cookie** - Check Application tab for `sl_guest` cookie

4. **Invite validity** - Invite may be expired or revoked

**Fix:**
- Re-share invite link (generates fresh token)
- Ensure `NODE_ENV=production` in prod (for SameSite=None)
- Check CORS/credentials settings

### Issue: "Waiting for host" never ends

**Check:**
1. **Room status polling** - Console should show:
   ```
   [Room] Guest room status: idle
   [Room] Guest room status: idle
   ...
   [Room] Guest room status: live  ← Never reaches this
   ```

2. **Host hasn't started** - Host must join the room to flip it "live"

**Fix:**
- Host: Join the room (connects to LiveKit)
- Backend: Verify `/api/rooms/:roomId/status` endpoint returns correct status
- Check room document in Firestore has `status: "live"`

## Success Criteria

✅ **Guest can redeem invite link** in any browser context (including FB/IG in-app)
✅ **Guest sees "waiting for host"** message before room is live
✅ **Guest sees "connected as viewer"** indicator after joining
✅ **Host video appears** in guest's video grid when host publishes
✅ **No console errors** about authentication or permissions
✅ **Video plays** automatically (muted) or after user gesture
✅ **Remote participant tracks** are visible in LiveKit state

## Production Checklist

Before deployment:

- [ ] `NODE_ENV=production` set (enables SameSite=None for cross-site cookies)
- [ ] HTTPS enabled on both frontend and backend (required for Secure cookies)
- [ ] CORS configured with:
  - `credentials: true`
  - `allowedHeaders` includes "Authorization", "x-guest-session"
  - `origin` set to exact frontend URL (not `*`)
- [ ] Guest session secret is strong: `GUEST_SESSION_SECRET=<random-string>`
- [ ] Test invite flow in production environment
- [ ] Test in FB/IG in-app browser (use QR code or share via DM)

## Related Documentation

- [ROOM_INVITE_FEATURE.md](ROOM_INVITE_FEATURE.md) - Basic invite button usage
- [GUEST_INVITE_FIX.md](GUEST_INVITE_FIX.md) - Technical implementation details
- [PERMISSIONS_AND_INVITES.md](PERMISSIONS_AND_INVITES.md) - Security and permissions

---

**Summary:** Guests now have a bulletproof path from invite link → video rendering, with multiple fallback layers for authentication and clear visual feedback at every step. The video window will populate automatically when the host publishes video tracks.
