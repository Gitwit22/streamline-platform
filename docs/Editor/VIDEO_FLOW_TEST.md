# Video Flow Test Procedure - Step by Step

## Quick Test: Recording → Editor → Export

Follow these steps to verify the complete flow works.

---

## Setup
```bash
# Terminal 1
cd streamline-client
npm run dev

# Terminal 2
cd streamline-server  
npm start
```

Navigate to `http://localhost:5173` in browser

---

## Test 1: Verify Recording Capture

### Steps:
1. Click "Create Room" on home page
2. Enter room name: `test-room`
3. Click "Start Stream" (green button)
4. Wait 10+ seconds
5. Look for console message: `"Recording started: rec_..."`
6. Click "Stop Stream"

### What to Check:
- ✅ Console shows recording ID
- ✅ Recording appears in localStorage['sl_recordings']
- ✅ Browser navigates to exit page
- ✅ Exit page shows recording info

**Status:** Should see recording with title, duration, status='ready'

---

## Test 2: Verify Exit Page Download Option

### Steps:
1. On exit page (from Test 1)
2. Check if recording shows status: `ready`
3. Click "🔥 Download Stream" button
4. Progress modal appears

### What to Check:
- ✅ Download button is enabled (not grayed out)
- ✅ Progress modal shows 0% then increases
- ✅ File downloads to Downloads folder
- ✅ File named: `stream-...-date.mp4`

**Status:** File should download successfully

---

## Test 3: Verify Recording Flows to Editor

### Steps:
1. Go back to `/room-exit/{recordingId}` page
2. Click "✂️ Go to Editor" button
3. Check browser URL - should be: `/editing/editor/new?recordingId=rec_...`

### What to Check:
- ✅ URL contains recordingId parameter
- ✅ Page navigates without error
- ✅ Console shows "Loading project..."

**Status:** Should load editor page

---

## Test 4: Verify Video Loads in Editor

### Steps:
1. Wait for editor to load (from Test 3)
2. Look at center panel - video preview area
3. Check that video appears

### What to Check:
- ✅ Video player visible in preview
- ✅ Video thumbnail/first frame showing
- ✅ Console shows no errors
- ✅ Timeline shows 1 clip

**Check the console:**
```javascript
// In browser DevTools Console:
console.log("Recording loaded:", recording);
console.log("Clips:", clips);
console.log("Video URL:", clips[0]?.videoUrl);
```

**Expected console output:**
```
Recording loaded: {
  id: "rec_uuid",
  title: "Stream - 12/8/2025...",
  duration: 10,
  videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-library/sample/BigBuckBunny.mp4",
  status: "ready"
}

Clips: [{
  id: "clip_...",
  assetId: "rec_uuid",
  startTime: 0,
  duration: 10,
  name: "Stream - 12/8/2025...",
  videoUrl: "https://..." ✅ SAME AS RECORDING
}]
```

**Status:** ✅ Video URL successfully passed to editor

---

## Test 5: Verify Video Playback

### Steps:
1. In editor, locate the video preview (center top)
2. Click the blue ▶ (play) button in playback controls
3. Watch the video play

### What to Check:
- ✅ Play button changes to pause icon ⏸
- ✅ Video plays (audio muted)
- ✅ Playhead moves along timeline
- ✅ Current time updates (shows "0:00 / 0:10")
- ✅ Click pause button ⏸ stops video

**Status:** ✅ Video playback working in editor

---

## Test 6: Verify Timeline Interaction

### Steps:
1. With video loaded, look at bottom section (timeline)
2. See if you can identify:
   - Ruler with numbers
   - Clip (colored bar) on timeline
   - Playhead (vertical line)

3. Click different positions on timeline
4. Check if playhead moves

### What to Check:
- ✅ Timeline visible
- ✅ Clip appears as block
- ✅ Playhead moves when clicked
- ✅ Time indicator updates

**Status:** Timeline interactive

---

## Test 7: Verify Edit Tools

### Steps:
1. Select the clip (click on it in timeline)
2. Look at left sidebar for tools
3. Try:
   - Click "Split at Playhead" (S key)
   - Click "Trim to Playhead"
   - Click "Delete Clip"

### What to Check:
- ✅ "Split at Playhead" creates 2 clips
- ✅ "Trim to Playhead" shortens clip
- ✅ "Delete Clip" removes it
- ✅ Video updates in preview

**Status:** Edit tools functional

---

## Test 8: Verify Zoom & Navigation

### Steps:
1. Find zoom controls (should be near timeline)
2. Click "Zoom In" button (🔍+)
3. Check timeline gets wider
4. Click "Zoom Out" button (🔍-)
5. Check timeline gets narrower

### What to Check:
- ✅ Zoom changes timeline width
- ✅ Can scroll horizontally on zoomed timeline
- ✅ Playhead position maintained

**Status:** Zoom working

---

## Test 9: Check What's NOT Yet Implemented

### These features exist but need completion:

**Export Button**
- ✅ Button exists in bottom right
- ❌ Export dialog may not open yet
- ❌ Backend export endpoint may not exist
- ❌ File doesn't download yet

**To test (will be added):**
```tsx
// Click "Download Edited Video" button
// Should see export dialog with options
// Select: 720p, MP4, Standard
// Click Export
// Progress modal appears
// File downloads when done
```

---

## Complete Flow Summary

```
✅ Test 1: Recording Captures when stream stops
✅ Test 2: Exit page shows recording, download works  
✅ Test 3: Editor loads with recordingId URL param
✅ Test 4: Video URL in recording passed to editor
✅ Test 5: Video plays in editor preview
✅ Test 6: Timeline shows clip, responds to clicks
✅ Test 7: Edit tools (split, trim, delete) work
✅ Test 8: Zoom and pan work on timeline

❌ Test 9: Export functionality (to be built next)
```

---

## Troubleshooting

### Video doesn't load in editor
**Check:**
1. Is recordingId in URL? (Copy from browser bar)
2. Does localStorage have the recording? (DevTools → Application → localStorage → sl_recordings)
3. Is recording status='ready'? (Check mock data)
4. Is videoUrl set? (Check console output)

**Fix:**
- Reload page
- Clear localStorage and try again
- Check console for errors

### Editor page shows "No clips in timeline"
**Check:**
1. recordingId parameter exists
2. Recording loading succeeded
3. editingApi.getRecording() returned data

**Fix:**
- Check network tab (should fetch recording)
- Check console for fetch errors
- Verify recording exists in Firestore/localStorage

### Playback doesn't work
**Check:**
1. Video element has src attribute
2. Browser allows video autoplay (muted)
3. No CORS errors in console

**Fix:**
- Check browser console for errors
- Try direct video URL in new tab
- Verify video URL is accessible

---

## What's Next After Testing

Once you verify tests 1-8 pass:

**Phase 1 - Timeline Styling** (starts with this PR)
- Enhanced ruler with time labels
- Better clip rendering
- Improved playhead styling
- Trim handles on clips

**Phase 2 - Export** (next PR)
- Export dialog with quality options
- Backend video processing
- Progress tracking
- Download trigger

**Phase 3 - Advanced** (future)
- Multiple tracks
- Transitions
- Text overlays
- Audio mixing

---

## Success Criteria

When all tests pass, you've verified:

✅ Recording system works end-to-end
✅ Video file preserved through entire flow
✅ Editor loads with correct video
✅ Timeline rendering functional
✅ Edit operations work correctly
✅ UI responsive and interactive

Ready to build timeline enhancements with confidence!
