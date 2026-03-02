# Video Window Debug Logs Reference

## Overview

Comprehensive logging has been added to diagnose **why video windows aren't appearing**. All logs are prefixed with `[LiveKit]`, `[Video]`, or `[Room]` for easy filtering.

## What Was Added

### 1. LiveKit Connection Lifecycle Logs

**When connecting to LiveKit room:**
```
[LiveKit] Room context initialized { roomName, state, numParticipants }
[LiveKit] Room state changed: connecting
[LiveKit] ✅ Room connected successfully { roomName, serverUrl, localIdentity }
[Room] 🔗 LiveKit onConnected callback fired { isViewer, isHost, roomId, wantsAudio, wantsVideo }
```

**If connection fails:**
```
[Room] ❌ LiveKit error: { error, message, isViewer, isHost }
[LiveKit] ❌ Room disconnected
```

### 2. Track Publishing Logs (Host Side)

**When host's camera/microphone starts:**
```
[LiveKit] 🎥 Local track published { kind: "video", source: "camera", trackSid, muted, enabled }
[LiveKit] 🎥 Local track published { kind: "audio", source: "microphone", trackSid, muted, enabled }
```

**If tracks aren't published:**
- Check if `wantsAudio: true` and `wantsVideo: true` appeared in the onConnected log
- Check browser console for camera/microphone permission prompts
- Look for errors about device access

### 3. Remote Participant Logs (Guest Side)

**When guest sees host join:**
```
[LiveKit] 👤 Remote participant connected { identity, sid, totalRemote }
```

**When guest subscribes to host's video:**
```
[LiveKit] 📹 Track subscribed { kind: "video", source: "camera", trackSid, participantIdentity, muted, enabled }
```

### 4. Video Element Monitoring

**When video elements are created in DOM:**
```
[Video] 📺 Video elements found: 2
[Video] Element 0: { hasStream: true, paused: false, muted: true, readyState: 4, width: 1280, height: 720, isPlaying: true }
[Video] Element 1: { hasStream: true, paused: false, muted: true, readyState: 4, width: 1280, height: 720, isPlaying: true }
```

**Video element lifecycle:**
```
[Video] 0 metadata loaded: { width: 1280, height: 720, duration: Infinity }
[Video] 0 ▶️ started playing
[Video] 0 ⏸️ paused
[Video] 0 ❌ error: { error, code, message }
```

**No video elements found:**
```
[Video] ⚠️ No video elements found yet
```

### 5. Periodic State Summary (Every 5 seconds)

```
[LiveKit] 📊 State Summary: {
  roomState: "connected",
  localIdentity: "abc123",
  localPublishedTracks: 2,
  localVideoPublished: true,
  localAudioPublished: true,
  remoteParticipants: 1,
  remoteParticipantsWithVideo: 1,
  videoElementsInDOM: 2
}
```

## Troubleshooting Guide

### Issue: "No video window appears"

**Step 1: Check Connection**
Look for:
```
[LiveKit] ✅ Room connected successfully
```

If missing:
- Check token fetch logs: `[Room] token received: true`
- Check server URL: `serverUrl: wss://...`
- Look for `[Room] ❌ LiveKit error`

**Step 2: Check Track Publishing (Host)**
For hosts, look for:
```
[LiveKit] 🎥 Local track published { kind: "video" }
```

If missing:
- Check `wantsVideo: true` in onConnected log
- Open browser DevTools → Check camera permissions
- Look for browser permission prompts (camera blocked?)
- Check if `isViewer: true` (viewers don't publish tracks)

**Step 3: Check Track Subscription (Guest)**
For guests, look for:
```
[LiveKit] 👤 Remote participant connected
[LiveKit] 📹 Track subscribed { kind: "video" }
```

If remote participant connected but no track subscribed:
- Host may not be publishing video yet
- Check host's track publishing logs
- Look for track muted/unmuted events

**Step 4: Check Video Elements**
Look for:
```
[Video] 📺 Video elements found: 2
[Video] Element 0: { hasStream: true, isPlaying: true }
```

If `hasStream: false`:
- MediaStream not attached to <video> element
- LiveKit track subscription may have failed

If `isPlaying: false`:
- Check `paused: true` (needs user gesture to play?)
- Check `readyState: 0-4` (0 = no data, 4 = ready to play)
- Look for autoplay policy blocks

**Step 5: Check Periodic Summary**
Every 5 seconds you'll see:
```
[LiveKit] 📊 State Summary: { videoElementsInDOM: 0 }
```

This tells you:
- `localVideoPublished: true` → Host is streaming ✅
- `remoteParticipantsWithVideo: 1` → Guest can see host ✅
- `videoElementsInDOM: 2` → Video elements exist ✅

### Issue: "Black video or frozen video"

**Check video element state:**
```javascript
// Run in browser console
document.querySelectorAll('video').forEach((v, i) => {
  console.log(`Video ${i}:`, {
    hasStream: !!v.srcObject,
    paused: v.paused,
    readyState: v.readyState,
    videoWidth: v.videoWidth,
    videoHeight: v.videoHeight,
  });
});
```

**Possible causes:**
1. `readyState: 0-1` → Not enough data loaded
2. `videoWidth: 0, videoHeight: 0` → No video frames
3. `paused: true` → Autoplay blocked, need user tap
4. Track muted: Look for `[LiveKit] Track muted`

### Issue: "Host can't publish video"

**Check permission prompt:**
- Browser may be waiting for camera permission
- Check browser address bar for camera icon
- Check browser DevTools → Console for MediaDevices errors

**Check LiveKit logs:**
```
[Room] 🔗 LiveKit onConnected callback fired { wantsVideo: true }
```

If `wantsVideo: false`:
- Check `isViewer` state (should be false for hosts)
- Check Room.tsx line ~916: `video={!isViewer}`

**Check for errors:**
```
[Room] ❌ LiveKit error: { error: "NotAllowedError" }
```

Means: Camera permission denied by user

### Issue: "Guest can't see host video"

**Check autoSubscribe:**
```
[Room] 🔗 LiveKit onConnected callback fired { isViewer: true }
```

Guests should have `isViewer: true` and LiveKit should be configured with `autoSubscribe: true`.

**Check subscription logs:**
```
[LiveKit] 📹 Track subscribed { participantIdentity: "host-uid" }
```

If missing:
- Host may not be publishing yet
- Network issues preventing track subscription
- Check host's published tracks in summary

## Console Filtering Tips

**Filter by log type:**
```javascript
// Only LiveKit events
[LiveKit]

// Only video element events
[Video]

// Only room connection events
[Room]

// Show all video-related logs
LiveKit|Video|Room
```

**Chrome DevTools Regex Filter:**
1. Open Console
2. Click filter icon
3. Enable "Regex"
4. Enter: `LiveKit|Video|Room`

**Watch for errors:**
```javascript
// Filter for errors only
❌|error|Error|ERROR
```

## Expected Flow: Host Starts Stream

```
1. [Room] Fetching room token (role=host)...
2. [Room] token received: true serverUrl: wss://...
3. [Room] 🔗 LiveKit onConnected callback fired { isHost: true, wantsVideo: true }
4. [LiveKit] Room context initialized
5. [LiveKit] Room state changed: connecting
6. [LiveKit] ✅ Room connected successfully
7. [LiveKit] 🎥 Local track published { kind: "video", source: "camera" }
8. [LiveKit] 🎥 Local track published { kind: "audio", source: "microphone" }
9. [Video] 📺 Video elements found: 1
10. [Video] Element 0: { hasStream: true, isPlaying: true }
11. [LiveKit] 📊 State Summary: { localVideoPublished: true, videoElementsInDOM: 1 }
```

## Expected Flow: Guest Joins

```
1. [Room] Guest polling room status
2. [Room] Room is live! Guest can now join.
3. [Room] Fetching room token (role=participant)...
4. [Room] token received: true
5. [Room] 🔗 LiveKit onConnected callback fired { isViewer: true }
6. [LiveKit] ✅ Room connected successfully
7. [LiveKit] 👤 Remote participant connected { identity: "host-uid" }
8. [LiveKit] 📹 Track subscribed { kind: "video", participantIdentity: "host-uid" }
9. [Video] 📺 Video elements found: 1
10. [Video] Element 0: { hasStream: true, isPlaying: true }
11. [LiveKit] 📊 State Summary: { remoteParticipantsWithVideo: 1, videoElementsInDOM: 1 }
```

## Common Failure Patterns

### Pattern 1: Camera Permission Denied
```
[Room] ❌ LiveKit error: { message: "Permission denied" }
[LiveKit] 📊 State Summary: { localVideoPublished: false }
```
**Fix:** Grant camera permission in browser

### Pattern 2: No Video Elements in DOM
```
[Video] ⚠️ No video elements found yet
[LiveKit] 📊 State Summary: { videoElementsInDOM: 0 }
```
**Fix:** Check if VideoConference component is rendering

### Pattern 3: Video Element Has No Stream
```
[Video] Element 0: { hasStream: false, readyState: 0 }
```
**Fix:** Track subscription failed, check network/LiveKit logs

### Pattern 4: Guest Joins Before Host Publishes
```
[LiveKit] 👤 Remote participant connected
(no track subscribed event)
[LiveKit] 📊 State Summary: { remoteParticipantsWithVideo: 0 }
```
**Fix:** Wait for host to publish video (should auto-subscribe when available)

### Pattern 5: Autoplay Blocked
```
[Video] Element 0: { hasStream: true, paused: true, readyState: 4 }
```
**Fix:** Tap screen to start playback (browser autoplay policy)

---

## Quick Diagnostic Checklist

Run through these in order when debugging "no video":

- [ ] **Connection**: See `[LiveKit] ✅ Room connected successfully`?
- [ ] **Host Publishing**: See `[LiveKit] 🎥 Local track published { kind: "video" }`?
- [ ] **Guest Subscription**: See `[LiveKit] 📹 Track subscribed`?
- [ ] **Video Elements**: See `[Video] 📺 Video elements found`?
- [ ] **Video Playing**: See `{ hasStream: true, isPlaying: true }`?
- [ ] **Summary Check**: `videoElementsInDOM > 0`?

If all are ✅ but still no video:
1. Check CSS/z-index (video may be hidden)
2. Check video element size: `videoWidth` and `videoHeight`
3. Look for browser autoplay blocks
4. Check for ad-blockers or privacy extensions

---

**Note:** All these logs are automatically enabled. Just open browser DevTools → Console and start a room. The logs will appear in real-time as connections, tracks, and video elements are created.
